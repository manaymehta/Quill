"""Smoke test 4 (Phase B): draft lane tools + loop aggregation.

Stubs the Express HTTP layer; unit-tests draft executors (folder validation,
no-op edit detection, field cleanup) and runs a live turn instructing a draft
creation, asserting the draft surfaces in the response with the right shape.
"""
import asyncio
import os
import sys

sys.path.insert(0, r"D:\MANAY\MANAY\Code\Projects\notes_app_mern_website-agent\fast_api")
os.chdir(sys.path[0])

from dotenv import load_dotenv
load_dotenv(dotenv_path=r"D:\MANAY\MANAY\Code\Projects\notes_app_mern_website-agent\fast_api\.env")

from google import genai

import agent.tools as tools_mod
from agent import run_agent_turn
from agent.loop import _merge_drafts
from agent.schemas import AgentDraft, Citation
from agent.tools import ToolContext, validate_args

NOTE_ID = "0123456789abcdef01234572"
FOLDER_ID = "f00000000000000000000001"


# Step 2a: search = a meaning search (faked here) + /v1/agent/search-support.
async def fake_meaning(query, user_id, limit):
    return [{"noteId": NOTE_ID, "chunkIndex": 0, "text": "compose up -d", "score": 0.8, "textHash": ""}]


async def fake_call_express(ctx, method, path, summary, **kwargs):
    if path == "/v1/get-folders":
        return {"folders": [{"_id": FOLDER_ID, "name": "Dev", "parentId": None, "icon": "📁"}]}, None
    if path == f"/v1/get-note/{NOTE_ID}":
        return {"note": {
            "_id": NOTE_ID, "title": "Docker deploy", "content": "compose up -d",
            "tags": ["docker"], "isChecklist": False, "checklist": [],
        }}, None
    if path == "/v1/agent/search-support":
        return {"notes": {NOTE_ID: {"status": "ok", "title": "Docker deploy", "tags": ["docker"], "folder": None, "isArchived": False, "isChecklist": False, "lastEdited": "2026-10-01"}},
                "keywordHits": []}, None
    return None, tools_mod.error_result("not_found", f"unexpected path {path}", recoverable=False, summary=summary)


async def main():
    tools_mod._call_express = fake_call_express
    ctx = ToolContext(user_id="smoke4", auth_header="Bearer fake", express_base_url="http://stub", meaning_search=fake_meaning)

    print("--- unit: draft_note ---")
    r = await tools_mod.run_draft_note(ctx, {"title": "Deploy cheatsheet  ", "content": "compose up -d", "tags": ["docker", "docker", "  deploy "], "folderId": FOLDER_ID})
    assert r.ok and r.drafts and r.drafts[0].action == "create" and r.drafts[0].folderId == FOLDER_ID and r.drafts[0].tags == ["docker", "deploy"], r
    print(f"  valid draft staged (tags cleaned): OK -> {r.summary}")

    rb = await tools_mod.run_draft_note(ctx, {"title": "x", "content": "y", "folderId": "f" * 24})
    assert not rb.ok and rb.error.recoverable
    print(f"  unknown folderId rejected (recoverable): OK -> {rb.summary}")

    print("--- unit: stage_note_edit ---")
    # Content rewrites need the note read first in the turn (Phase 1 guard).
    await tools_mod.run_get_note(ctx, {"noteId": NOTE_ID})
    r = await tools_mod.run_stage_note_edit(ctx, {"noteId": NOTE_ID, "content": "compose up -d && profit", "tags": ["docker"]})
    assert r.ok and r.drafts[0].action == "edit" and r.drafts[0].noteId == NOTE_ID and r.drafts[0].content == "compose up -d && profit" and r.drafts[0].tags is None, r
    print(f"  real change staged, no-op tag dropped: OK -> {r.summary}")

    rn = await tools_mod.run_stage_note_edit(ctx, {"noteId": NOTE_ID, "title": "Docker deploy", "tags": ["docker"]})
    assert not rn.ok and rn.error.code == "no_changes"
    print(f"  no-op edit rejected: OK -> {rn.summary}")

    rz = await tools_mod.run_stage_note_edit(ctx, {"noteId": NOTE_ID})
    assert not rz.ok and rz.error.recoverable
    print(f"  empty edit rejected (recoverable): OK -> {rz.summary}")

    print("--- unit: draft merge/dedupe ---")
    d1 = AgentDraft(action="edit", noteId=NOTE_ID, content="v1")
    d2 = AgentDraft(action="edit", noteId=NOTE_ID, content="v2")
    merged = _merge_drafts([d1], [d2])
    assert len(merged) == 1 and merged[0].content == "v2"
    print("  last-edit-wins per noteId: OK")

    print("--- live turn: ask for a draft ---")
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    result = await run_agent_turn(
        gemini_client=client,
        message="Create a short study checklist note titled 'Docker basics' summarizing my docker deploy note, in my Dev folder.",
        history=[],
        working_set=[],
        tool_context=ctx,
    )
    print(f"TOOLS USED: {[t.summary for t in result.toolsUsed]}")
    print(f"DRAFTS: {[(d.action, d.title, d.isChecklist, d.folderId) for d in result.drafts]}")
    print(f"MESSAGE: {result.message[:250]}")
    ok = (any(d.action == 'create' for d in result.drafts)
          and bool(result.message.strip()))
    print("SMOKE TEST 4:", "PASSED" if ok else "PARTIAL — review above")


asyncio.run(main())
