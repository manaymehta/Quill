"""The agent's search (architecture plan §2.4, step 2a): meaning search and
exact (keyword/tag) search merged by rank, with no LLM call.

Pipeline for one search_notes call:
1. meaning pieces (Qdrant, over-fetched) → drop those under the FLOOR;
2. one Express call (search-support): checks the matched notes still exist and
   are current (fingerprint), and runs the exact search;
3. note score = best piece + a small bonus per extra matching piece; a note is
   "strong" within STRONG_MARGIN of the top score (a label, never a filter),
   or when the keywords hit its title or tags;
4. reciprocal rank fusion of the meaning and exact lists;
5. a ~TEXT_BUDGET-char excerpt budget, filled best-first in two passes.

Calibration (Oct 2026, gemini-embedding-2, 24 short notes, 10 queries): each
query's real best match scored 0.62–0.75; the best score for an unrelated
query was 0.56; unrelated notes ranged 0.48–0.65. No fixed score separates
relevant from unrelated, so the floor only removes the clearly unrelated and
the margin only labels.
"""
from dataclasses import dataclass, field
from typing import Any

FLOOR = 0.58
STRONG_MARGIN = 0.05
EXTRA_PIECE_BONUS = 0.02
MAX_BONUS_PIECES = 3
OVERFETCH_PIECES = 40
RRF_K = 60
TEXT_BUDGET = 8_000
# Adjacent pieces repeat ~100 chars of the previous one (main.py OVERLAP_CHARS).
MAX_OVERLAP_SCAN = 200


@dataclass
class Excerpt:
    text: str
    score: float
    chunk_index: int | None = None   # None for keyword windows / current text


@dataclass
class Candidate:
    note_id: str
    excerpts: list[Excerpt] = field(default_factory=list)
    meaning_score: float | None = None   # best piece + bonus
    best_piece: float | None = None
    matched_by: set[str] = field(default_factory=set)
    rrf: float = 0.0


def group_pieces(pieces: list[dict[str, Any]]) -> dict[str, Candidate]:
    """Pieces at or above the floor, grouped per note, with the note score."""
    notes: dict[str, Candidate] = {}
    for piece in pieces:
        if piece["score"] < FLOOR or not piece.get("text"):
            continue
        cand = notes.setdefault(piece["noteId"], Candidate(note_id=piece["noteId"]))
        cand.excerpts.append(Excerpt(text=piece["text"], score=piece["score"], chunk_index=piece.get("chunkIndex")))
    for cand in notes.values():
        cand.excerpts.sort(key=lambda e: -e.score)
        cand.best_piece = cand.excerpts[0].score
        extra = min(len(cand.excerpts) - 1, MAX_BONUS_PIECES)
        cand.meaning_score = cand.best_piece + EXTRA_PIECE_BONUS * extra
        cand.matched_by.add("meaning")
    return notes


def best_hashes(pieces: list[dict[str, Any]], note_ids: set[str]) -> list[dict[str, Any]]:
    """One {noteId, textHash} per candidate note, from its best piece."""
    seen: dict[str, str] = {}
    for piece in pieces:   # best first
        if piece["noteId"] in note_ids and piece["noteId"] not in seen:
            seen[piece["noteId"]] = piece.get("textHash") or ""
    return [{"noteId": nid, "textHash": h or None} for nid, h in seen.items()]


def fuse(meaning: dict[str, Candidate], keyword_hits: list[dict[str, Any]]) -> list[Candidate]:
    """Reciprocal rank fusion: the two lists' scores aren't comparable, their
    ranks are. A note in both lists rises."""
    merged = dict(meaning)
    ranked_meaning = sorted(meaning.values(), key=lambda c: -(c.meaning_score or 0))
    for rank, cand in enumerate(ranked_meaning, start=1):
        cand.rrf += 1 / (RRF_K + rank)
    for rank, hit in enumerate(keyword_hits, start=1):
        cand = merged.setdefault(hit["noteId"], Candidate(note_id=hit["noteId"]))
        cand.rrf += 1 / (RRF_K + rank)
        for how in hit.get("matchedBy", []):
            cand.matched_by.add({"content": "word", "checklist": "word"}.get(how, how))
        window = (hit.get("window") or "").strip()
        if window and not any(window[:80] in e.text for e in cand.excerpts):
            # Ranked just under the note's best meaning piece (or as its only text).
            cand.excerpts.append(Excerpt(text=window, score=(cand.best_piece or FLOOR) - 0.001))
    return sorted(merged.values(), key=lambda c: -c.rrf)


def strength(cand: Candidate, top_piece: float | None) -> str:
    if cand.matched_by & {"title", "tag", "word"}:
        return "strong"
    if cand.best_piece is not None and top_piece is not None and cand.best_piece >= top_piece - STRONG_MARGIN:
        return "strong"
    return "partial"


def _strip_overlap(prev: str, nxt: str) -> str:
    """Drop the start of `nxt` that repeats the end of `prev`."""
    for size in range(min(MAX_OVERLAP_SCAN, len(prev), len(nxt)), 0, -1):
        if prev.endswith(nxt[:size]):
            return nxt[size:]
    return nxt


def join_excerpts(chosen: list[Excerpt]) -> list[str]:
    """Shown excerpts in reading order; adjacent pieces of the same note are
    joined into one passage without their repeated text."""
    pieces = sorted((e for e in chosen if e.chunk_index is not None), key=lambda e: e.chunk_index)
    others = [e.text for e in chosen if e.chunk_index is None]
    passages: list[str] = []
    last_index = None
    for e in pieces:
        if passages and last_index is not None and e.chunk_index == last_index + 1:
            passages[-1] += _strip_overlap(passages[-1], e.text)
        else:
            passages.append(e.text)
        last_index = e.chunk_index
    return passages + others


def fill_budget(ranked: list[Candidate], budget: int = TEXT_BUDGET) -> dict[str, list[Excerpt]]:
    """Pass 1: each note's best excerpt, best notes first. Pass 2: remaining
    excerpts by score. Whole excerpts only — one that doesn't fit is skipped."""
    shown: dict[str, list[Excerpt]] = {c.note_id: [] for c in ranked}
    remaining = budget
    for cand in ranked:
        if cand.excerpts and len(cand.excerpts[0].text) <= remaining:
            shown[cand.note_id].append(cand.excerpts[0])
            remaining -= len(cand.excerpts[0].text)
    rest = sorted(
        ((e, cand.note_id) for cand in ranked for e in cand.excerpts[1:]),
        key=lambda pair: -pair[0].score,
    )
    for excerpt, note_id in rest:
        if len(excerpt.text) <= remaining:
            shown[note_id].append(excerpt)
            remaining -= len(excerpt.text)
    return shown
