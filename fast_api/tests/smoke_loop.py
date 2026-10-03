"""Harness smoke test: real Gemini + stubbed search_notes executor.

Validates the loop's contract end-to-end without needing Express, Mongo, or a
user JWT: function-calling fires, executor results flow back, citations reach
the working set, and validation rejects bad calls.
"""
import asyncio
import os
import sys

sys.path.insert(0, r"D:\MANAY\MANAY\Code\Projects\notes_app_mern_website-agent\fast_api")
os.chdir(sys.path[0])

from dotenv import load_dotenv
load_dotenv(dotenv_path=r"D:\MANAY\MANAY\Code\Projects\notes_app_mern_website-agent\fast_api\.env")

from google import genai

from agent import run_agent_turn
from agent.schemas import Citation, ToolResult
from agent.tools import TOOLS, ToolContext, ToolSpec, validate_args

FAKE_NOTE_ID = "0123456789abcdef01234567"


async def fake_search(ctx, args):
    return ToolResult(
        ok=True,
        data={
            "notes": [{
                "noteId": FAKE_NOTE_ID,
                "title": "Docker deploy notes",
                "excerpt": "Deployment uses docker compose with three services; watch out for port collisions on 8000.",
                "tags": ["docker", "deploy"],
            }],
            "answerPreview": "",
        },
        summary=f"search_notes -> 1 note (stub)",
        citations=[Citation(noteId=FAKE_NOTE_ID, title="Docker deploy notes")],
    )


async def main():
    api_key = os.getenv("GEMINI_API_KEY")
    assert api_key, "GEMINI_API_KEY missing from fast_api/.env"
    client = genai.Client(api_key=api_key)

    # Swap in the stub executor (same spec, fake data).
    real = TOOLS["search_notes"]
    TOOLS["search_notes"] = ToolSpec(
        name=real.name, description=real.description,
        parameters=real.parameters, executor=fake_search,
    )

    ctx = ToolContext(user_id="smoketest", auth_header="Bearer fake", express_base_url="")

    # 1. validation negative test (no model call)
    try:
        validate_args("search_notes", {"limit": 3})
        print("VALIDATION TEST: FAILED (should have raised)")
    except Exception as e:
        print(f"VALIDATION TEST: passed ({type(e).__name__}: {e})")

    # 2. live turn — should call the stubbed tool and cite the fake note
    result = await run_agent_turn(
        gemini_client=client,
        message="What do my notes say about how I deploy with docker?",
        history=[],
        working_set=[],
        tool_context=ctx,
    )

    print(f"TOOLS USED: {[f'{t.tool} ok={t.ok} [{t.summary}]' for t in result.toolsUsed]}")
    print(f"CITATIONS: {[(c.noteId, c.title) for c in result.citations]}")
    print(f"WORKING SET: {[(c.noteId, c.title) for c in result.workingSet]}")
    print(f"MESSAGE: {result.message[:400]}")

    called_tool = any(t.tool == "search_notes" for t in result.toolsUsed)
    cited = any(c.noteId == FAKE_NOTE_ID for c in result.citations)
    in_working_set = any(c.noteId == FAKE_NOTE_ID for c in result.workingSet)
    has_answer = bool(result.message.strip())

    print()
    print(f"tool called: {called_tool} | citation returned: {cited} | working set: {in_working_set} | answer: {has_answer}")
    if called_tool and cited and in_working_set and has_answer:
        print("SMOKE TEST: PASSED")
    else:
        print("SMOKE TEST: PARTIAL — review output above")


asyncio.run(main())
