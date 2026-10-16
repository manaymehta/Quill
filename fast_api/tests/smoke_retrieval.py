"""Offline check of step 2a's search (no network): floor, note scores, rank
fusion, strong/partial labels, overlap joining, the text budget, and the
search_notes tool end to end with a fake meaning search and a fake
search-support response (gone / stale / unsaved / meaning-search failure)."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import agent.retrieval as r
import agent.tools as tools
from agent.tools import ToolContext

A, B, C, D, E = (ch * 24 for ch in "abcde")


def piece(note, idx, score, text, h="h1"):
    return {"noteId": note, "chunkIndex": idx, "text": text, "score": score, "textHash": h}


async def main():
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")

    # Floor and note score.
    pieces = [piece(A, 0, 0.72, "a0"), piece(A, 1, 0.65, "a1"), piece(B, 0, 0.70, "b0"), piece(C, 0, 0.55, "c0")]
    grouped = r.group_pieces(pieces)
    check("pieces under the floor are dropped", set(grouped) == {A, B})
    check("note score = best + bonus per extra piece", abs(grouped[A].meaning_score - 0.74) < 1e-9 and grouped[B].meaning_score == 0.70)

    # Fusion: a note in both lists beats one in a single list; keyword-only notes join.
    hits = [{"noteId": B, "matchedBy": ["title"], "window": "beta window"}, {"noteId": D, "matchedBy": ["content"], "window": "delta window"}]
    ranked = r.fuse(r.group_pieces(pieces), hits)
    check("note in both lists ranks first", [c.note_id for c in ranked][:1] == [B], str([c.note_id[0] for c in ranked]))
    check("keyword-only note is included with its window", any(c.note_id == D and c.excerpts[0].text == "delta window" for c in ranked))
    top = max(c.best_piece for c in ranked if c.best_piece is not None)
    labels = {c.note_id[0]: r.strength(c, top) for c in ranked}
    check("labels: title/word hits strong, close meaning strong",
          labels == {"b": "strong", "a": "strong", "d": "strong"}, str(labels))
    weak = r.group_pieces([piece(A, 0, 0.75, "x"), piece(E, 0, 0.62, "y")])
    check("a meaning match far below the top is partial", r.strength(weak[E], 0.75) == "partial")

    # Overlap joining for adjacent pieces.
    first = "The quick brown fox jumps over the lazy dog. " * 2
    second = first[-30:] + "Then it ran into the forest."
    joined = r.join_excerpts([r.Excerpt(second, 0.6, 1), r.Excerpt(first, 0.7, 0), r.Excerpt("kw window", 0.5)])
    check("adjacent pieces joined without the repeated text, reading order",
          joined == [first + "Then it ran into the forest.", "kw window"], str(joined)[:120])

    # Text budget: every note gets its best excerpt before any gets a second.
    big = [r.Candidate(note_id=n, excerpts=[r.Excerpt("x" * 3000, 0.9 - i / 10, 0), r.Excerpt("y" * 3000, 0.85 - i / 10, 1)])
           for i, n in enumerate([A, B, C])]
    shown = r.fill_budget(big, budget=9500)
    check("pass 1 gives each note its best excerpt; no excerpt cut or over budget",
          [len(shown[n]) for n in (A, B, C)] == [1, 1, 1], str({n[0]: len(v) for n, v in shown.items()}))

    # The tool end to end with fakes.
    async def fake_meaning(query, user_id, limit):
        return [piece(A, 0, 0.74, "Alpha piece about deploys", "hA"), piece(B, 0, 0.71, "Beta old text", "hB-old"),
                piece(C, 0, 0.70, "Gamma piece", "hC")]

    sent = {}

    async def fake_express(ctx, method, path, summary, **kwargs):
        sent.update(kwargs.get("json", {}))
        return {
            "notes": {
                A: {"status": "ok", "title": "Alpha", "folder": "Work", "tags": ["ops"], "isArchived": False,
                    "isChecklist": False, "lastEdited": "2026-10-01T10:00:00Z"},
                B: {"status": "stale", "title": "Beta", "folder": None, "tags": [], "isArchived": True,
                    "isChecklist": False, "lastEdited": "2026-10-02T10:00:00Z", "currentText": "Beta current text"},
                C: {"status": "gone"},
                D: {"status": "ok", "title": "Delta", "folder": None, "tags": ["deploy"], "isArchived": False,
                    "isChecklist": False, "lastEdited": "2026-09-01T10:00:00Z"},
            },
            "keywordHits": [{"noteId": D, "matchedBy": ["tag"], "window": "Delta opening"}],
        }, None

    tools._call_express = fake_express
    ctx = ToolContext(user_id="u", auth_header="Bearer x", express_base_url="http://x", meaning_search=fake_meaning,
                      unsaved_notes={A: {"title": "Alpha (edited)", "content": "...", "tags": ["ops"], "isChecklist": False, "checklist": []}})
    res = await tools.run_search_notes(ctx, {"query": "deploy", "keywords": ["deploy"]})
    notes = {n["noteId"]: n for n in res.data["notes"]}
    check("tool: gone note dropped, keyword-only note added", set(notes) == {A, B, D}, str([n[0] for n in notes]))
    check("tool: stale note shows its current text", notes[B]["excerpts"] == ["Beta current text"])
    check("tool: unsaved note flagged with its unsaved title", notes[A].get("unsavedChanges") is True and notes[A]["title"] == "Alpha (edited)")
    check("tool: metadata passed through (folder, archived, date, matchedBy)",
          notes[A]["folder"] == "Work" and notes[B]["archived"] is True and notes[A]["lastEdited"] == "2026-10-01"
          and notes[D]["matchedBy"] == ["tag"])
    check("tool: Express got keywords and one hash per meaning note",
          sent["keywords"] == ["deploy"] and {c["noteId"]: c["textHash"] for c in sent["candidates"]} == {A: "hA", B: "hB-old", C: "hC"})
    check("tool: no raw scores or userId reach the model", "score" not in str(res.data) and "userId" not in str(res.data))

    async def broken_meaning(query, user_id, limit):
        raise RuntimeError("embedding down")
    ctx2 = ToolContext(user_id="u", auth_header="Bearer x", express_base_url="http://x", meaning_search=broken_meaning)
    res2 = await tools.run_search_notes(ctx2, {"query": "deploy", "keywords": ["deploy"]})
    check("tool: meaning search down + keywords → keyword results, flagged",
          res2.ok and res2.data.get("meaningSearchUnavailable") and [n["noteId"] for n in res2.data["notes"]] == [D])
    res3 = await tools.run_search_notes(ctx2, {"query": "deploy"})
    check("tool: meaning search down, no keywords → recoverable error", not res3.ok and res3.error.recoverable)

    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
