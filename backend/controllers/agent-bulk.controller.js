const crypto = require("node:crypto");
const Note = require("../models/note.model");
const Folder = require("../models/folder.model");
const AgentProposal = require("../models/agent-proposal.model");
const AgentReceipt = require("../models/agent-receipt.model");
const AgentSelection = require("../models/agent-selection.model");
const AgentGrouping = require("../models/agent-grouping.model");
const { withRequiredTransaction, TransactionsUnavailableError } = require("../services/mongo-transaction.service");
const { collectSubtreeFolderIds, getUserFolders } = require("../services/folder-tree.service");
const {
    isValidFolderId, findLivingFolder, livingFolderId, moveToFolder, setArchived, trashFields, restoreFromTrash,
    createFolderRecord, trashFolderIfEmpty,
} = require("../services/note-actions.service");
const { triggerEmbed, deleteEmbed } = require("./note.controller");
const { appendTurns } = require("./agent.controller");
const { allowsBulkAction, getAgentScopes } = require("../services/agent-scopes.service");

const SCOPE_OFF_MESSAGE = (action) => (action === "trash"
    ? "Sending notes to trash is turned off in the agent settings"
    : "Bulk changes are turned off in the agent settings");

// The agent's bulk changes (architecture plan §2.3, step 3a):
// propose (a saved review list) → apply (one transaction, receipt in the same
// transaction) → undo (one transaction, never over the user's newer edits).
// Every query is scoped to req.user._id; there is no permanent-delete action.

const ACTIONS = new Set(["move", "tag", "archive", "trash"]);
const VERDICTS = new Set(["likely", "rejected", "unjudged"]);
const MAX_NOTES = 50;
const MAX_TAGS_PER_ACTION = 10;
const MAX_TAG_CHARS = 50;
const MAX_REASON_CHARS = 300;
const MAX_INSTRUCTION_CHARS = 500;
const MAX_FOLDER_NAME_CHARS = 80;
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

// The fields an action reads or writes; compared to detect a note changed by
// the user since the review list was shown (apply) or since the agent changed
// it (undo).
const stateOf = (note) => ({
    folderId: note.folderId ? String(note.folderId) : null,
    showInHome: Boolean(note.showInHome),
    tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
    isArchived: Boolean(note.isArchived),
    isDeleted: Boolean(note.isDeleted),
});

const sameState = (a, b) => Boolean(a && b)
    && (a.folderId || null) === (b.folderId || null)
    && Boolean(a.showInHome) === Boolean(b.showInHome)
    && Boolean(a.isArchived) === Boolean(b.isArchived)
    && Boolean(a.isDeleted) === Boolean(b.isDeleted)
    && [...(a.tags || [])].sort().join("\u0000") === [...(b.tags || [])].sort().join("\u0000");

const cleanTags = (list) => {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list) || list.length > MAX_TAGS_PER_ACTION) return null;
    const out = [];
    for (const tag of list) {
        if (typeof tag !== "string") return null;
        const trimmed = tag.trim().replace(/^#+/, "");
        if (!trimmed || trimmed.length > MAX_TAG_CHARS) return null;
        if (!out.includes(trimmed)) out.push(trimmed);
    }
    return out;
};

// Validates an action's params for this user; returns { params } or { error }.
const normalizeParams = async (action, params, userId) => {
    const p = params && typeof params === "object" ? params : {};
    if (action === "move") {
        // A folder that doesn't exist yet: created when the user presses Apply.
        if (p.newFolderName !== undefined && p.newFolderName !== null && p.newFolderName !== "") {
            const name = typeof p.newFolderName === "string" ? p.newFolderName.replace(/\s+/g, " ").trim() : "";
            if (!name || name.length > MAX_FOLDER_NAME_CHARS) return { error: `newFolderName must be 1-${MAX_FOLDER_NAME_CHARS} characters` };
            return { params: { targetFolderId: null, newFolderName: name, targetFolderName: name } };
        }
        const target = p.targetFolderId ?? null;
        if (target === null) return { params: { targetFolderId: null } };
        if (!isValidFolderId(target)) return { error: "Invalid target folder" };
        const folder = await findLivingFolder(target, userId);
        if (!folder) return { error: "Target folder not found" };
        return { params: { targetFolderId: String(folder._id), targetFolderName: folder.name || "" } };
    }
    if (action === "tag") {
        const add = cleanTags(p.add);
        const remove = cleanTags(p.remove);
        if (add === null || remove === null) return { error: `Tags must be up to ${MAX_TAGS_PER_ACTION} strings of ${MAX_TAG_CHARS} chars or less` };
        if (add.length === 0 && remove.length === 0) return { error: "Give at least one tag to add or remove" };
        if (add.some((t) => remove.includes(t))) return { error: "A tag can't be both added and removed" };
        return { params: { add, remove } };
    }
    if (action === "archive") {
        if (typeof p.archived !== "boolean") return { error: "archived must be true or false" };
        return { params: { archived: p.archived } };
    }
    return { params: {} };   // trash
};

// Mutates `note` per the action, using the same rules as the app's own routes
// (services/note-actions.service.js). The move target was checked when the
// review list was saved; Apply re-checks it inside the transaction.
const applyAction = async (note, action, params, userId, session) => {
    if (action === "move") {
        moveToFolder(note, params.targetFolderId);
    } else if (action === "tag") {
        const tags = (note.tags || []).filter((t) => !params.remove.includes(t));
        for (const t of params.add) if (!tags.includes(t)) tags.push(t);
        note.tags = tags;
    } else if (action === "archive") {
        await setArchived(note, params.archived, userId, session);
    } else if (action === "trash") {
        Object.assign(note, trashFields());
    }
};

const summarizeReceipt = (receipt) => {
    const counts = { applied: 0, skippedChanged: 0, skippedUnchanged: 0, undone: 0, undoSkipped: 0 };
    for (const op of receipt.ops) {
        if (op.status === "applied") counts.applied += 1;
        else if (op.status === "skipped-changed") counts.skippedChanged += 1;
        else if (op.status === "skipped-unchanged") counts.skippedUnchanged += 1;
        else if (op.status === "undone") counts.undone += 1;
        else if (op.status === "undo-skipped") counts.undoSkipped += 1;
    }
    return {
        receiptId: String(receipt._id),
        proposalId: receipt.proposalId,
        action: receipt.action,
        params: receipt.params,
        instruction: receipt.instruction,
        status: receipt.status,
        createdAt: receipt.createdAt,
        undoneAt: receipt.undoneAt,
        counts,
        ops: receipt.ops.map((op) => ({ noteId: op.noteId, title: op.title, status: op.status })),
    };
};

// Search-index follow-ups after a commit (fire-and-forget, like note saves):
// trashed notes lose their pieces; restored / re-tagged / (un)archived notes
// are re-indexed. Moves need nothing (folders aren't indexed).
const syncSearchIndex = (changes, userId) => {
    for (const { noteId, wasDeleted, isDeleted } of changes) {
        const job = isDeleted && !wasDeleted
            ? deleteEmbed(noteId)
            : Note.findOne({ _id: noteId, userId, isDeleted: { $ne: true } }).then((note) => note && triggerEmbed(note, userId));
        Promise.resolve(job).catch((error) => console.error(`Bulk search sync failed for ${noteId}:`, error.message));
    }
};

class TargetFolderGoneError extends Error {
    constructor() {
        super("The target folder was moved to Trash after the list was made — ask again");
    }
}

const transactionError = (res, req, error) => {
    if (error instanceof TransactionsUnavailableError) {
        return res.status(503).json({ error: true, message: "Bulk changes need database transactions, which aren't available" });
    }
    console.error(`[${req.id}] Agent bulk operation failed:`, error.message);
    return res.status(500).json({ error: true, message: "Internal Server Error" });
};

// Saves a review list for this user: validates the action, loads each note
// (this user's, not trashed — anything else is refused), and stores the
// snapshot Apply will compare against. Returns { status, body }.
const saveProposal = async (userId, { action, params, instruction, candidates }, chatId = null) => {
    if (!ACTIONS.has(action)) return { status: 400, body: { error: true, message: "action must be move, tag, archive or trash" } };
    if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > MAX_NOTES) {
        return { status: 400, body: { error: true, message: `candidates must hold 1-${MAX_NOTES} notes` } };
    }
    if (instruction !== undefined && (typeof instruction !== "string" || instruction.length > MAX_INSTRUCTION_CHARS)) {
        return { status: 400, body: { error: true, message: "instruction is too long" } };
    }
    const seen = new Set();
    for (const c of candidates) {
        if (!c || typeof c.noteId !== "string" || !OBJECT_ID_RE.test(c.noteId) || seen.has(c.noteId)) {
            return { status: 400, body: { error: true, message: "candidates must be distinct note IDs" } };
        }
        if (c.verdict !== undefined && !VERDICTS.has(c.verdict)) return { status: 400, body: { error: true, message: "Invalid verdict" } };
        if (c.reason !== undefined && (typeof c.reason !== "string" || c.reason.length > MAX_REASON_CHARS)) {
            return { status: 400, body: { error: true, message: "reason is too long" } };
        }
        seen.add(c.noteId);
    }

    // The permission toggles are enforced here too, not only in the tool menu.
    if (!allowsBulkAction(await getAgentScopes(userId), action)) {
        return { status: 403, body: { error: true, message: SCOPE_OFF_MESSAGE(action) } };
    }
    const normalized = await normalizeParams(action, params, userId);
    if (normalized.error) return { status: 400, body: { error: true, message: normalized.error } };

    const notes = await Note.find({ _id: { $in: [...seen] }, userId, isDeleted: { $ne: true } })
        .select("_id title folderId showInHome tags isArchived isDeleted").lean();
    const byId = new Map(notes.map((n) => [String(n._id), n]));
    const missing = [...seen].filter((id) => !byId.has(id));
    if (missing.length > 0) return { status: 400, body: { error: true, message: "Some notes were not found", missing } };
    const folderNames = await folderNameMap(notes, userId);

    const proposal = await AgentProposal.create({
        proposalId: crypto.randomUUID(),
        userId,
        chatId,
        action,
        params: normalized.params,
        instruction: instruction || "",
        candidates: candidates.map((c) => {
            const note = byId.get(c.noteId);
            return { noteId: c.noteId, title: note.title || "", verdict: c.verdict || "likely", reason: c.reason || "", snapshot: stateOf(note) };
        }),
    });
    return {
        status: 201,
        body: {
            error: false,
            proposalId: proposal.proposalId,
            action,
            params: normalized.params,
            candidates: proposal.candidates.map((c) => {
                const folderId = byId.get(c.noteId).folderId;
                return { noteId: c.noteId, title: c.title, folder: folderId ? folderNames.get(String(folderId)) || null : null, verdict: c.verdict, reason: c.reason };
            }),
        },
    };
};

const folderNameMap = async (notes, userId) => {
    const folderIds = [...new Set(notes.map((n) => n.folderId).filter(Boolean).map(String))];
    const folders = folderIds.length ? await Folder.find({ _id: { $in: folderIds }, userId }).select("_id name").lean() : [];
    return new Map(folders.map((f) => [String(f._id), f.name || ""]));
};

// POST /v1/agent/proposals — save a review list (called by the agent).
const createProposal = async (req, res) => {
    try {
        const { status, body } = await saveProposal(req.user._id, req.body || {});
        return res.status(status).json(body);
    } catch (error) {
        console.error(`[${req.id}] Agent proposal failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// POST /v1/agent/select-notes — the complete list of this user's notes
// matching exact filters (architecture plan §2.5 step 1; no AI). Archived
// notes are left out unless `archived: true` asks for them.
const MAX_SELECT_NOTES = 2000;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const selectNotes = async (req, res) => {
    const userId = req.user._id;
    const f = (req.body && req.body.filters) || {};
    if (typeof f !== "object") return res.status(400).json({ error: true, message: "filters must be an object" });
    const query = { userId, isDeleted: { $ne: true } };
    query.isArchived = f.archived === true ? true : { $ne: true };

    try {
        if (f.tag !== undefined) {
            if (typeof f.tag !== "string" || !f.tag.trim() || f.tag.length > MAX_TAG_CHARS) return res.status(400).json({ error: true, message: "Invalid tag" });
            query.tags = { $regex: new RegExp(`^${escapeRegex(f.tag.trim().replace(/^#+/, ""))}$`, "i") };
        }
        if (f.folderId !== undefined) {
            if (f.folderId === "none") {
                query.folderId = null;
            } else {
                if (typeof f.folderId !== "string" || !OBJECT_ID_RE.test(f.folderId)) return res.status(400).json({ error: true, message: "Invalid folderId" });
                const folders = await getUserFolders(userId);
                const alive = folders.filter((folder) => !folder.isDeleted);
                const subtree = collectSubtreeFolderIds(alive, f.folderId);
                if (subtree.length === 0) return res.status(400).json({ error: true, message: "Folder not found" });
                query.folderId = { $in: subtree };
            }
        }
        // Untitled = missing, null or blank — notes saved without a title are
        // stored with a single space, so match whitespace-only titles too.
        if (f.untitled === true) query.$or = [{ title: { $exists: false } }, { title: null }, { title: /^\s*$/ }];
        const dayMs = 24 * 60 * 60 * 1000;
        for (const key of ["notEditedForDays", "editedWithinDays"]) {
            if (f[key] !== undefined && (!Number.isInteger(f[key]) || f[key] < 0 || f[key] > 36500)) {
                return res.status(400).json({ error: true, message: `${key} must be a whole number of days` });
            }
        }
        if (f.notEditedForDays !== undefined || f.editedWithinDays !== undefined) {
            query.updatedAt = {};
            if (f.notEditedForDays !== undefined) query.updatedAt.$lt = new Date(Date.now() - f.notEditedForDays * dayMs);
            if (f.editedWithinDays !== undefined) query.updatedAt.$gte = new Date(Date.now() - f.editedWithinDays * dayMs);
        }

        const notes = await Note.find(query).select("_id title folderId tags isArchived updatedAt")
            .sort({ updatedAt: -1 }).limit(MAX_SELECT_NOTES + 1).lean();
        const truncated = notes.length > MAX_SELECT_NOTES;
        const shown = notes.slice(0, MAX_SELECT_NOTES);
        const folderNames = await folderNameMap(shown, userId);
        return res.json({
            error: false,
            truncated,
            notes: shown.map((n) => ({
                noteId: String(n._id),
                title: n.title || "",
                folderId: n.folderId || null,
                folder: n.folderId ? folderNames.get(String(n.folderId)) || null : null,
                tags: n.tags || [],
                isArchived: Boolean(n.isArchived),
                lastEdited: n.updatedAt,
            })),
        });
    } catch (error) {
        console.error(`[${req.id}] Agent select-notes failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// POST /v1/agent/selections — save split choices for a selection of more than
// 50 notes (called by the agent). Every note must be this user's.
const MAX_SELECTION_NOTES = 2000;
const MAX_PARTS = 40;

const createSelection = async (req, res) => {
    const userId = req.user._id;
    const { action, params, instruction, topic, keywords, filterReason, parts } = req.body || {};
    if (!ACTIONS.has(action)) return res.status(400).json({ error: true, message: "Invalid action" });
    if (!Array.isArray(parts) || parts.length < 2 || parts.length > MAX_PARTS) {
        return res.status(400).json({ error: true, message: `parts must hold 2-${MAX_PARTS} choices` });
    }
    const all = new Set();
    for (const part of parts) {
        if (!part || typeof part.label !== "string" || !part.label.trim() || part.label.length > 120
            || !Array.isArray(part.noteIds) || part.noteIds.length === 0 || part.noteIds.length > MAX_NOTES) {
            return res.status(400).json({ error: true, message: `each part needs a label and 1-${MAX_NOTES} notes` });
        }
        for (const id of part.noteIds) {
            if (typeof id !== "string" || !OBJECT_ID_RE.test(id) || all.has(id)) {
                return res.status(400).json({ error: true, message: "parts must not share notes" });
            }
            all.add(id);
        }
    }
    if (all.size > MAX_SELECTION_NOTES) return res.status(400).json({ error: true, message: "Selection too large" });
    const strings = (v, max, n) => Array.isArray(v) && v.length <= n && v.every((s) => typeof s === "string" && s.length <= max);
    if ((topic !== undefined && (typeof topic !== "string" || topic.length > 500))
        || (keywords !== undefined && !strings(keywords, 100, 5))
        || (filterReason !== undefined && (typeof filterReason !== "string" || filterReason.length > MAX_REASON_CHARS))
        || (instruction !== undefined && (typeof instruction !== "string" || instruction.length > MAX_INSTRUCTION_CHARS))) {
        return res.status(400).json({ error: true, message: "Invalid selection details" });
    }

    try {
        if (!allowsBulkAction(await getAgentScopes(userId), action)) {
            return res.status(403).json({ error: true, message: SCOPE_OFF_MESSAGE(action) });
        }
        const normalized = await normalizeParams(action, params, userId);
        if (normalized.error) return res.status(400).json({ error: true, message: normalized.error });
        const owned = await Note.countDocuments({ _id: { $in: [...all] }, userId, isDeleted: { $ne: true } });
        if (owned !== all.size) return res.status(400).json({ error: true, message: "Some notes were not found" });

        const selection = await AgentSelection.create({
            selectionId: crypto.randomUUID(),
            userId, action, params: normalized.params,
            instruction: instruction || "", topic: topic || "", keywords: keywords || [], filterReason: filterReason || "",
            parts: parts.map((p) => ({ label: p.label.trim(), noteIds: p.noteIds })),
        });
        return res.status(201).json({
            error: false,
            selectionId: selection.selectionId,
            action, params: normalized.params,
            parts: selection.parts.map((p, index) => ({ index, label: p.label, count: p.noteIds.length })),
        });
    } catch (error) {
        console.error(`[${req.id}] Agent selection failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// POST /v1/agent/selections/:selectionId/parts/:index/open — turn one split
// choice into a review list. With a topic, FastAPI's borderline check judges
// just this part's notes first.
const JUDGE_TIMEOUT_MS = 45_000;

const openSelectionPart = async (req, res) => {
    const userId = req.user._id;
    const index = Number(req.params.index);
    try {
        const selection = await AgentSelection.findOne({ selectionId: req.params.selectionId, userId }).lean();
        if (!selection) return res.status(404).json({ error: true, message: "These choices have expired — ask the agent again" });
        const part = Number.isInteger(index) ? selection.parts[index] : null;
        if (!part) return res.status(404).json({ error: true, message: "Choice not found" });

        let candidates = part.noteIds.map((noteId) => ({ noteId, verdict: "likely", reason: selection.filterReason }));
        if (selection.topic) {
            const url = process.env.FASTAPI_SUMMARIZE_URL;
            if (!url) return res.status(500).json({ error: true, message: "AI service is not configured" });
            const key = process.env.FASTAPI_INTERNAL_KEY;
            const response = await fetch(`${url}/agent/judge-part`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: req.headers["authorization"],
                    "x-user-id": String(userId),
                    ...(key ? { "x-api-key": key } : {}),
                },
                body: JSON.stringify({ topic: selection.topic, keywords: selection.keywords, noteIds: part.noteIds }),
                signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !Array.isArray(data?.candidates)) {
                console.error(`[${req.id}] judge-part failed (${response.status}):`, JSON.stringify(data).slice(0, 300));
                return res.status(502).json({ error: true, message: data?.detail || "The assistant couldn't check these notes right now. Try again shortly." });
            }
            candidates = data.candidates;
        }

        const { status, body } = await saveProposal(userId, {
            action: selection.action, params: selection.params, instruction: selection.instruction, candidates,
        }, selection.chatId || null);
        // Which button opened the list, so the chat can scroll to it instead of
        // opening a duplicate (kept after a refresh too).
        const openedFrom = `part:${selection.selectionId}:${index}`;
        if (status === 201 && selection.chatId) {
            // Keep the opened list in its chat, so it's still there after a refresh.
            const proposal = { proposalId: body.proposalId, action: body.action, params: body.params, candidates: body.candidates, openedFrom };
            try {
                await appendTurns(userId, selection.chatId, [{
                    role: "assistant",
                    text: `Opened “${part.label}” — ${body.candidates.length} notes to review below.`,
                    citations: [],
                    proposal,
                }]);
            } catch (persistError) {
                console.error(`[${req.id}] Saving the opened part to the chat failed:`, persistError.message);
            }
        }
        return res.status(status).json({ ...body, partLabel: part.label, openedFrom });
    } catch (error) {
        console.error(`[${req.id}] Agent open-part failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// ── Groupings (suggest_groups): groups of related notes → review lists ──
const MAX_GROUPS = 8;
const MAX_GROUP_NOTES = 200;
const MAX_GROUP_NAME_CHARS = 40;
const GROUP_TAG_RE = /^[a-z0-9-]{1,30}$/;
const SAMPLE_TITLES = 3;

const groupSummary = (group, index, titles) => ({
    index,
    name: group.name,
    tag: group.tag,
    count: group.noteIds.length,
    misfitCount: group.misfits.length,
    sampleTitles: group.noteIds.filter((id) => !group.misfits.some((m) => m.noteId === id)).slice(0, SAMPLE_TITLES)
        .map((id) => titles.get(id) || "Untitled"),
});

// POST /v1/agent/groupings — save suggested groups (called by the agent).
const createGrouping = async (req, res) => {
    const userId = req.user._id;
    const { instruction, groups, ungroupedCount, notIndexedCount, scannedCount, totalCount } = req.body || {};
    if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_GROUPS) {
        return res.status(400).json({ error: true, message: `groups must hold 1-${MAX_GROUPS} groups` });
    }
    if (instruction !== undefined && (typeof instruction !== "string" || instruction.length > MAX_INSTRUCTION_CHARS)) {
        return res.status(400).json({ error: true, message: "instruction is too long" });
    }
    const all = new Set();
    for (const g of groups) {
        if (!g || typeof g.name !== "string" || !g.name.trim() || g.name.length > MAX_GROUP_NAME_CHARS
            || typeof g.tag !== "string" || !GROUP_TAG_RE.test(g.tag)
            || !Array.isArray(g.noteIds) || g.noteIds.length < 2 || !Array.isArray(g.misfits || [])) {
            return res.status(400).json({ error: true, message: "each group needs a name, a tag and 2+ notes" });
        }
        for (const id of g.noteIds) {
            if (typeof id !== "string" || !OBJECT_ID_RE.test(id) || all.has(id)) {
                return res.status(400).json({ error: true, message: "groups must not share notes" });
            }
            all.add(id);
        }
        for (const m of g.misfits || []) {
            if (!m || !g.noteIds.includes(m.noteId) || (m.reason !== undefined && (typeof m.reason !== "string" || m.reason.length > MAX_REASON_CHARS))) {
                return res.status(400).json({ error: true, message: "misfits must be notes of their group" });
            }
        }
    }
    if (all.size > MAX_GROUP_NOTES) return res.status(400).json({ error: true, message: "Too many notes" });
    const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

    try {
        if (!allowsBulkAction(await getAgentScopes(userId), "move")) {
            return res.status(403).json({ error: true, message: SCOPE_OFF_MESSAGE("move") });
        }
        const notes = await Note.find({ _id: { $in: [...all] }, userId, isDeleted: { $ne: true } }).select("_id title").lean();
        if (notes.length !== all.size) return res.status(400).json({ error: true, message: "Some notes were not found" });
        const titles = new Map(notes.map((n) => [String(n._id), (n.title || "").trim()]));
        const grouping = await AgentGrouping.create({
            groupingId: crypto.randomUUID(),
            userId,
            instruction: instruction || "",
            groups: groups.map((g) => ({
                name: g.name.trim(),
                tag: g.tag,
                noteIds: g.noteIds,
                misfits: (g.misfits || []).map((m) => ({ noteId: m.noteId, reason: m.reason || "" })),
            })),
        });
        return res.status(201).json({
            error: false,
            groupingId: grouping.groupingId,
            groups: grouping.groups.map((g, i) => groupSummary(g, i, titles)),
            ungroupedCount: count(ungroupedCount),
            notIndexedCount: count(notIndexedCount),
            scannedCount: count(scannedCount),
            totalCount: count(totalCount),
        });
    } catch (error) {
        console.error(`[${req.id}] Agent grouping failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// POST /v1/agent/groupings/:groupingId/groups/:index/propose — { action:
// "new-folder" | "tag" } → a review list for that group: its notes ticked,
// the ones that may not fit unticked with the AI's reason.
const GROUP_ACTIONS = new Set(["new-folder", "tag"]);

const proposeGroup = async (req, res) => {
    const userId = req.user._id;
    const index = Number(req.params.index);
    const { action } = req.body || {};
    if (!GROUP_ACTIONS.has(action)) return res.status(400).json({ error: true, message: "action must be new-folder or tag" });
    try {
        const grouping = await AgentGrouping.findOne({ groupingId: req.params.groupingId, userId }).lean();
        if (!grouping) return res.status(404).json({ error: true, message: "These groups expired — ask again" });
        const group = Number.isInteger(index) ? grouping.groups[index] : null;
        if (!group) return res.status(404).json({ error: true, message: "Group not found" });
        if (group.noteIds.length > MAX_NOTES) {
            return res.status(400).json({ error: true, message: `This group has ${group.noteIds.length} notes — more than ${MAX_NOTES} for one review list. Ask the agent to group a smaller set.` });
        }
        // Notes trashed since the groups were made are left out.
        const living = new Set((await Note.find({ _id: { $in: group.noteIds }, userId, isDeleted: { $ne: true } }).select("_id").lean())
            .map((n) => String(n._id)));
        const misfits = new Map(group.misfits.map((m) => [m.noteId, m.reason]));
        const candidates = group.noteIds.filter((id) => living.has(id)).map((noteId) => (misfits.has(noteId)
            ? { noteId, verdict: "rejected", reason: misfits.get(noteId) || "may not fit this group" }
            : { noteId, verdict: "likely", reason: `grouped as “${group.name}”` }));
        if (candidates.length === 0) return res.status(400).json({ error: true, message: "None of these notes exist any more" });

        const proposalInput = action === "new-folder"
            ? { action: "move", params: { newFolderName: group.name }, instruction: `move “${group.name}” group to a new folder` }
            : { action: "tag", params: { add: [group.tag] }, instruction: `tag “${group.name}” group #${group.tag}` };
        const { status, body } = await saveProposal(userId, { ...proposalInput, candidates }, grouping.chatId || null);
        const openedFrom = `group:${grouping.groupingId}:${index}:${action}`;
        if (status === 201 && grouping.chatId) {
            const proposal = { proposalId: body.proposalId, action: body.action, params: body.params, candidates: body.candidates, openedFrom };
            try {
                await appendTurns(userId, grouping.chatId, [{
                    role: "assistant",
                    text: `Review list for “${group.name}” — ${body.candidates.length} notes below.`,
                    citations: [],
                    proposal,
                }]);
            } catch (persistError) {
                console.error(`[${req.id}] Saving the group's review list to the chat failed:`, persistError.message);
            }
        }
        return res.status(status).json({ ...body, groupName: group.name, openedFrom });
    } catch (error) {
        console.error(`[${req.id}] Agent group proposal failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// POST /v1/agent/proposals/:proposalId/apply — { noteIds } (the ticked rows).
const applyProposal = async (req, res) => {
    const userId = req.user._id;
    const { proposalId } = req.params;
    const { noteIds } = req.body || {};
    if (!Array.isArray(noteIds) || noteIds.length === 0 || noteIds.length > MAX_NOTES
        || !noteIds.every((id) => typeof id === "string" && OBJECT_ID_RE.test(id))
        || new Set(noteIds).size !== noteIds.length) {
        return res.status(400).json({ error: true, message: `noteIds must be 1-${MAX_NOTES} distinct note IDs` });
    }

    try {
        const proposal = await AgentProposal.findOne({ proposalId, userId }).lean();
        if (!proposal) return res.status(404).json({ error: true, message: "Proposal not found" });

        const existing = await AgentReceipt.findOne({ proposalId, userId }).lean();
        if (existing) return res.json({ error: false, alreadyApplied: true, receipt: summarizeReceipt(existing) });

        const candidates = new Map(proposal.candidates.map((c) => [c.noteId, c]));
        if (noteIds.some((id) => !candidates.has(id))) {
            return res.status(400).json({ error: true, message: "Only notes from the review list can be applied" });
        }

        let changes = [];
        let receipt;
        try {
            receipt = await withRequiredTransaction(async (session) => {
                changes = [];   // the transaction callback may be retried
                // The target folder may have gone to Trash since the list was made.
                if (proposal.action === "move" && proposal.params.targetFolderId
                    && !(await findLivingFolder(proposal.params.targetFolderId, userId, session))) {
                    throw new TargetFolderGoneError();
                }
                const notes = await Note.find({ _id: { $in: noteIds }, userId }).session(session);
                const byId = new Map(notes.map((n) => [String(n._id), n]));
                const ops = [];
                // "Move to a new folder": the folder is made, in this same
                // transaction, only once a note is actually going to move.
                const params = { ...proposal.params };
                for (const noteId of noteIds) {
                    const candidate = candidates.get(noteId);
                    const note = byId.get(noteId);
                    if (!note || !sameState(stateOf(note), candidate.snapshot)) {
                        ops.push({ noteId, title: note?.title || candidate.title, before: note ? stateOf(note) : null, after: null, status: "skipped-changed" });
                        continue;
                    }
                    if (params.newFolderName && !params.targetFolderId) {
                        const folder = await createFolderRecord({ userId, name: params.newFolderName }, session);
                        params.targetFolderId = String(folder._id);
                        params.createdFolderId = String(folder._id);
                    }
                    const before = stateOf(note);
                    await applyAction(note, proposal.action, params, userId, session);
                    const after = stateOf(note);
                    if (sameState(before, after)) {
                        ops.push({ noteId, title: note.title, before, after, status: "skipped-unchanged" });
                        continue;
                    }
                    await note.save({ session });
                    ops.push({ noteId, title: note.title, before, after, status: "applied" });
                    changes.push({ noteId, wasDeleted: before.isDeleted, isDeleted: after.isDeleted });
                }
                const [created] = await AgentReceipt.create([{
                    proposalId, userId, instruction: proposal.instruction, action: proposal.action, params, ops,
                }], { session });
                await AgentProposal.updateOne({ proposalId, userId }, { $set: { status: "applied", receiptId: String(created._id) } }, { session });
                return created;
            });
        } catch (error) {
            if (error instanceof TargetFolderGoneError) {
                return res.status(409).json({ error: true, message: error.message });
            }
            if (error?.code === 11000) {
                // A simultaneous Apply won the race; return its receipt.
                const winner = await AgentReceipt.findOne({ proposalId, userId }).lean();
                if (winner) return res.json({ error: false, alreadyApplied: true, receipt: summarizeReceipt(winner) });
            }
            return transactionError(res, req, error);
        }

        if (proposal.action !== "move") syncSearchIndex(changes, userId);
        return res.json({ error: false, receipt: summarizeReceipt(receipt) });
    } catch (error) {
        return transactionError(res, req, error);
    }
};

// POST /v1/agent/receipts/:receiptId/undo
const undoReceipt = async (req, res) => {
    const userId = req.user._id;
    const { receiptId } = req.params;
    if (!OBJECT_ID_RE.test(receiptId || "")) return res.status(400).json({ error: true, message: "Invalid receipt" });

    try {
        const found = await AgentReceipt.findOne({ _id: receiptId, userId }).lean();
        if (!found) return res.status(404).json({ error: true, message: "Receipt not found" });
        if (found.status !== "applied") {
            return res.status(409).json({ error: true, message: "This change was already undone", receipt: summarizeReceipt(found) });
        }

        let changes = [];
        let receipt;
        try {
            receipt = await withRequiredTransaction(async (session) => {
                changes = [];
                const doc = await AgentReceipt.findOne({ _id: receiptId, userId }).session(session);
                const appliedIds = doc.ops.filter((op) => op.status === "applied").map((op) => op.noteId);
                const notes = await Note.find({ _id: { $in: appliedIds }, userId }).session(session);
                const byId = new Map(notes.map((n) => [String(n._id), n]));
                for (const op of doc.ops) {
                    if (op.status !== "applied") continue;
                    const note = byId.get(op.noteId);
                    // Changed since the agent's edit (or gone): leave it, report it.
                    if (!note || !sameState(stateOf(note), op.after)) {
                        op.status = "undo-skipped";
                        continue;
                    }
                    const wasDeleted = Boolean(note.isDeleted);
                    note.tags = [...op.before.tags];
                    note.isArchived = op.before.isArchived;
                    note.showInHome = op.before.showInHome;
                    note.folderId = op.before.folderId;
                    if (!op.before.isDeleted && note.isDeleted) {
                        // Refused if it went to Trash with its folder since (e.g.
                        // restored, then the folder was trashed): it comes back
                        // with the folder. The unsaved edits above are dropped.
                        if (await restoreFromTrash(note, userId, session)) {
                            op.status = "undo-skipped";
                            continue;
                        }
                    } else {
                        note.folderId = await livingFolderId(note.folderId, userId, session);
                        if (op.before.isDeleted && !note.isDeleted) Object.assign(note, trashFields());
                    }
                    await note.save({ session });
                    op.status = "undone";
                    changes.push({ noteId: op.noteId, wasDeleted, isDeleted: Boolean(note.isDeleted) });
                }
                // A folder this change created goes to Trash once it's empty
                // again (restorable); kept if anything else is in it now.
                if (doc.params?.createdFolderId && await trashFolderIfEmpty(doc.params.createdFolderId, userId, session)) {
                    doc.params = { ...doc.params, createdFolderTrashed: true };
                    doc.markModified("params");
                }
                const remaining = doc.ops.some((op) => op.status === "undo-skipped");
                doc.status = remaining ? "partially-undone" : "undone";
                doc.undoneAt = new Date();
                await doc.save({ session });
                return doc;
            });
        } catch (error) {
            return transactionError(res, req, error);
        }

        if (receipt.action !== "move") syncSearchIndex(changes, userId);
        return res.json({ error: false, receipt: summarizeReceipt(receipt) });
    } catch (error) {
        return transactionError(res, req, error);
    }
};

// GET /v1/agent/receipts — newest first (the activity log, step 3d).
const listReceipts = async (req, res) => {
    try {
        const receipts = await AgentReceipt.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
        return res.json({ error: false, receipts: receipts.map(summarizeReceipt) });
    } catch (error) {
        console.error(`[${req.id}] Agent receipts list failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

module.exports = {
    createProposal, applyProposal, undoReceipt, listReceipts, selectNotes, createSelection, openSelectionPart, stateOf, sameState,
    createGrouping, proposeGroup,
};
