"""Probe (live, not part of the agent): does Gemini's built-in Google Search
work on our model, alone and in the same request as our own tools?

Prints, per case: whether the call succeeded, whether the model searched,
the sources it cited, token usage, and the answer's start. Costs a few
requests of quota; no database access.

Usage (from fast_api/, venv): python tests/probe_web_search.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402

from agent.model_calls import AGENT_MODEL  # noqa: E402

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
QUESTION = "What is the latest stable version of Node.js, and when was it released? Answer in one sentence."

SEARCH_NOTES = types.FunctionDeclaration(
    name="search_notes",
    description="Search the user's personal notes by meaning.",
    parameters_json_schema={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
)


def report(label, build):
    print(f"\n=== {label}")
    start = time.monotonic()
    try:
        response = build()
    except Exception as exc:
        print(f"FAILED in {time.monotonic() - start:.1f}s: {type(exc).__name__}: {str(exc)[:400]}")
        return
    elapsed = time.monotonic() - start
    cand = response.candidates[0] if response.candidates else None
    meta = getattr(cand, "grounding_metadata", None) if cand else None
    queries = list(getattr(meta, "web_search_queries", None) or []) if meta else []
    chunks = list(getattr(meta, "grounding_chunks", None) or []) if meta else []
    calls = [p.function_call.name for p in (cand.content.parts if cand and cand.content and cand.content.parts else []) if p.function_call]
    usage = response.usage_metadata
    print(f"ok in {elapsed:.1f}s | searched: {bool(queries)} {queries[:3]} | function calls: {calls}")
    for c in chunks[:4]:
        web = getattr(c, "web", None)
        if web:
            print(f"  source: {getattr(web, 'title', '')} — {str(getattr(web, 'uri', ''))[:80]}")
    if usage:
        print(f"  tokens: prompt {usage.prompt_token_count}, output {usage.candidates_token_count}, "
              f"tool-use prompt {getattr(usage, 'tool_use_prompt_token_count', None)}, total {usage.total_token_count}")
    text = (response.text or "").strip().replace("\n", " ")
    print(f"  answer: {text[:300]}")


google_search = types.Tool(google_search=types.GoogleSearch())

report("1. Google Search alone", lambda: client.models.generate_content(
    model=AGENT_MODEL, contents=QUESTION, config=types.GenerateContentConfig(tools=[google_search])))
time.sleep(10)

report("2. Google Search + our function tool, a web question", lambda: client.models.generate_content(
    model=AGENT_MODEL, contents=QUESTION,
    config=types.GenerateContentConfig(tools=[google_search, types.Tool(function_declarations=[SEARCH_NOTES])])))
time.sleep(10)

report("3. Google Search + our function tool, a notes question", lambda: client.models.generate_content(
    model=AGENT_MODEL, contents="What did I write in my notes about docker compose?",
    config=types.GenerateContentConfig(tools=[google_search, types.Tool(function_declarations=[SEARCH_NOTES])])))
time.sleep(10)

report("4. Same as 2, with server-side tool invocations enabled", lambda: client.models.generate_content(
    model=AGENT_MODEL, contents=QUESTION,
    config=types.GenerateContentConfig(
        tools=[google_search, types.Tool(function_declarations=[SEARCH_NOTES])],
        tool_config=types.ToolConfig(include_server_side_tool_invocations=True),
    )))
