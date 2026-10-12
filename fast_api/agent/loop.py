"""The turn loop: Gemini function-calling with a deterministic shell around it.

Contract (from agent-architecture-plan.md §3, halt rules):
- the model picks from the tool menu; this module validates and executes
- a failed/empty tool call is reported back ONCE for a self-retry, then halts
- the iteration cap always ends with a forced finalization so the user gets a
  reply, never a dead spinner
"""
import asyncio
import copy
import json
import re
import time
from typing import Any, Awaitable, Callable

from google import genai
from google.genai import types

from .memory import merge_working_set, trim_history
from .output_checks import check_for_leaks
from .model_calls import (
    AGENT_MODEL,
    MIN_CALL_SECONDS,
    CallDeadlineExceeded,
    QuotaExceeded,
    generate_with_retries,
)
from .prompts import SYSTEM_INSTRUCTION, build_contents
from .schemas import (
    AgentChatResponse,
    AgentScopes,
    AgentDraft,
    Citation,
    HistoryTurn,
    ToolCallRecord,
    ToolError,
    ToolResult,
)
from .tools import TOOLS, ToolContext, ToolValidationError, validate_args

MAX_ITERATIONS = 8
MAX_DRAFTS_PER_TURN = 5

# Time limits (architecture plan §2.1, D27): the whole turn ends by 60 s. The
# tool-calling phase stops early enough to leave room for the forced final
# reply, so the user always gets an answer instead of a bare error.
TURN_CEILING_SECONDS = 60.0
FINAL_RESERVE_SECONDS = 12.0

# Total input cap per turn (architecture plan §3): ~60k chars ≈ 15k tokens.
INPUT_CAP_CHARS = 60_000

StepCallback = Callable[[str], Awaitable[None]]

TIME_LIMIT_MESSAGE = (
    "That took longer than it should, so I stopped. Nothing was changed in "
    "your notes. Try again, or ask something narrower."
)

FALLBACK_MESSAGE = (
    "I hit a problem while working on that and had to stop partway. "
    "Nothing was changed in your notes. Could you try rephrasing or asking "
    "again?"
)


# Tools each permission toggle unlocks (architecture plan §5.3, D13: a
# turned-off ability's tools are absent, so the model can't call them).
COMPOSE_TOOLS = {"draft_note", "stage_note_edit"}
ORGANIZE_TOOLS = {"propose_bulk_change", "suggest_groups"}


def allowed_tool_names(scopes: AgentScopes) -> set[str]:
    names = set(TOOLS) - COMPOSE_TOOLS - ORGANIZE_TOOLS
    if scopes.compose:
        names |= COMPOSE_TOOLS
    if scopes.organize:
        names |= ORGANIZE_TOOLS
    return names


def _function_declarations(allowed: set[str] | None = None, allow_trash: bool = True) -> list[types.FunctionDeclaration]:
    declarations = []
    for spec in TOOLS.values():
        if allowed is not None and spec.name not in allowed:
            continue
        parameters = spec.parameters
        if spec.name == "propose_bulk_change" and not allow_trash:
            # Trash turned off: it isn't even an option in the action list.
            parameters = copy.deepcopy(parameters)
            action = parameters["properties"]["action"]
            action["enum"] = [a for a in action["enum"] if a != "trash"]
            action["description"] = "move | tag | archive."
        declarations.append(types.FunctionDeclaration(name=spec.name, description=spec.description, parameters=parameters))
    return declarations


def _scopes_note(scopes: AgentScopes) -> str:
    """Told to the model so it can explain a missing ability instead of guessing."""
    off = []
    if not scopes.compose:
        off.append("drafting new notes and proposing edits")
    if not scopes.organize:
        off.append("bulk changes (moving, tagging, archiving several notes)")
    elif not scopes.destructive:
        off.append("sending notes to trash")
    if not off:
        return ""
    return ("\n\nTurned off by the user in the agent settings (if asked for these, say they're turned off "
            "in the agent settings and can be switched on there): " + "; ".join(off) + ".")


async def _execute_tool_call(
    ctx: ToolContext, name: str, raw_args: Any, allowed: set[str] | None = None
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
    if allowed is not None and name not in allowed:
        return ToolResult(
            ok=False,
            error=ToolError(code="not_allowed", message="That ability is turned off in the user's agent settings.", recoverable=False),
            summary=f"{name} -> turned off in settings",
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


_STEP_TEXT_MAX = 40


def _clip(text: str) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= _STEP_TEXT_MAX else text[: _STEP_TEXT_MAX - 1] + "…"


def _step_label(name: str, args: dict[str, Any], titles: dict[str, str]) -> str:
    """Plain-language progress line for one tool call, made by code (never
    the model) from the tool name and its arguments."""
    def title_of(note_id: Any) -> str:
        return titles.get(str(note_id or "").strip(), "")

    if name == "search_notes":
        query = str(args.get("query", "")).strip()
        return f"Searching your notes for “{_clip(query)}”" if query else "Searching your notes"
    if name == "get_note":
        title = title_of(args.get("noteId"))
        return f"Reading “{_clip(title)}”" if title else "Reading a note"
    if name == "list_tags":
        return "Listing your tags"
    if name == "list_folders":
        return "Looking at your folders"
    if name == "summarize_notes":
        count = len(args.get("noteIds") or [])
        return f"Summarizing {count} note{'s' if count != 1 else ''}" if count else "Summarizing notes"
    if name == "list_notes":
        if args.get("archived"):
            return "Listing your archived notes"
        if args.get("tag"):
            return f"Listing notes tagged #{_clip(args['tag'])}"
        if args.get("untitled"):
            return "Listing your untitled notes"
        return "Listing your notes"
    if name == "draft_note":
        title = str(args.get("title", "")).strip()
        return f"Drafting “{_clip(title)}”" if title else "Drafting a new note"
    if name == "stage_note_edit":
        title = title_of(args.get("noteId"))
        return f"Preparing an edit to “{_clip(title)}”" if title else "Preparing an edit"
    if name == "suggest_groups":
        return "Grouping related notes"
    return "Working…"


async def _emit(on_step: StepCallback | None, label: str) -> None:
    # Progress lines are a courtesy: a broken listener must never break the turn.
    if on_step is None:
        return
    try:
        await on_step(label)
    except Exception as exc:
        print(f"Agent step callback failed: {exc}")


def _contents_chars(contents: list[types.Content]) -> int:
    """Rough size of what is sent to the model: text plus tool calls/results."""
    total = 0
    for content in contents:
        for part in content.parts or []:
            if getattr(part, "text", None):
                total += len(part.text)
            if getattr(part, "function_call", None):
                total += len(json.dumps(part.function_call.args or {}, default=str))
            if getattr(part, "function_response", None):
                total += len(json.dumps(part.function_response.response or {}, default=str))
    return total


def _dedupe_citations(citations: list[Citation]) -> list[Citation]:
    """One citation per note, in first-cited order (reading then editing a
    note cites it twice). Blank fields (title, snippet, tags) are filled from
    later copies, so the chat's note card gets the most complete version."""
    by_id: dict[str, Citation] = {}
    for citation in citations:
        current = by_id.get(citation.noteId)
        if current is None:
            by_id[citation.noteId] = citation
            continue
        fill = {key: getattr(citation, key) for key in ("title", "snippet", "tags")
                if not getattr(current, key) and getattr(citation, key)}
        if fill:
            by_id[citation.noteId] = current.model_copy(update=fill)
    return list(by_id.values())


def _time_limit_result(name: str) -> ToolResult:
    return ToolResult(
        ok=False,
        error=ToolError(
            code="time_limit",
            message="Ran out of time for this step; answer with what you have.",
            recoverable=False,
        ),
        summary=f"{name} -> stopped at the time limit",
    )


async def run_agent_turn(
    *,
    gemini_client: genai.Client,
    message: str,
    history: list[HistoryTurn],
    working_set: list[Citation],
    tool_context: ToolContext,
    on_step: StepCallback | None = None,
    scopes: AgentScopes | None = None,
) -> AgentChatResponse:
    """One chat turn. Raises QuotaExceeded when the API key's quota is used up
    for longer than the turn can wait — the caller tells the user how long."""
    start = time.monotonic()
    deadline = start + TURN_CEILING_SECONDS
    tools_deadline = deadline - FINAL_RESERVE_SECONDS

    scopes = scopes or AgentScopes()
    allowed = allowed_tool_names(scopes)
    system_instruction = SYSTEM_INSTRUCTION + _scopes_note(scopes)
    history = trim_history(history)
    contents = build_contents(message, history, working_set)

    tools_config = types.GenerateContentConfig(
        tools=[types.Tool(function_declarations=_function_declarations(allowed, scopes.destructive))],
        system_instruction=system_instruction,
        temperature=0.4,
    )
    # The forced final pass must produce text. Leaving the tools out is not
    # enough: with tool calls in the history the model can still answer with
    # a function call (seen Oct 2026 → empty text → the fallback message), so
    # the tools stay declared but calling them is switched off.
    finalize_config = types.GenerateContentConfig(
        tools=[types.Tool(function_declarations=_function_declarations(allowed, scopes.destructive))],
        tool_config=types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(mode=types.FunctionCallingConfigMode.NONE)
        ),
        system_instruction=system_instruction,
        temperature=0.4,
    )

    tools_used: list[ToolCallRecord] = []
    citations: list[Citation] = []
    drafts: list[AgentDraft] = []
    # The turn's bulk change, if any: a review list, split choices or group
    # suggestions (latest wins).
    bulk: dict[str, Any] = {"proposal": None, "splitChoices": None, "groupSuggestions": None}
    # (tool name, args snapshot) → retry count, to break self-fix loops.
    retry_count: dict[str, int] = {}
    # noteId → title, for readable step labels ("Reading “Docker setup”").
    titles = {c.noteId: c.title for c in working_set if c.title}
    time_limit_hit = False

    def response_with(message_text: str) -> AgentChatResponse:
        # Every reply leaves through here, so the leak check covers them all.
        safe_message, safe_drafts, blocked = check_for_leaks(message_text, drafts)
        if blocked:
            print(f"Agent reply blocked by the instructions-leak check (user: {tool_context.user_id or 'unknown'})")
        return AgentChatResponse(
            message=safe_message,
            citations=_dedupe_citations(citations),
            workingSet=merge_working_set(working_set, citations),
            toolsUsed=tools_used,
            drafts=safe_drafts,
            proposal=bulk["proposal"],
            splitChoices=bulk["splitChoices"],
            groupSuggestions=bulk["groupSuggestions"],
        )

    for iteration in range(MAX_ITERATIONS):
        if tools_deadline - time.monotonic() < MIN_CALL_SECONDS:
            time_limit_hit = True
            break

        await _emit(on_step, "Thinking…" if iteration == 0 else "Reviewing what I found…")
        try:
            response = await generate_with_retries(
                gemini_client,
                deadline=tools_deadline,
                model=AGENT_MODEL,
                contents=contents,
                config=tools_config,
            )
        except QuotaExceeded:
            raise
        except CallDeadlineExceeded:
            print(f"Agent model call hit the time limit (iteration {iteration})")
            time_limit_hit = True
            break
        except Exception as exc:
            print(f"Agent model call failed (iteration {iteration}): {exc}")
            # Even on failure, keep evidence of tools that already ran so the
            # UI/logs can show partial progress.
            return response_with(FALLBACK_MESSAGE)

        candidate = response.candidates[0] if response.candidates else None
        content = candidate.content if candidate else None
        parts = list(content.parts) if content and content.parts else []

        function_calls = [p.function_call for p in parts if getattr(p, "function_call", None)]
        text_parts = [p.text for p in parts if getattr(p, "text", None)]

        # No tool requests → this is the final answer turn.
        if not function_calls:
            final_text = "\n".join(text_parts).strip() or FALLBACK_MESSAGE
            return response_with(_sanitize_message(final_text))

        # Echo the model's function-call turn back UNMODIFIED. Rebuilding the
        # parts would drop each call's thought_signature, which Gemini 3.x
        # requires to be present in replayed functionCall parts.
        contents.append(content)

        response_parts: list[types.Part] = []
        executed_this_round: list[ToolResult] = []
        hard_stop = False

        for fc in function_calls:
            raw_args = fc.args or {}
            key = f"{fc.name}:{sorted(raw_args.items())}"
            remaining = tools_deadline - time.monotonic()
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
            elif remaining <= 0:
                # Every call still needs a response part, or Gemini rejects
                # the replayed turn; out of time means "skipped".
                result = _time_limit_result(fc.name)
            else:
                await _emit(on_step, _step_label(fc.name, raw_args, titles))
                try:
                    result = await asyncio.wait_for(
                        _execute_tool_call(tool_context, fc.name, raw_args, allowed),
                        timeout=remaining,
                    )
                except TimeoutError:
                    result = _time_limit_result(fc.name)
                if not result.ok:
                    retry_count[key] = retry_count.get(key, 0) + 1

            if result.error and result.error.code == "time_limit":
                time_limit_hit = True
            tools_used.append(
                ToolCallRecord(tool=fc.name, ok=result.ok, summary=result.summary or fc.name)
            )
            citations.extend(result.citations)
            titles.update({c.noteId: c.title for c in result.citations if c.title})
            drafts = _merge_drafts(drafts, result.drafts)
            if result.proposal or result.splitChoices or result.groupSuggestions:
                bulk.update(proposal=result.proposal, splitChoices=result.splitChoices,
                            groupSuggestions=result.groupSuggestions)
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

        # Every round resends the whole conversation, tool results included,
        # so input grows each round. Past the cap, stop gathering and answer.
        size = _contents_chars(contents)
        if size > INPUT_CAP_CHARS:
            print(f"Agent input cap reached ({size} chars after iteration {iteration}); answering now")
            break

    # Out of iterations, hard stop, time limit or input cap: one final answer pass
    # with tool calls switched off, written from whatever the turn gathered.
    await _emit(on_step, "Writing the reply…")
    message_text = ""
    final_contents = contents + [types.Content(role="user", parts=[types.Part.from_text(
        text="(No more tool calls are available for this message. Answer now from what you found; "
             "if it wasn't enough, say so plainly.)"
    )])]
    try:
        final = await generate_with_retries(
            gemini_client,
            deadline=deadline,
            model=AGENT_MODEL,
            contents=final_contents,
            config=finalize_config,
        )
        message_text = (final.text or "").strip() if final else ""
    except QuotaExceeded:
        raise
    except Exception as exc:
        print(f"Agent finalization call failed: {exc!r}")

    if message_text:
        return response_with(_sanitize_message(message_text))
    return response_with(TIME_LIMIT_MESSAGE if time_limit_hit else FALLBACK_MESSAGE)
