"""Offline check of step 1a's rules: retries, the turn ceiling, step events.

Uses a fake Gemini client (no network, no quota), with the time limits shrunk
so the whole run takes a few seconds:
- 503 "high demand" is retried, then succeeds
- 429 with a short retryDelay is waited out once; with a long one it raises
  QuotaExceeded carrying Google's wait
- a model call that never answers ends the turn with the time-limit reply
  instead of hanging
- a normal tool round emits readable step labels
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from google.genai import errors as genai_errors
from google.genai import types

import agent.loop as loop
import agent.model_calls as model_calls
from agent.model_calls import CallDeadlineExceeded, QuotaExceeded, generate_with_retries
from agent.schemas import Citation, ToolResult
from agent.tools import TOOLS, ToolContext, ToolSpec

# Shrink the waits so the test runs in seconds.
model_calls.OVERLOAD_RETRY_DELAYS = (0.05, 0.1)
model_calls.MIN_CALL_SECONDS = 0.2
loop.MIN_CALL_SECONDS = 0.2

FAKE_NOTE_ID = "0123456789abcdef01234567"


def quota_error(delay: str) -> genai_errors.ClientError:
    return genai_errors.ClientError(429, {"error": {
        "code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota",
        "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay}],
    }})


def overload_error() -> genai_errors.ServerError:
    return genai_errors.ServerError(503, {"error": {"code": 503, "status": "UNAVAILABLE", "message": "high demand"}})


def text_response(text: str) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=[types.Part(text=text)]))])


def call_response(name: str, args: dict) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=[types.Part(
            function_call=types.FunctionCall(name=name, args=args))]))])


class FakeClient:
    """`client.aio.models.generate_content` that plays back a script: each item
    is an exception to raise, a response to return, or "hang"."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0
        self.aio = self
        self.models = self

    async def generate_content(self, **_kwargs):
        self.calls += 1
        item = self.script.pop(0)
        if item == "hang":
            await asyncio.sleep(3600)
        if isinstance(item, Exception):
            raise item
        return item


async def fake_search(ctx, args):
    return ToolResult(
        ok=True,
        data={"notes": [{"noteId": FAKE_NOTE_ID, "title": "Docker deploy notes", "excerpt": "compose"}]},
        summary="search_notes -> 1 note (stub)",
        citations=[Citation(noteId=FAKE_NOTE_ID, title="Docker deploy notes")],
    )


async def main():
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")

    # 1. 503 twice, then success.
    client = FakeClient([overload_error(), overload_error(), text_response("ok")])
    response = await generate_with_retries(client, deadline=time.monotonic() + 5, model="m", contents=[])
    check("503 retried twice then succeeded", response.text == "ok" and client.calls == 3)

    # 2. 503 three times → gives up with the original error.
    client = FakeClient([overload_error(), overload_error(), overload_error()])
    try:
        await generate_with_retries(client, deadline=time.monotonic() + 5, model="m", contents=[])
        check("503 gives up after 2 retries", False)
    except genai_errors.ServerError:
        check("503 gives up after 2 retries", client.calls == 3)

    # 3. 429 with a short wait that fits → waits once, then succeeds.
    client = FakeClient([quota_error("0.3s"), text_response("ok")])
    start = time.monotonic()
    response = await generate_with_retries(client, deadline=time.monotonic() + 5, model="m", contents=[])
    waited = time.monotonic() - start
    check("429 short wait honoured", response.text == "ok" and waited >= 0.3, f"waited {waited:.2f}s")

    # 4. 429 whose wait doesn't fit → QuotaExceeded with Google's wait, no sleep.
    client = FakeClient([quota_error("40s")])
    start = time.monotonic()
    try:
        await generate_with_retries(client, deadline=time.monotonic() + 5, model="m", contents=[])
        check("429 long wait → QuotaExceeded", False)
    except QuotaExceeded as exc:
        check("429 long wait → QuotaExceeded", exc.retry_after_seconds == 40 and time.monotonic() - start < 0.5,
              f"retry_after={exc.retry_after_seconds}")

    # 5. A call that never answers → CallDeadlineExceeded at the deadline.
    client = FakeClient(["hang"])
    start = time.monotonic()
    try:
        await generate_with_retries(client, deadline=time.monotonic() + 0.5, model="m", contents=[])
        check("hanging call stops at the deadline", False)
    except CallDeadlineExceeded:
        check("hanging call stops at the deadline", time.monotonic() - start < 1.0)

    ctx = ToolContext(user_id="offline", auth_header="Bearer fake", express_base_url="")
    real_search = TOOLS["search_notes"]
    TOOLS["search_notes"] = ToolSpec(
        name=real_search.name, description=real_search.description,
        parameters=real_search.parameters, executor=fake_search,
    )
    loop.TURN_CEILING_SECONDS = 2.0
    loop.FINAL_RESERVE_SECONDS = 0.8

    # 6. Turn: the tool phase hangs, the final pass hangs too → time-limit reply.
    steps = []

    async def on_step(label):
        steps.append(label)

    client = FakeClient(["hang", "hang"])
    start = time.monotonic()
    result = await loop.run_agent_turn(
        gemini_client=client, message="hi", history=[], working_set=[],
        tool_context=ctx, on_step=on_step,
    )
    elapsed = time.monotonic() - start
    check("hung turn ends by the ceiling with the time-limit reply",
          result.message == loop.TIME_LIMIT_MESSAGE and elapsed < 2.5, f"{elapsed:.2f}s, steps={steps}")

    # 7. Turn: a tool round, then the answer → readable step labels.
    steps.clear()
    loop.TURN_CEILING_SECONDS = 10.0
    loop.FINAL_RESERVE_SECONDS = 2.0
    client = FakeClient([call_response("search_notes", {"query": "docker setup"}), text_response("Here you go.")])
    result = await loop.run_agent_turn(
        gemini_client=client, message="docker?", history=[], working_set=[],
        tool_context=ctx, on_step=on_step,
    )
    expected = ["Thinking…", "Searching your notes for “docker setup”", "Reviewing what I found…"]
    check("step labels for a tool round", steps == expected and result.message == "Here you go.", str(steps))

    # 8. Turn: quota exhausted mid-turn → QuotaExceeded reaches the caller.
    client = FakeClient([quota_error("40s")])
    try:
        await loop.run_agent_turn(gemini_client=client, message="hi", history=[], working_set=[], tool_context=ctx)
        check("quota mid-turn propagates", False)
    except QuotaExceeded as exc:
        check("quota mid-turn propagates", exc.retry_after_seconds == 40)

    TOOLS["search_notes"] = real_search
    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
