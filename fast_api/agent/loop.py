"""The turn loop: Gemini function-calling with a deterministic shell around it.

Contract (from agent-architecture-plan.md §3, halt rules):
- the model picks from the tool menu; this module validates and executes
- a failed/empty tool call is reported back ONCE for a self-retry, then halts
- the iteration cap always ends with a forced finalization so the user gets a
  reply, never a dead spinner
"""
import asyncio
import os
import re
from typing import Any

from google import genai
from google.genai import types

from .memory import merge_working_set, trim_history
from .prompts import SYSTEM_INSTRUCTION, build_contents
from .schemas import (
    AgentChatResponse,
    AgentDraft,
    Citation,
    HistoryTurn,
    ToolCallRecord,
    ToolError,
    ToolResult,
)
from .tools import TOOLS, ToolContext, ToolValidationError, validate_args

MAX_ITERATIONS = 4
MAX_DRAFTS_PER_TURN = 5
# Mirrors main.py's GEMINI_MODEL (gemini-3.1-flash-lite). Kept env-overridable.
AGENT_MODEL = os.getenv("AGENT_MODEL", "gemini-3.1-flash-lite")

FALLBACK_MESSAGE = (
    "I hit a problem while working on that and had to stop partway. "
    "Nothing was changed in your notes. Could you try rephrasing or asking "
    "again?"
)


def _function_declarations() -> list[types.FunctionDeclaration]:
    return [
        types.FunctionDeclaration(
            name=spec.name,
            description=spec.description,
            parameters=spec.parameters,
        )
        for spec in TOOLS.values()
    ]


async def _execute_tool_call(
    ctx: ToolContext, name: str, raw_args: Any
) -> ToolResult:
    try:
        args = validate_args(name, raw_args)
    except ToolValidationError as exc:
        # Recoverable: the model gets one chance to fix its own call.
        return ToolResult(
            ok=False,
            error=ToolError(code="invalid_args", message=str(exc), recoverable=True),
            summary=f"{name} -> invalid arguments",
        )
    return await TOOLS[name].executor(ctx, args)


_FALLBACK_PAREN_ID = re.compile(r"\s*\(\s*ID[:#]?\s*[0-9a-fA-F]{24}\s*\)")
_FALLBACK_INLINE_ID = re.compile(r"\bID[:#]?\s*[0-9a-fA-F]{24}\b,?")
_FALLBACK_BARE_ID = re.compile(r"(?<![0-9a-zA-Z])[0-9a-f]{24}(?![0-9a-zA-Z])")


def _sanitize_message(text: str) -> str:
    """Deterministically strip raw note/folder IDs from the final answer.

    The prompt tells the model to use titles; this is the harness guarantee for
    when it doesn't. Prose like "(ID: 6a48b75c...)" or bare 24-hex tokens never
    reach the UI.
    """
    cleaned = _FALLBACK_PAREN_ID.sub("", text)
    cleaned = _FALLBACK_INLINE_ID.sub("", cleaned)
    cleaned = _FALLBACK_BARE_ID.sub("(some note)", cleaned)
    # Collapse artifacts: double spaces, space-before-punctuation, empty parens
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" +([.,;:!?])", r"\1", cleaned)
    return cleaned.strip()


def _merge_drafts(existing: list[AgentDraft], incoming: list[AgentDraft]) -> list[AgentDraft]:
    """One draft per target note (latest wins for edits), capped per turn."""
    merged = list(existing)
    for draft in incoming:
        if draft.action == "edit" and draft.noteId:
            merged = [
                d for d in merged
                if not (d.action == "edit" and d.noteId == draft.noteId)
            ]
        merged.append(draft)
    return merged[:MAX_DRAFTS_PER_TURN]


async def run_agent_turn(
    *,
    gemini_client: genai.Client,
    message: str,
    history: list[HistoryTurn],
    working_set: list[Citation],
    tool_context: ToolContext,
) -> AgentChatResponse:
    history = trim_history(history)
    contents = build_contents(message, history, working_set)

    tools_config = types.GenerateContentConfig(
        tools=[types.Tool(function_declarations=_function_declarations())],
        system_instruction=SYSTEM_INSTRUCTION,
        temperature=0.4,
    )
    finalize_config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        temperature=0.4,
    )

    tools_used: list[ToolCallRecord] = []
    citations: list[Citation] = []
    drafts: list[AgentDraft] = []
    # (tool name, args snapshot) → retry count, to break self-fix loops.
    retry_count: dict[str, int] = {}

    for iteration in range(MAX_ITERATIONS):
        try:
            response = await asyncio.to_thread(
                gemini_client.models.generate_content,
                model=AGENT_MODEL,
                contents=contents,
                config=tools_config,
            )
        except Exception as exc:
            print(f"Agent model call failed (iteration {iteration}): {exc}")
            # Even on failure, keep evidence of tools that already ran so the
            # UI/logs can show partial progress.
            return AgentChatResponse(
                message=FALLBACK_MESSAGE,
                citations=citations,
                workingSet=merge_working_set(working_set, citations),
                toolsUsed=tools_used,
                drafts=drafts,
            )

        candidate = response.candidates[0] if response.candidates else None
        content = candidate.content if candidate else None
        parts = list(content.parts) if content and content.parts else []

        function_calls = [p.function_call for p in parts if getattr(p, "function_call", None)]
        text_parts = [p.text for p in parts if getattr(p, "text", None)]

        # No tool requests → this is the final answer turn.
        if not function_calls:
            final_text = "\n".join(text_parts).strip() or FALLBACK_MESSAGE
            return AgentChatResponse(
                message=_sanitize_message(final_text),
                citations=citations,
                workingSet=merge_working_set(working_set, citations),
                toolsUsed=tools_used,
                drafts=drafts,
            )

        # Echo the model's function-call turn back UNMODIFIED. Rebuilding the
        # parts would drop each call's thought_signature, which Gemini 3.x
        # requires to be present in replayed functionCall parts.
        contents.append(content)

        response_parts: list[types.Part] = []
        executed_this_round: list[ToolResult] = []
        hard_stop = False

        for fc in function_calls:
            key = f"{fc.name}:{sorted((fc.args or {}).items())}"
            if retry_count.get(key, 0) >= 2:
                # Same call failed twice already — stop rather than spin.
                result = ToolResult(
                    ok=False,
                    error=ToolError(
                        code="retry_loop",
                        message="Repeated identical failing call; aborted.",
                        recoverable=False,
                    ),
                    summary=f"{fc.name} -> aborted after repeats",
                )
            else:
                result = await _execute_tool_call(tool_context, fc.name, fc.args or {})
                if not result.ok:
                    retry_count[key] = retry_count.get(key, 0) + 1

            tools_used.append(
                ToolCallRecord(tool=fc.name, ok=result.ok, summary=result.summary or fc.name)
            )
            citations.extend(result.citations)
            drafts = _merge_drafts(drafts, result.drafts)
            executed_this_round.append(result)

            payload: dict[str, Any]
            if result.ok:
                payload = result.data
            else:
                payload = {
                    "error": result.error.code if result.error else "unknown",
                    "message": result.error.message if result.error else "",
                    "recoverable": result.error.recoverable if result.error else False,
                }
            response_parts.append(
                types.Part.from_function_response(name=fc.name, response=payload)
            )

        contents.append(types.Content(role="user", parts=response_parts))

        # Any non-recoverable failure ends the turn after this iteration's
        # results are in — the model gets one final force-answer pass below.
        hard_stop = hard_stop or any(
            not r.ok and r.error and not r.error.recoverable
            for r in executed_this_round
        )
        if hard_stop:
            break

    # Out of iterations (or hard stop): one final answer pass WITHOUT tools.
    try:
        final = await asyncio.to_thread(
            gemini_client.models.generate_content,
            model=AGENT_MODEL,
            contents=contents,
            config=finalize_config,
        )
        message_text = (final.text or "").strip() if final else ""
    except Exception as exc:
        print(f"Agent finalization call failed: {exc}")
        message_text = ""

    return AgentChatResponse(
        message=_sanitize_message(message_text) if message_text else FALLBACK_MESSAGE,
        citations=citations,
        workingSet=merge_working_set(working_set, citations),
        toolsUsed=tools_used,
        drafts=drafts,
    )
