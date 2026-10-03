"""Boundary models for the agent chat turn (harness Phase A, read-only tools).

Everything crossing a service boundary is typed here so the loop, the Express
proxy, and the frontend stay in lockstep. Wire names match the frontend store
exactly (camelCase) — do not rename individual fields.
"""
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

MAX_AGENT_MESSAGE_CHARS = 2000
MAX_HISTORY_TURNS = 50
MAX_HISTORY_MESSAGE_CHARS = 20_000
MAX_WORKING_SET = 50


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=MAX_HISTORY_MESSAGE_CHARS)


class AgentChatRequest(BaseModel):
    message: str = Field(max_length=MAX_AGENT_MESSAGE_CHARS)
    history: list[HistoryTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)
    workingSet: list[str] = Field(default_factory=list, max_length=MAX_WORKING_SET)

    @field_validator("workingSet")
    @classmethod
    def validate_working_set_ids(cls, values: list[str]) -> list[str]:
        for value in values:
            # MongoDB ObjectIds are 24-char hex. Anything else is a bug or abuse.
            if not isinstance(value, str) or len(value) != 24:
                raise ValueError("workingSet entries must be note IDs")
        return values


class Citation(BaseModel):
    noteId: str
    title: str = ""


class ToolCallRecord(BaseModel):
    """One executed tool call, summarized for the UI + logs, never raw payloads."""
    tool: str
    ok: bool
    summary: str


class AgentDraft(BaseModel):
    """A staged note write that NEVER touches the database.

    Phase B contract: the model proposes content; the harness validates; the
    frontend opens it as an unsaved TabDock tab; only the user's save commits.
    """
    action: Literal["create", "edit"]
    noteId: str | None = None       # set for edit
    title: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    isChecklist: bool | None = None
    checklist: list[dict[str, Any]] | None = None
    folderId: str | None = None     # for create; None = unfiled/home


class AgentChatResponse(BaseModel):
    message: str
    citations: list[Citation] = Field(default_factory=list)
    workingSet: list[Citation] = Field(default_factory=list)
    toolsUsed: list[ToolCallRecord] = Field(default_factory=list)
    drafts: list[AgentDraft] = Field(default_factory=list)


class ToolError(BaseModel):
    code: str
    message: str
    recoverable: bool = False


class ToolResult(BaseModel):
    """Uniform envelope every executor returns; the loop never sees raw failures."""
    ok: bool
    data: dict[str, Any] = Field(default_factory=dict)
    error: ToolError | None = None
    # Short human-readable line like: search_notes("docker") -> 3 notes
    summary: str = ""
    citations: list[Citation] = Field(default_factory=list)
    # Set by draft tools: validated proposed write(s) for the frontend dock.
    drafts: list[AgentDraft] = Field(default_factory=list)
