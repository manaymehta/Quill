"""Offline check of the two fixes from the Phase 1 browser test (no network):

1. Read before rewrite: stage_note_edit refuses a content/checklist change to
   a note not read with get_note in this turn (the agent once rewrote a note
   from memory and dropped the user's unsaved line). Title/tag-only edits
   don't need a read. The loop recovers: refused → get_note → edit.
2. Citations are de-duplicated (reading then editing a note cited it twice).
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from google.genai import types

import agent.loop as loop
import agent.tools as tools
from agent.schemas import Citation
from agent.tools import ToolContext

NOTE_ID = "0123456789abcdef01234567"
SAVED = {"_id": NOTE_ID, "title": "Trip", "content": "Passport\nCharger", "tags": [], "isChecklist": False, "checklist": []}
UNSAVED = {"title": "Trip", "content": "Passport\nCharger\nMy unsaved line", "tags": [], "isChecklist": False, "checklist": []}


async def fake_call(ctx, method, path, summary, **kwargs):
    if path == f"/v1/get-note/{NOTE_ID}":
        return {"note": dict(SAVED)}, None
    return {}, None


def call_response(name: str, args: dict) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=[types.Part(
            function_call=types.FunctionCall(name=name, args=args))]))])


def text_response(text: str) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=[types.Part(text=text)]))])


class FakeClient:
    def __init__(self, script):
        self.script = list(script)
        self.aio = self
        self.models = self

    async def generate_content(self, **_kwargs):
        return self.script.pop(0)


def new_ctx() -> ToolContext:
    return ToolContext(user_id="offline", auth_header="Bearer x", express_base_url="http://x",
                       unsaved_notes={NOTE_ID: UNSAVED})


async def main():
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")

    tools._call_express = fake_call

    ctx = new_ctx()
    r = await tools.run_stage_note_edit(ctx, {"noteId": NOTE_ID, "content": "Passport\nCharger\nAgent line"})
    check("content edit without reading is refused (recoverable)",
          not r.ok and r.error.code == "read_first" and r.error.recoverable)

    r = await tools.run_stage_note_edit(ctx, {"noteId": NOTE_ID, "title": "Trip 2026"})
    check("title-only edit needs no read", r.ok and r.drafts[0].title == "Trip 2026")

    await tools.run_get_note(ctx, {"noteId": NOTE_ID})
    r = await tools.run_stage_note_edit(ctx, {"noteId": NOTE_ID, "content": UNSAVED["content"] + "\nAgent line"})
    check("after get_note the content edit is staged on the unsaved version",
          r.ok and r.drafts[0].basedOnUnsaved and "My unsaved line" in r.drafts[0].content)

    # The loop recovers from the refusal within its tool rounds.
    client = FakeClient([
        call_response("stage_note_edit", {"noteId": NOTE_ID, "content": "Passport\nCharger\nAgent line"}),
        call_response("get_note", {"noteId": NOTE_ID}),
        call_response("stage_note_edit", {"noteId": NOTE_ID, "content": UNSAVED["content"] + "\nAgent line"}),
        text_response("Staged the edit."),
    ])
    result = await loop.run_agent_turn(gemini_client=client, message="add a line", history=[],
                                       working_set=[], tool_context=new_ctx())
    sequence = [f"{t.tool}:{'ok' if t.ok else 'refused'}" for t in result.toolsUsed]
    check("loop: refused → get_note → staged",
          sequence == ["stage_note_edit:refused", "get_note:ok", "stage_note_edit:ok"]
          and len(result.drafts) == 1 and "My unsaved line" in result.drafts[0].content,
          " > ".join(sequence))
    check("citations de-duplicated (read + edit cite the note once)",
          [c.noteId for c in result.citations] == [NOTE_ID], str(result.citations))

    deduped = loop._dedupe_citations([
        Citation(noteId="a" * 24, title=""), Citation(noteId="b" * 24, title="B"), Citation(noteId="a" * 24, title="A"),
    ])
    check("dedupe keeps first-cited order and fills a blank title",
          [(c.noteId[0], c.title) for c in deduped] == [("a", "A"), ("b", "B")])

    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
