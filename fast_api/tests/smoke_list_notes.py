"""Smoke test 3: list_notes filters + ID-leak stripping.

Replays the user's real failing conversation ("show me some archive notes")
with a stubbed Express layer, and unit-tests the message sanitizer.
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
from agent.loop import _sanitize_message
from agent.schemas import Citation, ToolResult
from agent.tools import ToolContext, validate_args

ARCH_1 = "0123456789abcdef01234570"
ARCH_2 = "0123456789abcdef01234571"


# Step 2a: search = a meaning search (faked here, finds nothing) + /v1/agent/search-support.
async def fake_meaning(query, user_id, limit):
    return []


async def fake_call_express(ctx, method, path, summary, **kwargs):
    if path == "/v1/get-all-archived-notes":
        return {"notes": [
            {"_id": ARCH_1, "title": "Old trip plan", "content": "Goa in December, kep it cheap", "tags": ["travel"], "folderId": None, "updatedAt": "2025-01-01"},
            {"_id": ARCH_2, "title": "Banking info reference", "content": "IFSC etc", "tags": [], "folderId": None, "updatedAt": "2025-02-01"},
        ]}, None
    if path == "/v1/agent/search-support":
        return {"notes": {}, "keywordHits": []}, None
    if path == "/v1/get-folders":
        return {"folders": []}, None
    return None, tools_mod.error_result("not_found", f"unexpected stub path: {path}", recoverable=False, summary=summary)


async def main():
    print("--- sanitizer unit checks ---")
    cases = [
        ('note "Git tips" (ID: 6a48b75c6bd9bef442d46ba2): stuff', None, 'ID:'),
        ('The note ID 6a48b75c6bd9bef442d46ba2 is archived.', None, 'ID 6a48'),
        ('id: 6a48b75c6bd9bef442d46ba2.', None, '6a48b75c'),
    ]
    sanitizer_ok = True
    for text, _, forbidden in cases:
        out = _sanitize_message(text)
        leaked = forbidden in out
        sanitizer_ok = sanitizer_ok and not leaked
        print(f"  '{text[:40]}...' -> '{out[:60]}' {'OK' if not leaked else 'LEAKED!'}")
    # normal text unscathed
    normal = _sanitize_message("Version 20240101a1 stays, order #1234 too.")
    print(f"  prose untouched: {'OK' if '20240101a1' in normal else 'MANGLED!'}")
    print(f"sanitizer: {'OK' if sanitizer_ok else 'FAILED'}")

    # executor: archived filter path (no model call)
    tools_mod._call_express = fake_call_express
    ctx = ToolContext(user_id="smoke3", auth_header="Bearer fake", express_base_url="http://stub", meaning_search=fake_meaning)
    r = await tools_mod.run_list_notes(ctx, {"archived": True, "limit": 10})
    assert r.ok and len(r.data["notes"]) == 2, f"executor failed: {r.summary}"
    print(f"executor archived path: OK ({r.summary})")

    # executor: unknown folder is a recoverable hint for the model
    r2 = await tools_mod.run_list_notes(ctx, {"folderId": "f" * 24})
    assert not r2.ok and r2.error and r2.error.recoverable
    print(f"executor unknown-folder hint: OK ({r2.summary})")

    # validation: wrong types rejected
    try:
        validate_args("list_notes", {"archived": "yes"})
        print("VALIDATION list_notes: FAILED (accepted string bool)")
    except tools_mod.ToolValidationError:
        print("VALIDATION list_notes: passed")

    # live turn: replay the user's failing prompt
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    result = await run_agent_turn(
        gemini_client=client,
        message="show me some archive notes",
        history=[],
        working_set=[],
        tool_context=ctx,
    )
    print(f"TOOLS USED: {[f'{t.tool}[{t.summary}]' for t in result.toolsUsed]}")
    print(f"MESSAGE: {result.message[:300]}")
    used_list = any(t.tool == "list_notes" for t in result.toolsUsed)
    ids_leaked = ARCH_1 in result.message or ARCH_2 in result.message
    named = "Old trip plan" in result.message or "Banking" in result.message
    print(f"used list_notes: {used_list} | ids in prose: {ids_leaked} | titles named: {named}")
    print("SMOKE TEST 3:", "PASSED" if (used_list and not ids_leaked and named and sanitizer_ok) else "PARTIAL — review above")


asyncio.run(main())
