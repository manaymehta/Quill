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
MAX_WORKING_SET_TITLE_CHARS = 500


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=MAX_HISTORY_MESSAGE_CHARS)


class Citation(BaseModel):
    noteId: str
    title: str = ""


MAX_UNSAVED_NOTES = 12
MAX_UNSAVED_CONTENT_CHARS = 20_000
MAX_UNSAVED_TAGS = 50
MAX_UNSAVED_CHECKLIST_ITEMS = 100


class UnsavedChecklistItem(BaseModel):
    text: str = Field(default="", max_length=2000)
    completed: bool = False


class UnsavedNote(BaseModel):
    """A note open in the user's editor with changes they haven't saved.

    Tools that read this note return this version instead of the saved one
    (architecture plan D21), so edits are made on what the user sees.
    """
    noteId: str = Field(min_length=24, max_length=24)
    title: str = Field(default="", max_length=MAX_WORKING_SET_TITLE_CHARS)
    content: str = Field(default="", max_length=MAX_UNSAVED_CONTENT_CHARS)
    tags: list[str] = Field(default_factory=list, max_length=MAX_UNSAVED_TAGS)
    isChecklist: bool = False
    checklist: list[UnsavedChecklistItem] = Field(
        default_factory=list, max_length=MAX_UNSAVED_CHECKLIST_ITEMS
    )


class AgentChatRequest(BaseModel):
    message: str = Field(max_length=MAX_AGENT_MESSAGE_CHARS)
    history: list[HistoryTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)
    # { noteId, title } pairs in display order, so "the second one" can be
    # resolved by name, not just by ID.
    workingSet: list[Citation] = Field(default_factory=list, max_length=MAX_WORKING_SET)
    unsavedNotes: list[UnsavedNote] = Field(default_factory=list, max_length=MAX_UNSAVED_NOTES)

    @field_validator("workingSet")
    @classmethod
    def validate_working_set(cls, values: list[Citation]) -> list[Citation]:
        for value in values:
            # MongoDB ObjectIds are 24-char hex. Anything else is a bug or abuse.
            if len(value.noteId) != 24:
                raise ValueError("workingSet entries must carry note IDs")
            if len(value.title) > MAX_WORKING_SET_TITLE_CHARS:
                raise ValueError("workingSet titles are too long")
        return values


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
    # Edit made on the user's unsaved tab text, not the saved note: the
    # browser asks before applying it (Apply / Apply & save / Skip).
    basedOnUnsaved: bool = False


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
