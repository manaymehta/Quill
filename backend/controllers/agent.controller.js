const { setTimeout, clearTimeout, setInterval, clearInterval } = require("node:timers");
const { TextDecoder } = require("node:util");
const AgentChat = require("../models/agent-chat.model");
const AgentProposal = require("../models/agent-proposal.model");
const AgentReceipt = require("../models/agent-receipt.model");
const AgentSelection = require("../models/agent-selection.model");
const User = require("../models/user.model");
const { DEFAULT_SCOPES, SCOPE_KEYS, getAgentScopes } = require("../services/agent-scopes.service");
const { pendingOf, pendingSummary, markMoved, summarizeReceipt } = require("../services/pending-list.service");

const { MAX_STORED_TURNS, MAX_CHATS_PER_USER, CHAT_TITLE_MAX, expiryFor } = AgentChat;
const CHAT_LIMIT_MESSAGE = `${MAX_CHATS_PER_USER} chats is the limit — delete one to start a new chat`;
const CHAT_NOT_FOUND_MESSAGE = "Chat not found — it may have expired or been deleted";
// A new chat's title: its first message, cut on a word boundary.
const AUTO_TITLE_CHARS = 48;

// Time limits (architecture plan §2.1, D27): FastAPI ends every turn by 60 s,
// so this outer limit only fires when FastAPI itself is stuck or asleep.
const AGENT_CHAT_TIMEOUT_MS = 70_000;
// No reply headers from FastAPI by then usually means Render is waking it.
const AGENT_WAKE_NOTICE_MS = 3_000;
// Comment lines on the open stream so proxies never see it as idle.
const AGENT_KEEPALIVE_MS = 10_000;
// A cold FastAPI on Render's free plan can take 50+ s to answer /health.
const AGENT_WAKE_TIMEOUT_MS = 90_000;

const AGENT_TIMEOUT_MESSAGE = "The assistant took too long — try again.";
const AGENT_UNREACHABLE_MESSAGE = "The assistant is unreachable right now. Try again shortly.";
const AGENT_STEP_LABEL_MAX = 120;
const AGENT_ERROR_MESSAGE_MAX = 300;

const MAX_HISTORY_TURNS = 50;
const MAX_WORKING_SET = 50;
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGE_CHARS = 20_000;

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

const sanitizeHistory = (raw) => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) return null;
    if (raw.length > MAX_HISTORY_TURNS) return null;

    const sanitized = [];
    for (const turn of raw) {
        if (!turn || typeof turn !== "object") return null;
        const { role, text } = turn;
        if ((role !== "user" && role !== "assistant")
            || typeof text !== "string"
            || !text.trim()
            || text.length > MAX_HISTORY_MESSAGE_CHARS) {
            return null;
        }
        sanitized.push({ role, text });
    }
    return sanitized;
};

// Working set entries travel as { noteId, title } so the model can resolve
// "the second one" by name, not just by ID.
const WORKING_SET_TITLE_MAX = 500;

const sanitizeWorkingSet = (raw) => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) return null;
    if (raw.length > MAX_WORKING_SET) return null;

    const sanitized = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") return null;
        const { noteId, title } = entry;
        if (typeof noteId !== "string" || !OBJECT_ID_RE.test(noteId)) return null;
        if (title !== undefined && title !== null
            && (typeof title !== "string" || title.length > WORKING_SET_TITLE_MAX)) {
            return null;
        }
        sanitized.push({ noteId, title: title || "" });
    }
    return sanitized;
};

const DRAFT_TITLE_MAX = 500;
const DRAFT_CONTENT_MAX = 20_000;
const DRAFT_TAGS_MAX = 10;
const DRAFT_CHECKLIST_ITEMS_MAX = 100;

const isValidDraft = (draft) => {
    if (!draft || typeof draft !== "object") return false;
    if (draft.action !== "create" && draft.action !== "edit") return false;
    if (draft.action === "edit" && (typeof draft.noteId !== "string" || !OBJECT_ID_RE.test(draft.noteId))) return false;
    if (draft.noteId !== undefined && draft.noteId !== null && (typeof draft.noteId !== "string" || !OBJECT_ID_RE.test(draft.noteId))) return false;
    if (draft.title !== undefined && draft.title !== null && (typeof draft.title !== "string" || draft.title.length > DRAFT_TITLE_MAX)) return false;
    if (draft.content !== undefined && draft.content !== null && (typeof draft.content !== "string" || draft.content.length > DRAFT_CONTENT_MAX)) return false;
    if (draft.tags !== undefined && draft.tags !== null) {
        if (!Array.isArray(draft.tags) || draft.tags.length > DRAFT_TAGS_MAX
            || !draft.tags.every((t) => typeof t === "string")) return false;
    }
    if (draft.isChecklist !== undefined && draft.isChecklist !== null && typeof draft.isChecklist !== "boolean") return false;
    if (draft.checklist !== undefined && draft.checklist !== null) {
        if (!Array.isArray(draft.checklist) || draft.checklist.length > DRAFT_CHECKLIST_ITEMS_MAX
            || !draft.checklist.every((item) => item && typeof item === "object"
                && typeof item.text === "string"
                && (item.completed === undefined || typeof item.completed === "boolean"))) return false;
    }
    if (draft.folderId !== undefined && draft.folderId !== null && (typeof draft.folderId !== "string" || !OBJECT_ID_RE.test(draft.folderId))) return false;
    if (draft.basedOnUnsaved !== undefined && typeof draft.basedOnUnsaved !== "boolean") return false;
    return true;
};

// Notes open in the user's editor with unsaved changes (architecture plan
// D21): the agent reads and edits these versions instead of the saved ones.
const MAX_UNSAVED_NOTES = 12;
const UNSAVED_TAGS_MAX = 50;
const UNSAVED_TAG_CHARS_MAX = 100;
const UNSAVED_CHECKLIST_TEXT_MAX = 2000;

const sanitizeUnsavedNotes = (raw) => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > MAX_UNSAVED_NOTES) return null;

    const sanitized = [];
    for (const note of raw) {
        if (!note || typeof note !== "object") return null;
        const { noteId, title = "", content = "", tags = [], isChecklist = false, checklist = [] } = note;
        if (typeof noteId !== "string" || !OBJECT_ID_RE.test(noteId)) return null;
        if (typeof title !== "string" || title.length > DRAFT_TITLE_MAX) return null;
        if (typeof content !== "string" || content.length > DRAFT_CONTENT_MAX) return null;
        if (!Array.isArray(tags) || tags.length > UNSAVED_TAGS_MAX
            || !tags.every((t) => typeof t === "string" && t.length <= UNSAVED_TAG_CHARS_MAX)) return null;
        if (typeof isChecklist !== "boolean") return null;
        if (!Array.isArray(checklist) || checklist.length > DRAFT_CHECKLIST_ITEMS_MAX) return null;
        const items = [];
        for (const item of checklist) {
            if (!item || typeof item !== "object" || typeof item.text !== "string"
                || item.text.length > UNSAVED_CHECKLIST_TEXT_MAX
                || (item.completed !== undefined && typeof item.completed !== "boolean")) return null;
            items.push({ text: item.text, completed: Boolean(item.completed) });
        }
        sanitized.push({ noteId, title, content, tags, isChecklist, checklist: items });
    }
    return sanitized;
};

const CITATION_SNIPPET_MAX = 300;
const CITATION_TAGS_MAX = 5;

// Bulk change payloads (step 3b). Malformed ones are dropped (null), never
// passed to the browser half-checked.
const BULK_ACTIONS = new Set(["move", "tag", "archive", "trash"]);
const BULK_VERDICTS = new Set(["likely", "rejected", "unjudged"]);
const isShortString = (v, max) => typeof v === "string" && v.length <= max;
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// A review list's changes: [{ key, action, params, title }].
const sanitizeChanges = (list) => {
    if (!Array.isArray(list) || list.length === 0 || list.length > 20) return null;
    const out = [];
    for (const c of list) {
        if (!isPlainObject(c) || !isShortString(c.key, 8) || !BULK_ACTIONS.has(c.action) || !isPlainObject(c.params)
            || !isShortString(c.title ?? "", 300)) return null;
        out.push({ key: c.key, action: c.action, params: c.params, title: c.title ?? "" });
    }
    return out;
};

const sanitizeIdList = (list) => (Array.isArray(list) ? list.filter((id) => isShortString(id, 120)).slice(0, 20) : []);

const sanitizeProposal = (p) => {
    if (!isPlainObject(p) || !isShortString(p.proposalId, 64) || !Array.isArray(p.candidates) || p.candidates.length === 0 || p.candidates.length > 50) return null;
    const changes = sanitizeChanges(p.changes);
    if (!changes) return null;
    const keys = new Set(changes.map((c) => c.key));
    const candidates = [];
    for (const c of p.candidates) {
        if (!isPlainObject(c) || typeof c.noteId !== "string" || !OBJECT_ID_RE.test(c.noteId) || !isShortString(c.title, 500)
            || !(c.folder === null || c.folder === undefined || isShortString(c.folder, 200))
            || !Array.isArray(c.items) || c.items.length === 0 || c.items.length > 20) return null;
        const items = [];
        for (const i of c.items) {
            if (!isPlainObject(i) || !keys.has(i.change) || !BULK_VERDICTS.has(i.verdict) || !isShortString(i.reason ?? "", 300)
                || !isShortString(i.label ?? "", 300)
                || !(i.clashesWith === undefined || (Array.isArray(i.clashesWith) && i.clashesWith.every((k) => keys.has(k))))) return null;
            items.push({ change: i.change, verdict: i.verdict, reason: i.reason ?? "", label: i.label ?? "", clashesWith: i.clashesWith || [] });
        }
        candidates.push({ noteId: c.noteId, title: c.title, folder: c.folder ?? null, items });
    }
    const groups = [];
    for (const g of Array.isArray(p.groups) ? p.groups.slice(0, 8) : []) {
        if (!isPlainObject(g) || !isShortString(g.name, 40) || !isShortString(g.tag, 30) || !Array.isArray(g.noteIds)
            || !Array.isArray(g.changes) || !g.changes.every((k) => keys.has(k))) return null;
        groups.push({ name: g.name, tag: g.tag, noteIds: g.noteIds.filter((id) => typeof id === "string" && OBJECT_ID_RE.test(id)), changes: g.changes });
    }
    return {
        proposalId: p.proposalId, changes, candidates, groups, openedFrom: sanitizeIdList(p.openedFrom),
        status: p.status === "held" ? "held" : "open",
        version: Number.isInteger(p.version) ? p.version : 1,
        heldReason: p.heldReason === "separate" || p.heldReason === "too-many" ? p.heldReason : null,
    };
};

const sanitizeSplitChoices = (s) => {
    if (!isPlainObject(s) || !isShortString(s.selectionId, 64) || !Number.isInteger(s.total)
        || !Array.isArray(s.parts) || s.parts.length < 2 || s.parts.length > 40) return null;
    const changes = sanitizeChanges(s.changes);
    if (!changes) return null;
    const parts = [];
    for (const part of s.parts) {
        if (!isPlainObject(part) || !Number.isInteger(part.index) || !isShortString(part.label, 120) || !Number.isInteger(part.count)) return null;
        parts.push({ index: part.index, label: part.label, count: part.count });
    }
    return { selectionId: s.selectionId, changes, total: s.total, parts };
};

const validateAgentResponse = (data) => {
    if (!data || typeof data !== "object") return null;
    if (typeof data.message !== "string" || !data.message.trim()) return null;
    if (!Array.isArray(data.citations) || !Array.isArray(data.workingSet)
        || !Array.isArray(data.toolsUsed)) {
        return null;
    }
    const isValidRef = (ref) => ref && typeof ref === "object"
        && typeof ref.noteId === "string" && typeof ref.title === "string";
    if (!data.citations.every(isValidRef) || !data.workingSet.every(isValidRef)) {
        return null;
    }
    const isValidToolCall = (call) => call && typeof call === "object"
        && typeof call.tool === "string"
        && typeof call.ok === "boolean"
        && typeof call.summary === "string";
    if (!data.toolsUsed.every(isValidToolCall)) return null;
    const drafts = Array.isArray(data.drafts) ? data.drafts : [];
    if (!drafts.every(isValidDraft)) return null;
    return {
        message: data.message,
        // Citations carry what the chat's note card shows; trimmed, typed.
        citations: data.citations.map((c) => ({
            noteId: c.noteId,
            title: c.title,
            snippet: typeof c.snippet === "string" ? c.snippet.slice(0, CITATION_SNIPPET_MAX) : "",
            tags: Array.isArray(c.tags)
                ? c.tags.filter((t) => typeof t === "string").slice(0, CITATION_TAGS_MAX).map((t) => t.slice(0, 100))
                : [],
        })),
        workingSet: data.workingSet.map((w) => ({ noteId: w.noteId, title: w.title })),
        toolsUsed: data.toolsUsed,
        drafts: drafts.slice(0, 5),
        proposal: data.proposal ? sanitizeProposal(data.proposal) : null,
        splitChoices: data.splitChoices ? sanitizeSplitChoices(data.splitChoices) : null,
    };
};

const chatWithAgent = async (req, res) => {
    const { message, history, workingSet, unsavedNotes, chatId = null } = req.body || {};

    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_CHARS) {
        return res.status(400).json({ error: true, message: "message must be a non-empty string (max 2000 chars)" });
    }
    if (chatId !== null && (typeof chatId !== "string" || !OBJECT_ID_RE.test(chatId))) {
        return res.status(400).json({ error: true, message: "Invalid chat" });
    }

    const sanitizedHistory = sanitizeHistory(history);
    if (sanitizedHistory === null) {
        return res.status(400).json({ error: true, message: "history must be an array of { role: user|assistant, text } turns" });
    }

    const sanitizedWorkingSet = sanitizeWorkingSet(workingSet);
    if (sanitizedWorkingSet === null) {
        return res.status(400).json({ error: true, message: "workingSet must be an array of { noteId, title } entries" });
    }

    const sanitizedUnsavedNotes = sanitizeUnsavedNotes(unsavedNotes);
    if (sanitizedUnsavedNotes === null) {
        return res.status(400).json({ error: true, message: "unsavedNotes must be an array of open notes within the size limits" });
    }

    const FASTAPI_URL = process.env.FASTAPI_SUMMARIZE_URL;
    if (!FASTAPI_URL) {
        console.error("FASTAPI_SUMMARIZE_URL is not defined in environment variables.");
        return res.status(500).json({ error: true, message: "AI service is not configured" });
    }

    // An existing chat must be this user's; a new one (no chatId) must fit
    // under the limit. Both answered as plain JSON, before the stream starts.
    try {
        if (chatId) {
            if (!(await AgentChat.exists({ _id: chatId, userId: String(req.user._id) }))) {
                return res.status(404).json({ error: true, message: CHAT_NOT_FOUND_MESSAGE });
            }
        } else if (await AgentChat.countDocuments({ userId: String(req.user._id) }) >= MAX_CHATS_PER_USER) {
            return res.status(409).json({ error: true, code: "chat-limit", message: CHAT_LIMIT_MESSAGE });
        }
    } catch (chatError) {
        console.error(`[${req.id}] Agent chat lookup failed:`, chatError.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }

    // The user's pending review list (one per account), so the agent can tell
    // an add-on from a separate task.
    let pendingList = null;
    try {
        pendingList = pendingSummary(await pendingOf(req.user._id));
    } catch (pendingError) {
        console.error(`[${req.id}] Pending list lookup failed:`, pendingError.message);
    }

    // The permission toggles decide which tools the agent is offered.
    let agentScopes;
    try {
        agentScopes = await getAgentScopes(req.user._id);
    } catch (scopeError) {
        console.error(`[${req.id}] Agent scopes read failed; using defaults:`, scopeError.message);
        agentScopes = { ...DEFAULT_SCOPES };
    }

    // From here on the reply is a Server-Sent Events stream (architecture plan
    // §2.1, step 1a): `step` events while the turn works, then exactly one
    // `final` or `error` event. Errors above stay plain JSON responses.
    res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(": connected\n\n");

    const upstream = new AbortController();
    let abortReason = null;
    let streamDone = false;
    const keepAlive = setInterval(() => {
        if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, AGENT_KEEPALIVE_MS);
    const wakeNotice = setTimeout(() => {
        writeEvent(res, "step", { label: "Waking up the assistant…" });
    }, AGENT_WAKE_NOTICE_MS);
    const turnTimeout = setTimeout(() => {
        abortReason = "timeout";
        upstream.abort();
    }, AGENT_CHAT_TIMEOUT_MS);
    // The browser closed the stream (Stop, navigation, network loss): cancel
    // FastAPI's turn too, so it stops calling the model.
    res.on("close", () => {
        if (streamDone) return;
        abortReason = abortReason || "client";
        upstream.abort();
    });

    // Forward the user's own credentials so tool calls inside the agent run
    // with exactly this user's permissions through the normal routes.
    const internalKey = process.env.FASTAPI_INTERNAL_KEY;
    const headers = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: req.headers["authorization"],
        "x-user-id": String(req.user._id),
        ...(internalKey ? { "x-api-key": internalKey } : {}),
    };

    try {
        const response = await fetch(`${FASTAPI_URL}/agent/chat`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                message: message.trim(),
                history: sanitizedHistory,
                workingSet: sanitizedWorkingSet,
                unsavedNotes: sanitizedUnsavedNotes,
                scopes: agentScopes,
                chatId,
                pendingList,
            }),
            signal: upstream.signal,
        });
        clearTimeout(wakeNotice);

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            console.error(`[${req.id}] Agent service error ${response.status}:`, detail.slice(0, 300));
            writeEvent(res, "error", {
                message: response.status === 503 ? AGENT_UNREACHABLE_MESSAGE : "AI service request failed",
            });
            return;
        }

        let ended = false;
        for await (const { event, data } of readSseEvents(response.body)) {
            let payload;
            try {
                payload = JSON.parse(data);
            } catch {
                continue;
            }

            if (event === "step") {
                if (typeof payload?.label === "string" && payload.label.trim()) {
                    writeEvent(res, "step", { label: payload.label.slice(0, AGENT_STEP_LABEL_MAX) });
                }
                continue;
            }

            if (event === "final") {
                ended = true;
                const validated = validateAgentResponse(payload);
                if (!validated) {
                    console.error(`[${req.id}] Agent service returned an invalid response shape`);
                    writeEvent(res, "error", { message: "AI service returned an invalid response" });
                    break;
                }
                // Convenience persistence: chat state is recoverable after
                // refresh. Awaited so a refresh right after this reply can't
                // lose the turn. A persistence failure must never eat a
                // successful answer.
                let savedChatId = chatId;
                try {
                    savedChatId = await persistAgentTurn(String(req.user._id), chatId, message.trim(), validated);
                } catch (persistError) {
                    console.error(`[${req.id}] Agent chat persistence failed:`, persistError.message);
                }
                writeEvent(res, "final", { error: false, ...validated, chatId: savedChatId });
                break;
            }

            if (event === "error") {
                ended = true;
                const retryAfter = Number(payload?.retryAfterSeconds);
                writeEvent(res, "error", {
                    message: typeof payload?.message === "string" && payload.message.trim()
                        ? payload.message.slice(0, AGENT_ERROR_MESSAGE_MAX)
                        : "AI service request failed",
                    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: Math.ceil(retryAfter) } : {}),
                });
                break;
            }
        }

        if (!ended) {
            console.error(`[${req.id}] Agent stream ended without a final event`);
            writeEvent(res, "error", { message: "The assistant stopped unexpectedly. Try again." });
        }
    } catch (error) {
        if (abortReason === "client") {
            console.log(`[${req.id}] Agent chat stopped by the client`);
        } else if (abortReason === "timeout") {
            console.error(`[${req.id}] Agent chat timed out after ${AGENT_CHAT_TIMEOUT_MS / 1000}s`);
            writeEvent(res, "error", { message: AGENT_TIMEOUT_MESSAGE });
        } else {
            console.error(`[${req.id}] Agent chat request failed:`, error.message);
            writeEvent(res, "error", { message: AGENT_UNREACHABLE_MESSAGE });
        }
    } finally {
        streamDone = true;
        clearInterval(keepAlive);
        clearTimeout(wakeNotice);
        clearTimeout(turnTimeout);
        if (!res.writableEnded) res.end();
    }
};

const writeEvent = (res, event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// Minimal Server-Sent Events reader for FastAPI's stream: yields
// { event, data } per blank-line-separated block; comment lines (keep-alives)
// are skipped.
async function* readSseEvents(body) {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let event = "message";
            const dataLines = [];
            for (const line of block.split("\n")) {
                if (line.startsWith(":")) continue;
                if (line.startsWith("event:")) event = line.slice(6).trim();
                else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
            }
            if (dataLines.length > 0) yield { event, data: dataLines.join("\n") };
        }
    }
}

// Early wake-up (architecture plan §2.1 step 0): the chat panel calls this
// when it opens, so sleeping Render services start waking while the user is
// still typing. Replies at once; the FastAPI ping runs in the background, one
// at a time.
let agentWakeInFlight = null;

const wakeAgent = (req, res) => {
    const FASTAPI_URL = process.env.FASTAPI_SUMMARIZE_URL;
    if (FASTAPI_URL && !agentWakeInFlight) {
        agentWakeInFlight = fetch(`${FASTAPI_URL}/health`, { signal: AbortSignal.timeout(AGENT_WAKE_TIMEOUT_MS) })
            .catch((error) => console.warn(`[${req.id}] Agent wake-up ping failed:`, error.message))
            .finally(() => {
                agentWakeInFlight = null;
            });
    }
    return res.status(202).json({ error: false, message: "Waking the assistant" });
};

// Saves the user turn + assistant turn into the chat (a new chat, titled by
// its first message, when chatId is null) and links the turn's review list /
// split choices to that chat. Returns the chat's ID (null if it was deleted
// while the turn ran).
const persistAgentTurn = async (userId, chatId, userMessage, validated) => {
    // The pending list is shown only in its newest turn: older turns showing
    // it (any chat) become a pointer.
    if (validated.proposal?.status === "open") await markMoved(userId, validated.proposal.proposalId);
    const savedChatId = await appendTurns(userId, chatId, [
        { role: "user", text: userMessage },
        {
            role: "assistant",
            text: validated.message,
            citations: validated.citations,
            proposal: validated.proposal || null,
            splitChoices: validated.splitChoices || null,
        },
    ], { workingSet: validated.workingSet, newChatTitle: titleFromMessage(userMessage) });
    if (savedChatId && validated.proposal) {
        await AgentProposal.updateOne({ proposalId: validated.proposal.proposalId, userId }, { $set: { chatId: savedChatId } });
    }
    if (savedChatId && validated.splitChoices) {
        await AgentSelection.updateOne({ selectionId: validated.splitChoices.selectionId, userId }, { $set: { chatId: savedChatId } });
    }
    return savedChatId;
};

const titleFromMessage = (text) => {
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat.length <= AUTO_TITLE_CHARS) return flat;
    const cut = flat.slice(0, AUTO_TITLE_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > AUTO_TITLE_CHARS / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
};

// Appends turns to a chat (capped at MAX_STORED_TURNS), keeping each stored
// turn's review list / split choices, and restarts its 3-day clock (none
// while pinned). chatId null creates the chat. `workingSet` undefined =
// unchanged. Returns the chat's ID, or null when chatId no longer exists.
const appendTurns = async (userId, chatId, turns, { workingSet, newChatTitle } = {}) => {
    let doc = chatId ? await AgentChat.findOne({ _id: chatId, userId: String(userId) }) : null;
    if (chatId && !doc) return null;
    if (!doc) doc = new AgentChat({ userId: String(userId), title: newChatTitle || "New chat" });
    doc.turns = [
        ...doc.turns.map((t) => ({
            role: t.role, text: t.text, citations: t.citations, proposal: t.proposal ?? null, splitChoices: t.splitChoices ?? null,
            groupSuggestions: t.groupSuggestions ?? null, createdAt: t.createdAt,
        })),
        ...turns,
    ].slice(-MAX_STORED_TURNS);
    if (workingSet !== undefined) doc.workingSet = workingSet;
    doc.lastActivityAt = new Date();
    doc.expiresAt = expiryFor(doc.pinned);
    await doc.save();
    return String(doc._id);
};

const chatSummary = (doc) => ({
    chatId: String(doc._id),
    title: doc.title,
    pinned: Boolean(doc.pinned),
    lastActivityAt: doc.lastActivityAt,
    expiresAt: doc.expiresAt || null,
});

const ownChatFilter = (req) => (OBJECT_ID_RE.test(req.params.chatId || "")
    ? { _id: req.params.chatId, userId: String(req.user._id) }
    : null);

// GET /v1/agent/chats — pinned first, then most recently active.
const listChats = async (req, res) => {
    try {
        const chats = await AgentChat.find({ userId: String(req.user._id) })
            .select("title pinned lastActivityAt expiresAt")
            .sort({ pinned: -1, lastActivityAt: -1 })
            .limit(MAX_CHATS_PER_USER * 2)
            .lean();
        return res.json({ error: false, chats: chats.map(chatSummary), limit: MAX_CHATS_PER_USER });
    } catch (error) {
        console.error(`[${req.id}] Agent chat list failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// GET /v1/agent/chats/:chatId — the turns and working set. Review lists and
// split choices whose saved record is gone (erased after 3 days; a pinned
// chat outlives them) come back marked expired, unless already applied.
// Applied lists come with their receipt (moved pointers never do). A pointer
// to a list now shown in another chat names that chat (`movedTo`); null when
// it's this chat or that chat is gone.
const getChat = async (req, res) => {
    const filter = ownChatFilter(req);
    try {
        const doc = filter && await AgentChat.findOne(filter).lean();
        if (!doc) return res.status(404).json({ error: true, message: CHAT_NOT_FOUND_MESSAGE });
        const userId = String(req.user._id);
        const proposalIds = doc.turns.map((t) => t.proposal?.proposalId).filter(Boolean);
        const selectionIds = doc.turns.map((t) => t.splitChoices?.selectionId).filter(Boolean);
        const [liveProposals, receipts, liveSelections] = await Promise.all([
            proposalIds.length ? AgentProposal.find({ userId, proposalId: { $in: proposalIds } }).select("proposalId status chatId").lean() : [],
            proposalIds.length ? AgentReceipt.find({ userId, proposalId: { $in: proposalIds } }).lean() : [],
            selectionIds.length ? AgentSelection.find({ userId, selectionId: { $in: selectionIds } }).select("selectionId").lean() : [],
        ]);
        const usable = new Set([...liveProposals, ...receipts].map((p) => p.proposalId));
        // replaced (older lists) / discarded (closed by the user); held = not
        // added to the pending list yet.
        const closed = new Map(liveProposals.filter((p) => p.status === "replaced" || p.status === "discarded").map((p) => [p.proposalId, p.status]));
        const held = new Set(liveProposals.filter((p) => p.status === "held").map((p) => p.proposalId));
        const liveSelectionIds = new Set(liveSelections.map((s) => s.selectionId));
        const receiptOf = new Map(receipts.map((r) => [r.proposalId, summarizeReceipt(r)]));
        const thisChatId = String(doc._id);
        const listChat = new Map(liveProposals.map((p) => [p.proposalId, p.chatId]));
        const otherChatIds = [...new Set(doc.turns
            .filter((t) => t.proposal?.moved)
            .map((t) => listChat.get(t.proposal.proposalId))
            .filter((id) => id && id !== thisChatId && OBJECT_ID_RE.test(id)))];
        const otherChats = otherChatIds.length
            ? await AgentChat.find({ _id: { $in: otherChatIds }, userId }).select("title").lean()
            : [];
        const chatTitles = new Map(otherChats.map((c) => [String(c._id), c.title]));
        const movedTo = (proposalId) => {
            const chatId = listChat.get(proposalId);
            return chatTitles.has(chatId) ? { chatId, title: chatTitles.get(chatId) } : null;
        };
        return res.json({
            error: false,
            chat: chatSummary(doc),
            turns: doc.turns.map((t) => ({
                role: t.role,
                text: t.text,
                citations: t.citations || [],
                proposal: t.proposal
                    ? {
                        ...t.proposal,
                        expired: !usable.has(t.proposal.proposalId),
                        closed: closed.get(t.proposal.proposalId) || null,
                        status: held.has(t.proposal.proposalId) ? "held" : t.proposal.status === "held" ? "open" : t.proposal.status,
                        receipt: t.proposal.moved ? null : receiptOf.get(t.proposal.proposalId) || null,
                        ...(t.proposal.moved && { movedTo: movedTo(t.proposal.proposalId) }),
                    }
                    : null,
                splitChoices: t.splitChoices ? { ...t.splitChoices, expired: !liveSelectionIds.has(t.splitChoices.selectionId) } : null,
                // Group cards from before grouping made review lists.
                groupSuggestions: t.groupSuggestions ? { ...t.groupSuggestions, expired: true } : null,
            })),
            workingSet: doc.workingSet || [],
        });
    } catch (error) {
        console.error(`[${req.id}] Agent chat fetch failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// PATCH /v1/agent/chats/:chatId — { title?, pinned? }. Pinning removes the
// expiry; unpinning starts a fresh 3 days.
const updateChat = async (req, res) => {
    const { title, pinned } = req.body || {};
    const changes = {};
    if (title !== undefined) {
        const clean = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
        if (!clean || clean.length > CHAT_TITLE_MAX) {
            return res.status(400).json({ error: true, message: `title must be 1-${CHAT_TITLE_MAX} characters` });
        }
        changes.title = clean;
    }
    if (pinned !== undefined) {
        if (typeof pinned !== "boolean") return res.status(400).json({ error: true, message: "pinned must be true or false" });
        changes.pinned = pinned;
        changes.expiresAt = expiryFor(pinned);
    }
    if (Object.keys(changes).length === 0) return res.status(400).json({ error: true, message: "Nothing to change" });
    const filter = ownChatFilter(req);
    try {
        const doc = filter && await AgentChat.findOneAndUpdate(filter, { $set: changes }, { new: true }).lean();
        if (!doc) return res.status(404).json({ error: true, message: CHAT_NOT_FOUND_MESSAGE });
        return res.json({ error: false, chat: chatSummary(doc) });
    } catch (error) {
        console.error(`[${req.id}] Agent chat update failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// DELETE /v1/agent/chats/:chatId — also removes the pending / held lists
// shown in it and its split choices. Receipts stay: the activity log and Undo don't depend on
// the chat.
const deleteChat = async (req, res) => {
    const filter = ownChatFilter(req);
    try {
        const doc = filter && await AgentChat.findOneAndDelete(filter).select("_id").lean();
        if (!doc) return res.status(404).json({ error: true, message: CHAT_NOT_FOUND_MESSAGE });
        const userId = String(req.user._id);
        const chatId = String(doc._id);
        await Promise.all([
            AgentProposal.deleteMany({ userId, chatId, status: { $in: ["open", "held"] } }),
            AgentSelection.deleteMany({ userId, chatId }),
        ]);
        return res.json({ error: false, message: "Chat deleted" });
    } catch (error) {
        console.error(`[${req.id}] Agent chat delete failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// GET /v1/agent/settings — the agent's permission toggles (read is always on).
const getAgentSettings = async (req, res) => {
    try {
        return res.json({ error: false, scopes: await getAgentScopes(req.user._id) });
    } catch (error) {
        console.error(`[${req.id}] Agent settings read failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// PUT /v1/agent/settings — { compose?, organize?, destructive? } booleans.
const updateAgentSettings = async (req, res) => {
    const body = req.body || {};
    const changes = {};
    for (const key of SCOPE_KEYS) {
        if (body[key] === undefined) continue;
        if (typeof body[key] !== "boolean") return res.status(400).json({ error: true, message: `${key} must be true or false` });
        changes[`agentScopes.${key}`] = body[key];
    }
    if (Object.keys(changes).length === 0) return res.status(400).json({ error: true, message: "Nothing to change" });
    try {
        const result = await User.updateOne({ _id: req.user._id }, { $set: changes });
        if (result.matchedCount !== 1) return res.status(404).json({ error: true, message: "Account not found" });
        return res.json({ error: false, scopes: await getAgentScopes(req.user._id) });
    } catch (error) {
        console.error(`[${req.id}] Agent settings update failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

module.exports = {
    chatWithAgent, wakeAgent, listChats, getChat, updateChat, deleteChat, getAgentSettings, updateAgentSettings, appendTurns,
};
