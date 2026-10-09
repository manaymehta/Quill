"""Session memory helpers for the agent harness.

Memory here means ONLY the live conversation: which turns still count as
context, and which notes the conversation is currently "about" (the working
set, used to resolve references like "the second one"). Nothing in this module
persists anything — the frontend owns that (Phase A decision, see
agent-architecture-plan.md §5.1; Mongo persistence lands later).
"""
from .schemas import Citation, HistoryTurn

# How many past turns the model is allowed to see per request. Storage caps
# are higher (schemas.py) — this is the attention budget.
HISTORY_WINDOW = 10

# The working set is meant to be a small, current focus list, not an archive.
WORKING_SET_LIMIT = 25


def trim_history(history: list[HistoryTurn]) -> list[HistoryTurn]:
    """Keep the most recent turns; oldest context is the least useful."""
    return list(history[-HISTORY_WINDOW:])


def merge_working_set(
    existing: list[Citation], newly_cited: list[Citation]
) -> list[Citation]:
    """Merge cited notes into the working set: this turn's notes first, in the
    order they were cited, then the older entries.

    Order matters: "the second one" is resolved against this list, so this
    turn's notes keep the order the results came in (inserting them one by
    one at the front used to reverse a search's results).
    """
    by_id: dict[str, Citation] = {c.noteId: c for c in existing}
    fresh: list[Citation] = []
    seen: set[str] = set()

    for citation in newly_cited:
        if citation.noteId in seen:
            continue
        seen.add(citation.noteId)
        current = by_id.get(citation.noteId)
        # Prefer the fresh title unless it is blank.
        fresh.append(citation if citation.title or current is None else current)

    older = [c for c in existing if c.noteId not in seen]
    return (fresh + older)[:WORKING_SET_LIMIT]
