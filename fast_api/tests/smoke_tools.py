"""Smoke test 2: multi-tool turn with a stubbed Express HTTP layer.

Stubs agent.tools._call_express with canned route-matched payloads, then asks a
question designed to make the model chain tools (search -> fetch -> summarize).
Validates executor parsing, per-tool validation, and citation flow.
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
from agent.schemas import Citation, ToolError, ToolResult
from agent.tools import ToolContext, validate_args

NOTE_A = "0123456789abcdef01234567"
NOTE_B = "0123456789abcdef01234568"
LONG_TEXT = ("We deploy with docker compose, three services. " * 30).strip()


async def fake_call_express(ctx, method, path, summary, **kwargs):
    if path == "/v1/semantic-search":
        return {
            "answer": "preview",
            "sourceNotes": [
                {"_id": NOTE_A, "title": "Docker deploy notes", "content": LONG_TEXT[:300], "tags": ["docker"]},
                {"_id": NOTE_B, "title": "Home server", "content": "Runs the backups.", "tags": ["infra"]},
            ],
        }, None
    if path.startswith("/v1/get-note/"):
        nid = path.rsplit("/", 1)[-1]
        if nid == NOTE_A:
            return {"note": {"_id": NOTE_A, "title": "Docker deploy notes", "content": LONG_TEXT, "tags": ["docker"], "isChecklist": False, "checklist": []}}, None
        return {"note": {"_id": nid, "title": "Other note", "content": "Short.", "tags": [], "isChecklist": False, "checklist": []}}, None
    if path == "/v1/get-folders":
        return {"folders": [
            {"_id": "f00000000000000000000001", "name": "Dev", "parentId": None, "icon": "📁"},
            {"_id": "f00000000000000000000002", "name": "Docker", "parentId": "f00000000000000000000001", "icon": "📁"},
        ]}, None
    if path == "/v1/summarize-note":
        return {"summary": "- Compose with three services\n- Watch port 8000"}, None
    return None, tools_mod.error_result("not_found", "unknown stub path", recoverable=False, summary=summary)


async def main():
    api_key = os.getenv("GEMINI_API_KEY")
    assert api_key, "GEMINI_API_KEY missing"
    client = genai.Client(api_key=api_key)
    tools_mod._call_express = fake_call_express

    # 1. per-tool validation negatives
    try:
        validate_args("get_note", {"noteId": 123})
        print("VALIDATION get_note: FAILED (accepted non-string id)")
    except tools_mod.ToolValidationError as e:
        print(f"VALIDATION get_note: passed ({e})")
    try:
        validate_args("summarize_notes", {"noteIds": ["ok", 5]})
        print("VALIDATION summarize_notes: FAILED (accepted non-string array)")
    except tools_mod.ToolValidationError as e:
        print(f"VALIDATION summarize_notes: passed ({e})")

    # 2. executor-level parse checks (no model involved)
    ctx = ToolContext(user_id="smoke2", auth_header="Bearer fake", express_base_url="http://stub")
    r1 = await tools_mod.run_get_note(ctx, {"noteId": NOTE_A})
    print(f"EXEC get_note ok={r1.ok} truncated={r1.data['note']['contentTruncated']} symbol={r1.summary}")
    r2 = await tools_mod.run_list_folders(ctx, {})
    print(f"EXEC list_folders ok={r2.ok} count={len(r2.data['folders'])}")
    r3 = await tools_mod.run_summarize_notes(ctx, {"noteIds": [NOTE_A, NOTE_B]})
    print(f"EXEC summarize ok={r3.ok} entries={len(r3.data['summaries'])} first={str(r3.data['summaries'][0])[:60]}")
    assert r1.ok and r2.ok and r3.ok

    # 3. live multi-tool turn
    result = await run_agent_turn(
        gemini_client=client,
        message="Find my docker deployment note, read it fully, and give me a short summary of it.",
        history=[],
        working_set=[],
        tool_context=ctx,
    )
    print(f"TOOLS USED: {[f'{t.tool} ok={t.ok} [{t.summary}]' for t in result.toolsUsed]}")
    print(f"WORKING SET: {[(c.noteId, c.title) for c in result.workingSet]}")
    print(f"MESSAGE: {result.message[:400]}")

    used = {t.tool for t in result.toolsUsed}
    all_ok = all(t.ok for t in result.toolsUsed)
    chained = "search_notes" in used and ("get_note" in used or "summarize_notes" in used)
    has_answer = bool(result.message.strip())
    print()
    print(f"chained tools: {chained} | all ok: {all_ok} | answer: {has_answer}")
    print("SMOKE TEST 2:", "PASSED" if (chained and all_ok and has_answer) else "PARTIAL — review above")


asyncio.run(main())
