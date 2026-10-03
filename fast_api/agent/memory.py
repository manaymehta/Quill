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
    """Merge cited notes into the working set, most-recently-used first.

    Order matters: "the second one" is resolved against this list's order, so
    the newest mentions move to the front rather than the back.
    """
    by_id: dict[str, Citation] = {c.noteId: c for c in existing}
    # Reinsert existing entries so deduped order is deterministic.
    ordered = [by_id[c.noteId] for c in existing]

    for citation in newly_cited:
        current = by_id.get(citation.noteId)
        if current is not None:
            ordered.remove(current)
            # Prefer the fresh title if the old one was blank.
            by_id[citation.noteId] = (
                citation if citation.title else current
            )
        else:
            by_id[citation.noteId] = citation
        ordered.insert(0, by_id[citation.noteId])

    return ordered[:WORKING_SET_LIMIT]
