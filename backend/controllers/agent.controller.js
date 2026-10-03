const axios = require("axios");
const mongoose = require("mongoose");
const Note = require("../models/note.model");
const AgentConversation = require("../models/agent-conversation.model");

const MAX_STORED_TURNS = AgentConversation.MAX_STORED_TURNS;

// The agent turn can legally take longer than an ordinary request: up to 4
// model round-trips may happen inside one call.
const AGENT_CHAT_TIMEOUT_MS = 120_000;

const MAX_HISTORY_TURNS = 50;
const MAX_WORKING_SET = 50;
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGE_CHARS = 20_000;

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

// Mirrors the pattern used in note.controller.js for FastAPI calls.
const getAgentServiceConfig = (timeout) => {
    const key = process.env.FASTAPI_INTERNAL_KEY;
    return {
        timeout,
        ...(key ? { headers: { "x-api-key": key } } : {}),
    };
};

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

const sanitizeWorkingSet = (raw) => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) return null;
    if (raw.length > MAX_WORKING_SET) return null;
    for (const id of raw) {
        if (typeof id !== "string" || !OBJECT_ID_RE.test(id)) return null;
    }
    return raw;
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
    return true;
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
        citations: data.citations,
        workingSet: data.workingSet,
        toolsUsed: data.toolsUsed,
        drafts: drafts.slice(0, 5),
    };
};

const chatWithAgent = async (req, res) => {
    const { message, history, workingSet } = req.body || {};

    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_CHARS) {
        return res.status(400).json({ error: true, message: "message must be a non-empty string (max 2000 chars)" });
    }

    const sanitizedHistory = sanitizeHistory(history);
    if (sanitizedHistory === null) {
        return res.status(400).json({ error: true, message: "history must be an array of { role: user|assistant, text } turns" });
    }

    const sanitizedWorkingSet = sanitizeWorkingSet(workingSet);
    if (sanitizedWorkingSet === null) {
        return res.status(400).json({ error: true, message: "workingSet must be an array of note IDs" });
    }

    const FASTAPI_URL = process.env.FASTAPI_SUMMARIZE_URL;
    if (!FASTAPI_URL) {
        console.error("FASTAPI_SUMMARIZE_URL is not defined in environment variables.");
        return res.status(500).json({ error: true, message: "AI service is not configured" });
    }

    // Forward the user's own credentials so tool calls inside the agent run
    // with exactly this user's permissions through the normal routes.
    const authHeader = req.headers["authorization"];
    const config = getAgentServiceConfig(AGENT_CHAT_TIMEOUT_MS);
    config.headers = {
        ...(config.headers || {}),
        Authorization: authHeader,
        "x-user-id": String(req.user._id),
    };

    try {
        const response = await axios.post(`${FASTAPI_URL}/agent/chat`, {
            message: message.trim(),
            history: sanitizedHistory,
            workingSet: sanitizedWorkingSet,
        }, config);

        const validated = validateAgentResponse(response.data);
        if (!validated) {
            console.error(`[${req.id}] Agent service returned an invalid response shape`);
            return res.status(502).json({ error: true, message: "AI service returned an invalid response" });
        }

        // Convenience persistence: chat state is recoverable after refresh.
        // Awaited so a refresh right after this reply can't lose the turn; the
        // added latency is one small write vs a multi-second model call. A
        // persistence failure must never eat a successful answer.
        try {
            await persistAgentTurn(req.user._id, message.trim(), validated);
        } catch (persistError) {
            console.error(`[${req.id}] Agent conversation persistence failed:`, persistError.message);
        }

        return res.json({ error: false, ...validated });
    } catch (error) {
        if (error.code === "ECONNABORTED") {
            console.error(`[${req.id}] Agent chat timed out`);
            return res.status(504).json({ error: true, message: "The assistant took too long to respond" });
        }
        if (error.response) {
            console.error(`[${req.id}] Agent service error ${error.response.status}:`, error.response.data);
            const status = [400, 401, 403, 503].includes(error.response.status) ? error.response.status : 502;
            return res.status(status).json({ error: true, message: "AI service request failed" });
        }
        console.error(`[${req.id}] Agent chat request failed:`, error.message);
        return res.status(502).json({ error: true, message: "AI service is unreachable" });
    }
};

// Append the user turn + assistant turn to the user's single conversation doc,
// enforcing the stored-turn cap. Read-modify-write is acceptable here: one
// active conversation per user, low write rate.
const persistAgentTurn = async (userId, userMessage, validated) => {
    const doc = await AgentConversation.findOne({ userId });
    const existingTurns = doc ? doc.turns : [];
    const newTurns = [
        ...existingTurns.map((t) => ({ role: t.role, text: t.text, citations: t.citations })),
        { role: "user", text: userMessage },
        { role: "assistant", text: validated.message, citations: validated.citations },
    ];
    const cappedTurns = newTurns.slice(-MAX_STORED_TURNS);

    await AgentConversation.findOneAndUpdate(
        { userId },
        {
            $set: {
                turns: cappedTurns,
                workingSet: validated.workingSet,
                lastActivityAt: new Date(),
            },
        },
        { upsert: true, new: true }
    );
};

const getAgentConversation = async (req, res) => {
    try {
        const doc = await AgentConversation.findOne({ userId: req.user._id }).lean();
        if (!doc) {
            return res.json({ error: false, turns: [], workingSet: [] });
        }
        return res.json({
            error: false,
            turns: (doc.turns || []).map((t) => ({ role: t.role, text: t.text, citations: t.citations || [] })),
            workingSet: doc.workingSet || [],
        });
    } catch (error) {
        console.error(`[${req.id}] Agent conversation fetch failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const clearAgentConversation = async (req, res) => {
    try {
        await AgentConversation.deleteOne({ userId: req.user._id });
        return res.json({ error: false, message: "Agent conversation cleared" });
    } catch (error) {
        console.error(`[${req.id}] Agent conversation clear failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// The agent's metadata-filtered note listing (Phase A fix: "list my archived
// notes" and friends). Semantic search cannot express status/folder/tag/date
// filters — this endpoint exists so the model never has to pretend it did.
const listAgentNotes = async (req, res) => {
    const userId = req.user._id;
    const { archived, tag, folderId, untitled, limit } = req.query;

    const query = { userId, isDeleted: { $ne: true } };

    if (archived === "true") query.isArchived = true;
    if (untitled === "true") query.$or = [{ title: "" }, { title: { $exists: false } }];

    if (typeof tag === "string" && tag.trim()) {
        if (tag.trim().length > 64) {
            return res.status(400).json({ error: true, message: "Invalid tag" });
        }
        const escaped = tag.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        query.tags = { $regex: new RegExp(`^${escaped}$`, "i") };
    }

    if (folderId === "none") {
        query.folderId = null;
    } else if (typeof folderId === "string" && folderId.trim()) {
        if (!mongoose.Types.ObjectId.isValid(folderId.trim())) {
            return res.status(400).json({ error: true, message: "Invalid folderId" });
        }
        query.folderId = folderId.trim();
    }

    let cap = 30;
    if (limit !== undefined) {
        const parsed = parseInt(limit, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
            return res.status(400).json({ error: true, message: "limit must be between 1 and 50" });
        }
        cap = parsed;
    }

    try {
        const notes = await Note.find(query)
            .select("_id title content tags folderId isArchived updatedAt")
            .sort({ updatedAt: -1 })
            .limit(cap)
            .lean();

        return res.json({
            error: false,
            notes: notes.map((n) => ({
                _id: n._id,
                title: n.title || "",
                tags: n.tags || [],
                folderId: n.folderId ?? null,
                isArchived: Boolean(n.isArchived),
                updatedAt: n.updatedAt,
                excerpt: (n.content || "").slice(0, 200),
            })),
        });
    } catch (error) {
        console.error(`[${req.id}] Agent list-notes failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

module.exports = { chatWithAgent, getAgentConversation, clearAgentConversation, listAgentNotes };
