"""Tool registry: the ONLY capabilities the model may request (Phase A, read-only).

Each entry pairs a strict input schema (taught to the model via function
calling) with an executor that performs the work by calling Express over HTTP
with the user's own forwarded JWT. The model never touches data directly; every
call runs with exactly the calling user's permissions through the same Express
validation as the app's own UI.

Adding a tool = add it to TOOLS below. Nothing else should import executors
directly; the loop resolves everything through this registry.
"""
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import asyncio
import httpx

from . import retrieval
from .schemas import AgentDraft, Citation, ToolError, ToolResult

# Tool calls are user-triggered reads, not fire-and-forget jobs: fast fail is
# better than a hanging turn.
TOOL_TIMEOUT = httpx.Timeout(15.0, connect=5.0)

# search_notes returns matching excerpts, not whole notes (retrieval.py caps
# the text at ~8,000 chars per search).
SEARCH_RESULT_LIMIT_MIN = 1
SEARCH_RESULT_LIMIT_MAX = 12


@dataclass(frozen=True)
class ToolContext:
    """Per-turn identity + connectivity for executing tools.

    auth_header is the user's JWT as forwarded by Express. user_id is
    server-verified identity used only for logging/records — the model never
    sees it and cannot influence it.
    """
    user_id: str
    auth_header: str
    express_base_url: str
    # noteId → the user's unsaved tab version ({title, content, tags,
    # isChecklist, checklist}). Tools reading these notes return this version.
    unsaved_notes: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Notes read in full (get_note) during this turn. Rewriting a note's text
    # requires reading it first, so edits are never made from memory.
    read_note_ids: set[str] = field(default_factory=set)
    # Meaning search over this user's indexed pieces, provided by main.py
    # (it owns the Gemini and Qdrant clients): (query, user_id, limit) →
    # [{noteId, chunkIndex, text, score, textHash}], best first. An optional
    # 4th arg restricts it to given note IDs.
    meaning_search: Callable[..., Awaitable[list[dict[str, Any]]]] | None = None
    # Gemini client for the bulk-selection checker (separate, tool-less calls).
    gemini_client: Any = None
    # Stored meaning vectors per note, provided by main.py: (user_id,
    # note_ids) → {noteId: {vector, text}} (pieces averaged; text = start of
    # the first piece). Notes not in the index are missing from the result.
    note_vectors: Callable[..., Awaitable[dict[str, dict[str, Any]]]] | None = None
    # Permission toggle "destructive": may bulk changes send notes to trash?
    allow_trash: bool = False


_UNSAVED_FIELDS = ("title", "content", "tags", "isChecklist", "checklist")


def with_unsaved(ctx: ToolContext, note: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """The note as the user currently sees it: their unsaved tab version
    overlaid on the saved one when the note is open with unsaved changes.
    Returns (note, is_unsaved)."""
    unsaved = ctx.unsaved_notes.get(str(note.get("_id", "")))
    if not unsaved:
        return note, False
    return {**note, **{key: unsaved[key] for key in _UNSAVED_FIELDS if key in unsaved}}, True


CARD_SNIPPET_CHARS = 160
CARD_MAX_TAGS = 5


def cite(note_id: str, title: str, text: Any = "", tags: Any = None) -> Citation:
    """A citation carrying what the chat's note card shows: title, the start
    of the text the agent saw (whitespace collapsed) and a few tags."""
    snippet = " ".join(str(text or "").split())
    if len(snippet) > CARD_SNIPPET_CHARS:
        snippet = snippet[: CARD_SNIPPET_CHARS - 1].rstrip() + "…"
    clean_tags = [str(t) for t in (tags or []) if str(t).strip()][:CARD_MAX_TAGS]
    return Citation(noteId=note_id, title=title, snippet=snippet, tags=clean_tags)


def card_text(note: dict[str, Any]) -> str:
    """A note's body for its card; checklist notes show their items."""
    content = str(note.get("content", "") or "").strip()
    if content:
        return content
    return "; ".join(
        str(item.get("text") or "").strip()
        for item in note.get("checklist") or []
        if isinstance(item, dict) and str(item.get("text") or "").strip()
    )


def error_result(
    code: str, message: str, *, recoverable: bool, summary: str
) -> ToolResult:
    return ToolResult(
        ok=False,
        error=ToolError(code=code, message=message, recoverable=recoverable),
        summary=summary,
    )


# ── Shared HTTP plumbing ─────────────────────────────────────────────────────


async def _call_express(
    ctx: ToolContext,
    method: str,
    path: str,
    summary: str,
    **request_kwargs: Any,
) -> tuple[dict[str, Any] | None, ToolResult | None]:
    """One place for Express calls: returns (payload, None) on success or
    (None, ToolResult-failure) on any transport/auth/upstream problem."""
    if not ctx.express_base_url:
        return None, error_result(
            "not_configured",
            "The notes backend endpoint is not configured for the agent service.",
            recoverable=False,
            summary=f"{summary} -> backend unavailable",
        )

    try:
        async with httpx.AsyncClient(timeout=TOOL_TIMEOUT) as client:
            response = await client.request(
                method,
                f"{ctx.express_base_url}{path}",
                headers={"Authorization": ctx.auth_header},
                **request_kwargs,
            )
    except httpx.TimeoutException:
        return None, error_result(
            "timeout", "Notes backend timed out.", recoverable=True,
            summary=f"{summary} -> timeout",
        )
    except httpx.RequestError:
        return None, error_result(
            "upstream_unreachable", "Could not reach the notes backend.",
            recoverable=False, summary=f"{summary} -> backend unreachable",
        )

    if response.status_code == 401:
        return None, error_result(
            "auth_expired", "User session expired mid-turn.",
            recoverable=False, summary=f"{summary} -> session expired",
        )
    if response.status_code == 404:
        return None, error_result(
            "not_found", "Not found (it may have been deleted or never existed).",
            recoverable=False, summary=f"{summary} -> not found",
        )
    if not 200 <= response.status_code < 300:   # 201 = saved (proposals, selections)
        return None, error_result(
            "upstream_error", f"Notes backend failed (HTTP {response.status_code}).",
            recoverable=False, summary=f"{summary} -> HTTP {response.status_code}",
        )

    try:
        payload = response.json()
    except ValueError:
        return None, error_result(
            "invalid_response", "Notes backend returned non-JSON data.",
            recoverable=False, summary=f"{summary} -> invalid response",
        )
    return payload, None


# ── search_notes ────────────────────────────────────────────────────────────

SEARCH_NOTES_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": (
                "A standalone, self-contained search phrase describing what to "
                "find, searched by meaning. Resolve pronouns and references from "
                "the conversation and working set first — e.g. turn \"the second "
                "one\" into its actual topic."
            ),
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Optional exact words to also look for (1-5): names, codes, "
                "error messages, tags, rare terms. Matched case-insensitively in "
                "titles, text, tags and checklist items."
            ),
        },
        "limit": {
            "type": "integer",
            "description": "Max notes to return (1-12). Default 8.",
        },
    },
    "required": ["query"],
}

MAX_SEARCH_KEYWORDS = 5


async def run_search_notes(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
    """Meaning + exact search merged by rank; no LLM call (architecture plan
    §2.4, step 2a). Scoring rules live in retrieval.py."""
    query = str(args["query"]).strip()
    try:
        limit = int(args.get("limit", 8))
    except (TypeError, ValueError):
        limit = 8
    limit = max(SEARCH_RESULT_LIMIT_MIN, min(SEARCH_RESULT_LIMIT_MAX, limit))
    keywords = [str(k).strip() for k in (args.get("keywords") or []) if str(k).strip()][:MAX_SEARCH_KEYWORDS]
    keywords = [k[:100] for k in keywords]
    summary = f'search_notes("{query[:60]}"{", keywords" if keywords else ""})'

    # 1. Meaning search (FastAPI → Qdrant). A failure still lets a keyword
    #    search answer, so it is reported instead of ending the call.
    pieces: list[dict[str, Any]] = []
    meaning_failed = False
    if ctx.meaning_search is None:
        meaning_failed = True
    else:
        try:
            pieces = await ctx.meaning_search(query, ctx.user_id, retrieval.OVERFETCH_PIECES)
        except Exception as exc:
            print(f"Agent meaning search failed: {exc!r}")
            meaning_failed = True
    if meaning_failed and not keywords:
        return error_result(
            "search_unavailable", "Meaning search is unavailable right now. Retry with keywords for an exact search.",
            recoverable=True, summary=f"{summary} -> meaning search unavailable",
        )

    meaning = retrieval.group_pieces(pieces)

    # 2. One Express call: note check for the meaning matches + exact search.
    support, failure = await _call_express(
        ctx, "POST", "/v1/agent/search-support", summary,
        json={"keywords": keywords, "candidates": retrieval.best_hashes(pieces, set(meaning))},
    )
    if failure:
        return failure
    notes_info: dict[str, dict[str, Any]] = support.get("notes", {})

    for note_id in list(meaning):
        info = notes_info.get(note_id, {"status": "gone"})
        if info.get("status") == "gone":
            del meaning[note_id]   # trashed/deleted: its leftover pieces are being removed
        elif info.get("status") == "stale":
            # The pieces are from an older version (re-index under way): use the
            # note's current text instead.
            cand = meaning[note_id]
            cand.excerpts = [retrieval.Excerpt(text=str(info.get("currentText", "")), score=cand.best_piece or retrieval.FLOOR)]

    # 3-5. Merge by rank, label, keep the top notes, fill the text budget.
    ranked = [c for c in retrieval.fuse(meaning, support.get("keywordHits", [])) if c.note_id in notes_info
              and notes_info[c.note_id].get("status") != "gone"][:limit]
    top_piece = max((c.best_piece for c in ranked if c.best_piece is not None), default=None)
    shown = retrieval.fill_budget(ranked)

    notes_for_model: list[dict[str, Any]] = []
    citations: list[Citation] = []
    for cand in ranked:
        info = notes_info[cand.note_id]
        unsaved = ctx.unsaved_notes.get(cand.note_id)
        title = str((unsaved or info).get("title", "") or "")
        entry: dict[str, Any] = {
            "noteId": cand.note_id,
            "title": title,
            "folder": info.get("folder"),
            "tags": (unsaved or info).get("tags", []),
            "archived": bool(info.get("isArchived")),
            "isChecklist": bool(info.get("isChecklist")),
            "lastEdited": str(info.get("lastEdited", ""))[:10],
            "match": retrieval.strength(cand, top_piece),
            "matchedBy": sorted(cand.matched_by),
            "excerpts": retrieval.join_excerpts(shown[cand.note_id]),
        }
        hidden = len(cand.excerpts) - len(shown[cand.note_id])
        if hidden > 0:
            entry["moreNotShown"] = hidden
        if unsaved:
            entry["unsavedChanges"] = True
        notes_for_model.append(entry)
        citations.append(cite(cand.note_id, title, entry["excerpts"][0] if entry["excerpts"] else "", entry["tags"]))

    data: dict[str, Any] = {"notes": notes_for_model}
    if not notes_for_model:
        data["note"] = "No notes matched."
    if meaning_failed:
        data["meaningSearchUnavailable"] = True
    if any(n.get("unsavedChanges") for n in notes_for_model):
        data["unsavedNote"] = "Excerpts come from the saved text; call get_note for the version the user sees."
    count = len(notes_for_model)
    strong = sum(1 for n in notes_for_model if n["match"] == "strong")
    return ToolResult(
        ok=True,
        data=data,
        summary=f"{summary} -> {count} note{'s' if count != 1 else ''} ({strong} strong)",
        citations=citations,
    )


# ── get_note ────────────────────────────────────────────────────────────────

# Full content is delivered to the model up to this cap; longer notes get a
# truncated marker so the model can say so instead of pretending completeness.
MAX_FULL_NOTE_CHARS = 5000

GET_NOTE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "noteId": {
            "type": "string",
            "description": (
                "The exact note ID from a previous search_notes result or the "
                "working set. Never invent one."
            ),
        },
    },
    "required": ["noteId"],
}


async def run_get_note(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
    note_id = str(args["noteId"]).strip()
    summary = f"get_note({note_id[:8]}…)"
    payload, failure = await _call_express(ctx, "GET", f"/v1/get-note/{note_id}", summary)
    if failure:
        return failure

    note = payload.get("note")
    if not isinstance(note, dict):
        return error_result(
            "invalid_response", "Backend returned a note payload in an unexpected shape.",
            recoverable=False, summary=f"{summary} -> invalid response",
        )
    note, unsaved = with_unsaved(ctx, note)
    ctx.read_note_ids.add(note_id)

    title = str(note.get("title", "") or "")
    content = str(note.get("content", "") or "")
    truncated = len(content) > MAX_FULL_NOTE_CHARS
    return ToolResult(
        ok=True,
        data={
            "note": {
                "noteId": str(note.get("_id", note_id)),
                "title": title,
                "content": content[:MAX_FULL_NOTE_CHARS],
                "contentTruncated": truncated,
                "tags": note.get("tags", []),
                "isChecklist": bool(note.get("isChecklist", False)),
                "checklist": note.get("checklist", []),
                **({"unsavedChanges": True} if unsaved else {}),
            }
        },
        summary=f"{summary} -> \"{title[:40]}\"{' (unsaved version)' if unsaved else ''}{' (truncated)' if truncated else ''}",
        citations=[cite(str(note.get("_id", note_id)), title, card_text(note), note.get("tags"))],
    )


# ── list_folders ────────────────────────────────────────────────────────────

LIST_FOLDERS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {},
    "required": [],
}


async def run_list_folders(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
    summary = "list_folders()"
    payload, failure = await _call_express(ctx, "GET", "/v1/get-folders", summary)
    if failure:
        return failure

    folders = payload.get("folders", [])
    flat: list[dict[str, Any]] = []
    for folder in folders:
        flat.append(
            {
                "folderId": str(folder.get("_id", "")),
                "name": str(folder.get("name", "") or ""),
                "parentId": str(folder["parentId"]) if folder.get("parentId") else None,
                "icon": folder.get("icon", ""),
            }
        )
    return ToolResult(
        ok=True,
        data={"folders": flat},
        summary=f"{summary} -> {len(flat)} folder{'s' if len(flat) != 1 else ''}",
    )


# ── summarize_notes ─────────────────────────────────────────────────────────

SUMMARIZE_MAX_NOTES = 5

SUMMARIZE_NOTES_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "noteIds": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                f"1-{SUMMARIZE_MAX_NOTES} note IDs from earlier tool results. "
                "Never invent IDs."
            ),
        },
    },
    "required": ["noteIds"],
}


async def _fetch_and_summarize_one(
    ctx: ToolContext, note_id: str
) -> tuple[dict[str, Any], Citation | None, str | None]:
    """Returns (model_entry, citation, error_note). Called concurrently."""
    payload, failure = await _call_express(ctx, "GET", f"/v1/get-note/{note_id}", "summarize fetch")
    if failure or not isinstance(payload.get("note"), dict):
        reason = failure.error.message if failure and failure.error else "bad payload"
        return {"noteId": note_id, "error": reason}, None, f"{note_id}: {reason}"

    note, _ = with_unsaved(ctx, payload["note"])
    title = str(note.get("title", "") or "")
    text = str(note.get("content", "") or "").strip()
    citation = cite(note_id, title, card_text(note), note.get("tags"))

    if len(text) < 50:
        return (
            {"noteId": note_id, "title": title, "summary": "(too short to summarize)"},
            citation,
            None,
        )

    summary_payload, failure = await _call_express(
        ctx, "POST", "/v1/summarize-note", "summarize", json={"text": text[:MAX_FULL_NOTE_CHARS]}
    )
    if failure:
        reason = failure.error.message if failure.error else "summarize failed"
        return {"noteId": note_id, "title": title, "error": reason}, citation, f"{title}: {reason}"

    return (
        {"noteId": note_id, "title": title, "summary": str(summary_payload.get("summary", ""))},
        citation,
        None,
    )


async def run_summarize_notes(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
    note_ids = [str(nid).strip() for nid in args["noteIds"]][:SUMMARIZE_MAX_NOTES]
    summary = f"summarize_notes({len(note_ids)} notes)"

    if not note_ids:
        return error_result(
            "invalid_args", "noteIds must not be empty.",
            recoverable=True, summary=f"{summary} -> empty",
        )

    results = await asyncio.gather(
        *(_fetch_and_summarize_one(ctx, nid) for nid in note_ids)
    )
    entries = [r[0] for r in results]
    citations = [r[1] for r in results if r[1] is not None]
    failures = [r[2] for r in results if r[2] is not None]

    succeeded = len([e for e in entries if "summary" in e])
    return ToolResult(
        ok=succeeded > 0 or not failures,
        data={"summaries": entries},
        summary=f"{summary} -> {succeeded} summarized, {len(failures)} failed",
        citations=citations,
    )


# ── list_notes ─────────────────────────────────────────────────────────────

# Listing answers metadata questions that semantic search cannot express:
# "archived notes", "notes in folder X (incl. subfolders)", "tagged Y",
# "untitled drafts". Usage counts are intentionally small.
LIST_NOTES_LIMIT_MAX = 20
LIST_EXCERPT_CHARS = 150

LIST_NOTES_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "archived": {
            "type": "boolean",
            "description": "true = only archived notes. Omit for active notes.",
        },
        "folderId": {
            "type": "string",
            "description": (
                "Only notes inside this folder AND its subfolders. Get IDs from "
                "list_folders first. Never invent one."
            ),
        },
        "tag": {
            "type": "string",
            "description": "Only notes having this tag (without the '#').",
        },
        "untitled": {
            "type": "boolean",
            "description": "true = only notes with an empty title (drafts).",
        },
        "limit": {
            "type": "integer",
            "description": "Max notes to return (1-20). Default 10.",
        },
    },
    "required": [],
}


def _build_folder_index(folders: list[dict[str, Any]]) -> dict[str | None, list[str]]:
    children: dict[str | None, list[str]] = {}
    for folder in folders:
        parent = str(folder["parentId"]) if folder.get("parentId") else None
        children.setdefault(parent, []).append(str(folder.get("_id", "")))
    return children


def _folder_subtree_ids(children: dict[str | None, list[str]], root_id: str) -> list[str]:
    ids: list[str] = []
    stack = [root_id]
    while stack:
        current = stack.pop()
        ids.append(current)
        stack.extend(children.get(current, []))
    return ids


def _compact_listing(ctx: ToolContext, note: dict[str, Any]) -> dict[str, Any]:
    note, unsaved = with_unsaved(ctx, note)
    return {
        "noteId": str(note.get("_id", "")),
        "title": str(note.get("title", "") or ""),
        "tags": note.get("tags", []),
        "excerpt": str(note.get("content", "") or "")[:LIST_EXCERPT_CHARS],
        **({"unsavedChanges": True} if unsaved else {}),
    }


async def run_list_notes(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
    filter_bits = [k for k, v in args.items() if v not in (None, False, "")]
    summary = f"list_notes({', '.join(filter_bits) or 'all'})"

    if args.get("folderId"):
        # Resolve the folder subtree first so listing covers subfolders too.
        folders_payload, failure = await _call_express(ctx, "GET", "/v1/get-folders", summary)
        if failure:
            return failure
        folders = folders_payload.get("folders", [])
        children = _build_folder_index(folders)
        folder_ids = [str(f.get("_id", "")) for f in folders]
        root = str(args["folderId"])
        if root not in folder_ids:
            return error_result(
                "invalid_args",
                "That folder ID does not exist. Call list_folders to get real folder IDs.",
                recoverable=True,
                summary=f"{summary} -> unknown folder",
            )
        subtree = _folder_subtree_ids(children, root)
        payload, failure = await _call_express(
            ctx, "GET", "/v1/get-folder-notes", summary,
            params={"folderIds": ",".join(subtree)},
        )
    elif args.get("archived"):
        payload, failure = await _call_express(ctx, "GET", "/v1/get-all-archived-notes", summary)
    else:
        payload, failure = await _call_express(ctx, "GET", "/v1/get-all-notes", summary)
    if failure:
        return failure

    # Filter on what the user sees: unsaved titles/tags count.
    notes = [with_unsaved(ctx, n)[0] for n in payload.get("notes", [])]
    if args.get("tag"):
        wanted = str(args["tag"]).strip().lower()
        notes = [n for n in notes if any(str(t).lower() == wanted for t in n.get("tags", []))]
    if args.get("untitled"):
        notes = [n for n in notes if not str(n.get("title", "") or "").strip()]

    try:
        limit = int(args.get("limit", 10))
    except (TypeError, ValueError):
        limit = 10
    limit = max(1, min(LIST_NOTES_LIMIT_MAX, limit))
    total = len(notes)
    notes = notes[:limit]

    citations = [
        cite(str(n.get("_id", "")), str(n.get("title", "") or ""), card_text(n), n.get("tags"))
        for n in notes
    ]
    return ToolResult(
        ok=True,
        data={
            "notes": [_compact_listing(ctx, n) for n in notes],
            "totalMatched": total,
            "truncated": total > len(notes),
        },
        summary=f"{summary} -> {len(notes)} of {total} note{'s' if total != 1 else ''}",
        citations=citations,
    )


# ── draft lane (Phase B): propose writes as unsaved dock drafts ─────────────
#
# These tools NEVER call a write endpoint. Validation happens here (against
# real backend state where needed); the proposal travels back to the browser
# and becomes an unsaved tab. Only the user's own save commits anything.

DRAFT_TITLE_MAX = 500
DRAFT_CONTENT_MAX = 20_000
DRAFT_TAGS_MAX = 10
DRAFT_TAG_MAX_LEN = 50
DRAFT_CHECKLIST_ITEMS_MAX = 100


def _clean_text_fields(args: dict[str, Any], name: str) -> tuple[dict[str, Any] | None, ToolResult | None, str | None]:
    """Trim + cap user-visible fields; returns (cleaned, errorResult, None)."""
    cleaned: dict[str, Any] = {}
    if "title" in args and args["title"] is not None:
        title = str(args["title"]).strip()[:DRAFT_TITLE_MAX]
        cleaned["title"] = title
    if "content" in args and args["content"] is not None:
        content = str(args["content"])[:DRAFT_CONTENT_MAX]
        cleaned["content"] = content
    if "tags" in args and args["tags"] is not None:
        tags = []
        for raw in args["tags"]:
            tag = str(raw).strip()[:DRAFT_TAG_MAX_LEN]
            if tag and tag not in tags:
                tags.append(tag)
        cleaned["tags"] = tags[:DRAFT_TAGS_MAX]
    if "isChecklist" in args and args["isChecklist"] is not None:
        cleaned["isChecklist"] = bool(args["isChecklist"])
    if "checklist" in args and args["checklist"] is not None:
        items = []
        for raw in args["checklist"][:DRAFT_CHECKLIST_ITEMS_MAX]:
            if not isinstance(raw, dict):
                return None, None, f"{name}: checklist items must be objects"
            text = str(raw.get("text", "")).strip()
            if not text:
                continue
            items.append({"text": text, "completed": bool(raw.get("completed", False))})
        cleaned["checklist"] = items
    return cleaned, None, None


NOTE_DRAFT_PROPERTIES: dict[str, Any] = {
    "title": {"type": "string", "description": "Note title (max 500 chars)."},
    "content": {"type": "string", "description": "Full note body (max 20000 chars)."},
    "tags": {"type": "array", "items": {"type": "string"}, "description": "Max 10 tags."},
    "isChecklist": {"type": "boolean", "description": "true to make the note a checklist."},
    "checklist": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "completed": {"type": "boolean"},
            },
            "required": ["text"],
        },
        "description": "Checklist items; only meaningful when isChecklist is true.",
    },
}

DRAFT_NOTE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        **NOTE_DRAFT_PROPERTIES,
        "folderId": {
            "type": "string",
            "description": "Folder ID from list_folders; omit for the home dashboard.",
        },
    },
    "required": ["title", "content"],
}


async def run_draft_note(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
    cleaned, _, err = _clean_text_fields(args, "draft_note")
    if err:
        return error_result("invalid_args", err, recoverable=True, summary="draft_note -> invalid args")
    title = cleaned.get("title", "")
    content = cleaned.get("content", "")
    if not title and not content.strip():
        return error_result(
            "invalid_args", "A draft needs at least a title or content.",
            recoverable=True, summary="draft_note -> empty draft",
        )

    folder_id = args.get("folderId")
    summary = f'draft_note("{title[:30] or "untitled"}")'
    if folder_id:
        folder_id = str(folder_id).strip()
        folders_payload, failure = await _call_express(ctx, "GET", "/v1/get-folders", summary)
        if failure:
            return failure
        known = {str(f.get("_id", "")) for f in folders_payload.get("folders", [])}
        if folder_id not in known:
            return error_result(
                "invalid_args",
                "That folder ID does not exist. Call list_folders for real folder IDs, or omit folderId for home.",
                recoverable=True, summary=f"{summary} -> unknown folder",
            )
    else:
        folder_id = None

    draft = AgentDraft(
        action="create",
        title=title,
        content=cleaned.get("content", ""),
        tags=cleaned.get("tags", []),
        isChecklist=bool(cleaned.get("isChecklist", False)),
        checklist=cleaned.get("checklist", []),
        folderId=folder_id,
    )
    return ToolResult(
        ok=True,
        data={"staged": True, "note": "The draft is staged in the user's dock for their review; nothing is saved yet."},
        summary=f"{summary} -> staged for review",
        drafts=[draft],
    )


STAGE_NOTE_EDIT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "noteId": {
            "type": "string",
            "description": "Exact note ID from an earlier tool result. Never invent one.",
        },
        **NOTE_DRAFT_PROPERTIES,
    },
    "required": ["noteId"],
}


async def run_stage_note_edit(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
    note_id = str(args["noteId"]).strip()
    summary = f"stage_note_edit({note_id[:8]}…)"

    cleaned, _, err = _clean_text_fields(args, "stage_note_edit")
    if err:
        return error_result("invalid_args", err, recoverable=True, summary=f"{summary} -> invalid args")
    changes = {k: v for k, v in cleaned.items() if v is not None}
    if not changes:
        return error_result(
            "invalid_args", "No changes proposed — provide at least one field to change.",
            recoverable=True, summary=f"{summary} -> no changes",
        )
    # A text or checklist rewrite replaces the whole body, so it must be built
    # on the note as it is now (unsaved changes included), not from memory of
    # an earlier turn — that silently dropped a user's unsaved line in testing.
    if ("content" in changes or "checklist" in changes) and note_id not in ctx.read_note_ids:
        return error_result(
            "read_first",
            "Read this note with get_note first (in this turn) and build the new "
            "content from its current text — it may have changed or have unsaved edits.",
            recoverable=True, summary=f"{summary} -> must read the note first",
        )

    payload, failure = await _call_express(ctx, "GET", f"/v1/get-note/{note_id}", summary)
    if failure:
        return failure
    note = payload.get("note")
    if not isinstance(note, dict):
        return error_result("invalid_response", "Unexpected note payload.", recoverable=False, summary=f"{summary} -> invalid response")
    # Edit what the user sees: their unsaved tab version when there is one.
    note, unsaved = with_unsaved(ctx, note)

    title = str(note.get("title", "") or "")
    # Drop no-op changes so the diff the user reviews is honest.
    effective: dict[str, Any] = {}
    for key, value in changes.items():
        current = note.get(key)
        if key == "folderId":
            continue  # moving notes is a Phase C (bulk) action, not a draft edit
        if value != current:
            effective[key] = value
    if not effective:
        return error_result(
            "no_changes", "The note already matches everything you proposed.",
            recoverable=False, summary=f"{summary} -> nothing to change",
        )

    draft = AgentDraft(action="edit", noteId=note_id, basedOnUnsaved=unsaved, **effective)
    staged_note = (
        "The note has unsaved changes open in the user's editor, so the edit was "
        "made on that version and the user will be asked to Apply or Skip it. "
        "Nothing is saved yet."
        if unsaved else
        "Staged in the user's dock for review; nothing is saved yet."
    )
    return ToolResult(
        ok=True,
        data={"staged": True, "changedFields": sorted(effective.keys()), "note": staged_note},
        summary=f"{summary} -> staged ({', '.join(sorted(effective.keys()))}){' on unsaved version' if unsaved else ''}",
        citations=[cite(note_id, title, card_text(note), note.get("tags"))],
        drafts=[draft],
    )


# ── list_tags ───────────────────────────────────────────────────────────────

# Enough for any real tag list; the reply says how many were left out if not.
MAX_TAGS_RETURNED = 200

LIST_TAGS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "includeArchived": {
            "type": "boolean",
            "description": "Also count tags on archived notes. Default true.",
        },
    },
}


async def run_list_tags(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
    """Every tag in use, with note counts.

    Reads /v1/get-graph-notes (every non-trashed note's title + tags, no
    limit), so the list is complete — list_notes and search only ever see a
    capped sample. Tags differing only in letter case count as one, shown in
    their most common spelling.
    """
    include_archived = args.get("includeArchived", True) is not False
    summary = "list_tags()"
    payload, failure = await _call_express(
        ctx, "GET", "/v1/get-graph-notes", summary,
        params={"includeArchived": "true" if include_archived else "false"},
    )
    if failure:
        return failure

    notes = payload.get("notes", [])
    counts: dict[str, int] = {}
    spellings: dict[str, dict[str, int]] = {}
    untagged = 0
    for note in notes:
        tags = {str(t).strip() for t in note.get("tags") or [] if str(t).strip()}
        if not tags:
            untagged += 1
        seen: set[str] = set()
        for tag in tags:
            key = tag.casefold()
            spellings.setdefault(key, {}).setdefault(tag, 0)
            spellings[key][tag] += 1
            if key not in seen:
                seen.add(key)
                counts[key] = counts.get(key, 0) + 1

    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    tags_out = [
        {"tag": max(spellings[key].items(), key=lambda kv: kv[1])[0], "notes": count}
        for key, count in ranked[:MAX_TAGS_RETURNED]
    ]
    data: dict[str, Any] = {
        "tags": tags_out,
        "totalTags": len(ranked),
        "notesScanned": len(notes),
        "notesWithoutTags": untagged,
        "includesArchived": include_archived,
    }
    if len(ranked) > MAX_TAGS_RETURNED:
        data["omittedTags"] = len(ranked) - MAX_TAGS_RETURNED
    return ToolResult(
        ok=True,
        data=data,
        summary=f"{summary} -> {len(ranked)} tag{'s' if len(ranked) != 1 else ''} across {len(notes)} notes",
    )


# ── Registry ────────────────────────────────────────────────────────────────

Executor = Callable[[ToolContext, dict[str, Any]], Awaitable[ToolResult]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    executor: Executor


TOOLS: dict[str, ToolSpec] = {
    "search_notes": ToolSpec(
        name="search_notes",
        description=(
            "Search the user's notes by meaning, plus optional exact keywords. "
            "Returns the best-matching notes with the passages that matched, "
            "labelled match: strong or partial (partial = loosely related; say "
            "so or leave it out) and how they matched. This is the ONLY way to "
            "learn what is in the notes — call it before claiming anything "
            "about their contents. Use get_note when the excerpts aren't "
            "enough or moreNotShown says passages were left out."
        ),
        parameters=SEARCH_NOTES_SCHEMA,
        executor=run_search_notes,
    ),
    "get_note": ToolSpec(
        name="get_note",
        description=(
            "Fetch the full content of one specific note by ID (from a previous "
            "search_notes result or the working set). Use when excerpts are not "
            "enough to answer."
        ),
        parameters=GET_NOTE_SCHEMA,
        executor=run_get_note,
    ),
    "list_folders": ToolSpec(
        name="list_folders",
        description=(
            "List the user's note folders as a flat list with parent links. Use "
            "when the question concerns folder names, structure, or where notes "
            "are filed."
        ),
        parameters=LIST_FOLDERS_SCHEMA,
        executor=run_list_folders,
    ),
    "summarize_notes": ToolSpec(
        name="summarize_notes",
        description=(
            "Summarize 1-5 specific notes by ID (from earlier tool results). "
            "Prefer this over pasting full note text back into your reasoning."
        ),
        parameters=SUMMARIZE_NOTES_SCHEMA,
        executor=run_summarize_notes,
    ),
    "list_notes": ToolSpec(
        name="list_notes",
        description=(
            "List notes by fixed metadata filters: archived status, folder, "
            "tag, untitled drafts. Use for requests like \"list my archived "
            "notes\" or \"my notes about #react\" — semantic search cannot "
            "answer status/structure questions."
        ),
        parameters=LIST_NOTES_SCHEMA,
        executor=run_list_notes,
    ),
    "list_tags": ToolSpec(
        name="list_tags",
        description=(
            "List every tag the user has, with how many notes carry each one. "
            "Complete (covers all notes, unlike search or list_notes). Use for "
            "\"what tags do I use\", \"my most used tags\", and similar."
        ),
        parameters=LIST_TAGS_SCHEMA,
        executor=run_list_tags,
    ),
    "draft_note": ToolSpec(
        name="draft_note",
        description=(
            "Draft a NEW note and stage it in the user's editor dock for "
            "review. Nothing is saved until the user saves it themselves. Use "
            "for requests like \"create a note about X\" or \"compile these "
            "notes into a new note\"."
        ),
        parameters=DRAFT_NOTE_SCHEMA,
        executor=run_draft_note,
    ),
    "stage_note_edit": ToolSpec(
        name="stage_note_edit",
        description=(
            "Propose edits to an EXISTING note (by ID from an earlier tool "
            "result), staged in the user's dock as an unsaved draft with the "
            "changes highlighted. Never saves on its own. To change the "
            "content or checklist, first read the note with get_note in the "
            "same turn and build on its current text. To move a note to "
            "another folder, say you cannot — that is not a draft action."
        ),
        parameters=STAGE_NOTE_EDIT_SCHEMA,
        executor=run_stage_note_edit,
    ),
}


class ToolValidationError(ValueError):
    pass


def validate_args(name: str, args: Any) -> dict[str, Any]:
    """Lightweight schema enforcement before any network call happens.

    Not full JSON Schema — just enough to guarantee executors receive exactly
    what they expect: required keys present with expected types, unknown keys
    stripped. Anything stricter belongs in the schema itself.
    """
    spec = TOOLS.get(name)
    if spec is None:
        raise ToolValidationError(f"unknown tool: {name}")
    if not isinstance(args, dict):
        raise ToolValidationError(f"{name}: arguments must be an object")

    schema = spec.parameters
    cleaned: dict[str, Any] = {}
    required = schema.get("required", [])
    properties = schema.get("properties", {})

    for key in required:
        if key not in args or args[key] in (None, ""):
            raise ToolValidationError(f"{name}: missing required argument '{key}'")

    for key, value in args.items():
        prop = properties.get(key)
        if prop is None:
            continue  # strip unknown keys rather than fail
        expected = prop.get("type")
        if expected == "string" and not isinstance(value, str):
            raise ToolValidationError(f"{name}: '{key}' must be a string")
        if expected == "integer" and not isinstance(value, (int, float)):
            raise ToolValidationError(f"{name}: '{key}' must be a number")
        if expected == "array":
            if not isinstance(value, list):
                raise ToolValidationError(f"{name}: '{key}' must be an array")
            item_type = prop.get("items", {}).get("type")
            if item_type == "string" and not all(isinstance(v, str) for v in value):
                raise ToolValidationError(f"{name}: '{key}' must be an array of strings")
        if expected == "boolean" and not isinstance(value, bool):
            raise ToolValidationError(f"{name}: '{key}' must be a boolean")
        cleaned[key] = value

    # Fill simple defaults
    if name == "search_notes" and "limit" not in cleaned:
        cleaned["limit"] = 8
    return cleaned


# Bulk changes live in bulk.py (they build on the helpers above), registered
# here so the registry stays the one list of tools.
from .bulk import PROPOSE_BULK_CHANGE  # noqa: E402
from .grouping import SUGGEST_GROUPS  # noqa: E402

TOOLS[PROPOSE_BULK_CHANGE.name] = PROPOSE_BULK_CHANGE
TOOLS[SUGGEST_GROUPS.name] = SUGGEST_GROUPS
