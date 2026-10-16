const crypto = require("node:crypto");
const Note = require("../models/note.model");
const Folder = require("../models/folder.model");
const AgentProposal = require("../models/agent-proposal.model");
const AgentReceipt = require("../models/agent-receipt.model");
const AgentSelection = require("../models/agent-selection.model");
const AgentChat = require("../models/agent-chat.model");
const { withRequiredTransaction, TransactionsUnavailableError } = require("../services/mongo-transaction.service");
const { collectSubtreeFolderIds, getUserFolders } = require("../services/folder-tree.service");
const {
    isValidFolderId, findLivingFolder, livingFolderId, moveToFolder, setArchived, trashFields, restoreFromTrash,
    createFolderRecord, trashFolderIfEmpty,
} = require("../services/note-actions.service");
const {
    MAX_LIST, groupParts, planFromProposal, planFromSelection, restrictPlan, mergePlans, buildCandidates, applyChanges, changeTitle, splitParts,
} = require("../services/bulk-plan.service");
const { changesOf, pendingOf, pendingSummary, markMoved, summarizeReceipt } = require("../services/pending-list.service");
const { triggerEmbed, deleteEmbed } = require("./note.controller");
const { appendTurns } = require("./agent.controller");
const { allowsBulkAction, getAgentScopes } = require("../services/agent-scopes.service");

const SCOPE_OFF_MESSAGE = (action) => (action === "trash"
    ? "Sending notes to trash is turned off in the agent settings"
    : "Bulk changes are turned off in the agent settings");

// The agent's bulk changes (architecture plan §2.3, step 3a):
// propose (a saved review list) → apply (one transaction, receipt in the same
// transaction) → undo (one transaction, never over the user's newer edits).
// A review list holds one or more changes, combined per note
// (services/bulk-plan.service.js). Every query is scoped to req.user._id;
// there is no permanent-delete action.

const ACTIONS = new Set(["move", "tag", "archive", "trash"]);
const VERDICTS = new Set(["likely", "rejected", "unjudged"]);
const MAX_NOTES = MAX_LIST;
const MAX_CHANGES = 20;
const MAX_SELECTION_NOTES = 2000;
const MAX_TAGS_PER_ACTION = 10;
const MAX_TAG_CHARS = 50;
const MAX_REASON_CHARS = 300;
const MAX_INSTRUCTION_CHARS = 500;
const MAX_FOLDER_NAME_CHARS = 80;
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const OVER_LIMIT_MESSAGE = `Your pending list would go over ${MAX_NOTES} notes with this — apply or discard it first.`;

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

const itemsOf = (candidate) => (Array.isArray(candidate.items) && candidate.items.length > 0
    ? candidate.items
    : [{ change: "c1", verdict: candidate.verdict || "likely", reason: candidate.reason || "", label: "", clashesWith: [] }]);

// Search-index follow-ups after a commit (fire-and-forget, like note saves):
// trashed notes lose their pieces; restored / re-tagged / (un)archived notes
// are re-indexed. Moves need nothing (folders aren't indexed).
const indexedChange = (before, after) => Boolean(before && after) && (
    before.isDeleted !== after.isDeleted || before.isArchived !== after.isArchived
    || [...before.tags].sort().join("\u0000") !== [...after.tags].sort().join("\u0000"));

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

const folderNameMap = async (notes, userId) => {
    const folderIds = [...new Set(notes.map((n) => n.folderId).filter(Boolean).map(String))];
    const folders = folderIds.length ? await Folder.find({ _id: { $in: folderIds }, userId }).select("_id name").lean() : [];
    return new Map(folders.map((f) => [String(f._id), f.name || ""]));
};

// ── Saving a review list ──
//
// The user has at most ONE pending (open) list across the account, updated
// in place: new changes are added to it, so two lists can never compete for
// the same note. While one is pending, the agent's changes for a separate
// task are "held" (not appliable) until the user adds them to the pending
// list or shows them after finishing it. Buttons (split choices) always add.

const MAX_GROUPS = 8;
const MAX_GROUP_NAME_CHARS = 40;
const GROUP_TAG_RE = /^[a-z0-9-]{1,30}$/;

const parseCandidates = (list, key, items) => {
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SELECTION_NOTES) {
        return `each change needs 1-${MAX_SELECTION_NOTES} notes`;
    }
    const seen = new Set();
    for (const cand of list) {
        if (!cand || typeof cand.noteId !== "string" || !OBJECT_ID_RE.test(cand.noteId) || seen.has(cand.noteId)) {
            return "candidates must be distinct note IDs";
        }
        if (cand.verdict !== undefined && !VERDICTS.has(cand.verdict)) return "Invalid verdict";
        if (cand.reason !== undefined && (typeof cand.reason !== "string" || cand.reason.length > MAX_REASON_CHARS)) return "reason is too long";
        seen.add(cand.noteId);
        items.set(cand.noteId, [...(items.get(cand.noteId) || []), {
            change: key, verdict: cand.verdict || "likely", reason: cand.reason || "", pending: cand.pending === true,
        }]);
    }
    return null;
};

// The request's changes as a plan. Accepts { changes: [{ action, params,
// instruction, topic, keywords, candidates: [{ noteId, verdict, reason,
// pending }] }] }, the single-change form { action, params, instruction,
// candidates }, or grouping's { groups: [{ name, tag, noteIds, misfits }] }
// (each group → "move to new folder <name>" + "tag #<tag>"). Returns
// { plan } or { error }.
const planFromInput = async (body, userId) => {
    if (Array.isArray(body.groups)) return planFromGroups(body.groups);
    const raw = Array.isArray(body.changes)
        ? body.changes
        : [{ action: body.action, params: body.params, instruction: body.instruction, candidates: body.candidates }];
    if (raw.length === 0 || raw.length > MAX_CHANGES) return { error: `changes must hold 1-${MAX_CHANGES} changes` };
    const changes = [];
    const items = new Map();
    for (const [index, c] of raw.entries()) {
        if (!c || typeof c !== "object") return { error: "Invalid change" };
        if (!ACTIONS.has(c.action)) return { error: "action must be move, tag, archive or trash" };
        if (c.instruction !== undefined && (typeof c.instruction !== "string" || c.instruction.length > MAX_INSTRUCTION_CHARS)) {
            return { error: "instruction is too long" };
        }
        if (c.topic !== undefined && (typeof c.topic !== "string" || c.topic.length > MAX_INSTRUCTION_CHARS)) return { error: "topic is too long" };
        if (c.keywords !== undefined && !(Array.isArray(c.keywords) && c.keywords.length <= 5
            && c.keywords.every((k) => typeof k === "string" && k.length <= 100))) return { error: "Invalid keywords" };
        const normalized = await normalizeParams(c.action, c.params, userId);
        if (normalized.error) return { error: normalized.error };
        const key = `c${index + 1}`;
        changes.push({
            key, action: c.action, params: normalized.params, instruction: c.instruction || "", topic: c.topic || "", keywords: c.keywords || [],
        });
        const problem = parseCandidates(c.candidates, key, items);
        if (problem) return { error: problem };
    }
    if (items.size > MAX_SELECTION_NOTES) return { error: "Too many notes" };
    return { plan: { changes, items, groups: [] } };
};

const planFromGroups = (groups) => {
    if (groups.length === 0 || groups.length > MAX_GROUPS) return { error: `groups must hold 1-${MAX_GROUPS} groups` };
    const changes = [];
    const items = new Map();
    const meta = [];
    for (const g of groups) {
        if (!g || typeof g.name !== "string" || !g.name.trim() || g.name.length > MAX_GROUP_NAME_CHARS
            || typeof g.tag !== "string" || !GROUP_TAG_RE.test(g.tag)
            || !Array.isArray(g.noteIds) || g.noteIds.length < 2 || !Array.isArray(g.misfits || [])) {
            return { error: "each group needs a name, a tag and 2+ notes" };
        }
        if (g.noteIds.some((id) => typeof id !== "string" || !OBJECT_ID_RE.test(id) || items.has(id))) {
            return { error: "groups must not share notes" };
        }
        const misfits = new Map();
        for (const m of g.misfits || []) {
            if (!m || !g.noteIds.includes(m.noteId) || (m.reason !== undefined && (typeof m.reason !== "string" || m.reason.length > MAX_REASON_CHARS))) {
                return { error: "misfits must be notes of their group" };
            }
            misfits.set(m.noteId, m.reason || "may not fit this group");
        }
        const name = g.name.trim();
        const moveKey = `c${changes.length + 1}`;
        const tagKey = `c${changes.length + 2}`;
        changes.push({ key: moveKey, action: "move", params: { targetFolderId: null, newFolderName: name, targetFolderName: name }, instruction: `move “${name}” group to a new folder` });
        changes.push({ key: tagKey, action: "tag", params: { add: [g.tag], remove: [] }, instruction: `tag “${name}” group #${g.tag}` });
        for (const noteId of g.noteIds) {
            const item = misfits.has(noteId)
                ? { verdict: "rejected", reason: misfits.get(noteId) }
                : { verdict: "likely", reason: `grouped as “${name}”` };
            items.set(noteId, [{ change: moveKey, ...item, pending: false }, { change: tagKey, ...item, pending: false }]);
        }
        meta.push({ name, tag: g.tag, noteIds: [...g.noteIds], changes: [moveKey, tagKey] });
    }
    return { plan: { changes, items, groups: meta } };
};

// The plan worked out against the notes' current state.
const buildList = async (userId, plan) => {
    const notes = await Note.find({ _id: { $in: [...plan.items.keys()] }, userId })
        .select("_id title folderId showInHome tags isArchived isDeleted updatedAt").lean();
    const notesById = new Map(notes.map((n) => [String(n._id), n]));
    const built = buildCandidates(plan, notesById, stateOf);
    const usedChanges = new Set(built.candidates.flatMap((c) => c.items.map((i) => i.change)));
    const listed = new Set(built.candidates.map((c) => c.noteId));
    const groups = (plan.groups || [])
        .map((g) => ({ ...g, noteIds: g.noteIds.filter((id) => listed.has(id)), changes: g.changes.filter((k) => usedChanges.has(k)) }))
        .filter((g) => g.noteIds.length > 0 && g.changes.length > 0);
    return {
        ...built,
        notesById,
        folderNames: await folderNameMap(notes, userId),
        changes: plan.changes.filter((c) => usedChanges.has(c.key)),
        groups,
        clashCount: built.candidates.filter((c) => c.items.some((i) => i.clashesWith.length > 0)).length,
    };
};

const proposalBody = (doc, folderNames, notesById, extra = {}) => {
    const changes = changesOf(doc);
    return {
        error: false,
        proposalId: doc.proposalId,
        status: doc.status === "held" ? "held" : "open",
        version: doc.version || 1,
        heldReason: doc.heldReason || null,
        changes: changes.map((c) => ({ key: c.key, action: c.action, params: c.params, instruction: c.instruction || "", title: changeTitle(c) })),
        // The single-change form, for callers that only know one change.
        ...(changes.length === 1 ? { action: changes[0].action, params: changes[0].params } : {}),
        groups: (doc.groups || []).map((g) => ({ name: g.name, tag: g.tag, noteIds: g.noteIds, changes: g.changes })),
        candidates: doc.candidates.map((c) => {
            const folderId = notesById.get(c.noteId)?.folderId;
            const items = itemsOf(c).map((i) => ({
                change: i.change, verdict: i.verdict, reason: i.reason, label: i.label || "", clashesWith: i.clashesWith || [],
            }));
            return {
                noteId: c.noteId, title: c.title, folder: folderId ? folderNames.get(String(folderId)) || null : null, items,
                verdict: items[0].verdict, reason: items[0].reason,
            };
        }),
        openedFrom: doc.openedFrom || [],
        ...extra,
    };
};

// Writes a built list into `doc` (an existing pending / held list, updated in
// place) or a new one. Returns the saved document.
const writeList = async (userId, built, { doc = null, status, chatId = null, openedFrom = [], heldReason = null }) => {
    const fields = {
        changes: built.changes,
        candidates: built.candidates,
        groups: built.groups.length > 0 ? built.groups : undefined,
        instruction: built.changes.map((c) => c.instruction).filter(Boolean).join(" · ").slice(0, MAX_INSTRUCTION_CHARS),
        status,
        heldReason: status === "held" ? heldReason : null,
    };
    if (doc) {
        Object.assign(doc, fields);
        doc.openedFrom = [...new Set([...(doc.openedFrom || []), ...openedFrom])];
        doc.version = (doc.version || 1) + 1;
        if (chatId) doc.chatId = chatId;
        doc.markModified("changes");
        doc.markModified("candidates");
        doc.markModified("groups");
        return doc.save();
    }
    return AgentProposal.create({ proposalId: crypto.randomUUID(), userId, chatId, openedFrom, ...fields });
};

const splitSelection = async (userId, plan, built, chatId) => {
    const noteItems = Object.fromEntries(built.candidates.map((c) => [c.noteId, c.items.map((i) => ({
        change: i.change, verdict: i.verdict, reason: i.reason, pending: i.pending,
    }))]));
    const parts = built.groups.length > 0
        ? groupParts(built.groups)
        : splitParts(built.candidates.map((c) => {
            const note = built.notesById.get(c.noteId);
            return { noteId: c.noteId, folder: note.folderId ? built.folderNames.get(String(note.folderId)) || null : null, tags: note.tags || [], lastEdited: note.updatedAt };
        }));
    if (parts.length === 0) return null;
    const selection = await AgentSelection.create({
        selectionId: crypto.randomUUID(), userId, chatId, changes: built.changes, noteItems,
        groups: built.groups.length > 0 ? built.groups : undefined, parts,
    });
    return {
        selectionId: selection.selectionId,
        total: built.candidates.length,
        changes: built.changes.map((c) => ({ key: c.key, action: c.action, params: c.params, title: changeTitle(c) })),
        parts: selection.parts.map((p, index) => ({ index, label: p.label, count: p.noteIds.length })),
    };
};

// Saves new changes. `mode`: "add" (into the pending list, or a new one when
// none is pending) or "separate" (held when a list is pending — the agent
// judged it a different task). `source`: "agent" holds what doesn't fit
// under 50 with the pending list; "button" refuses it. `heldId`: the held
// list this reply already started (extended in place).
const savePlan = async (userId, plan, {
    mode = "add", source = "agent", heldId = null, chatId = null, openedFrom = [], allowSplit = false, requiredNoteIds = [],
} = {}) => {
    const required = [...new Set(requiredNoteIds)];
    if (required.length > 0) {
        const owned = await Note.countDocuments({ _id: { $in: required }, userId, isDeleted: { $ne: true } });
        if (owned !== required.length) return { status: 400, body: { error: true, message: "Some notes were not found" } };
    }
    const scopes = await getAgentScopes(userId);
    const refused = plan.changes.find((c) => !allowsBulkAction(scopes, c.action));
    if (refused) return { status: 403, body: { error: true, message: SCOPE_OFF_MESSAGE(refused.action) } };

    const alone = await buildList(userId, plan);
    if (alone.candidates.length === 0) {
        return { status: 200, body: { error: false, empty: true, alreadyCount: alone.alreadyCount, goneCount: alone.goneCount, message: "Nothing to change — every note is already like that." } };
    }
    const counts = { alreadyCount: alone.alreadyCount, goneCount: alone.goneCount };
    if (alone.candidates.length > MAX_NOTES) {
        if (!allowSplit) return { status: 400, body: { error: true, message: `candidates must hold 1-${MAX_NOTES} notes` } };
        const splitChoices = await splitSelection(userId, plan, alone, chatId);
        if (!splitChoices) return { status: 400, body: { error: true, message: `Every group has more than ${MAX_NOTES} notes — ask for a smaller set.` } };
        return { status: 201, body: { error: false, splitChoices, ...counts } };
    }

    const pending = await pendingOf(userId);
    const hold = async (heldReason) => {
        const held = heldId ? await AgentProposal.findOne({ proposalId: heldId, userId, status: "held" }) : null;
        const built = held ? await buildList(userId, mergePlans([planFromProposal(held), plan])) : alone;
        const doc = await writeList(userId, built, { doc: held, status: "held", chatId, openedFrom, heldReason });
        return { status: 201, body: proposalBody(doc.toObject(), built.folderNames, built.notesById, { ...counts, clashCount: built.clashCount, pending: pendingSummary(pending) }) };
    };
    if (pending && mode === "separate") return hold("separate");

    const built = pending ? await buildList(userId, mergePlans([planFromProposal(pending), plan])) : alone;
    if (built.candidates.length > MAX_NOTES) {
        if (source === "agent") return hold("too-many");
        return { status: 409, body: { error: true, message: OVER_LIMIT_MESSAGE } };
    }
    const doc = await writeList(userId, built, { doc: pending, status: "open", chatId, openedFrom });
    return {
        status: 201,
        body: proposalBody(doc.toObject(), built.folderNames, built.notesById, { ...counts, clashCount: built.clashCount, extended: Boolean(pending) }),
    };
};

// The list as stored in a chat turn (shown again after a refresh).
const chatProposal = (body) => ({
    proposalId: body.proposalId, status: body.status, version: body.version, heldReason: body.heldReason,
    changes: body.changes, groups: body.groups, candidates: body.candidates, openedFrom: body.openedFrom || [],
});

// Puts `body` (a list) into the chat turn that holds `turnProposalId` (a held
// list being added / shown), after pointing older turns at it.
const hostInTurn = async (userId, turnProposalId, body) => {
    await markMoved(userId, body.proposalId);
    await AgentChat.collection.updateOne(
        { userId: String(userId), "turns.proposal.proposalId": turnProposalId },
        { $set: { "turns.$.proposal": chatProposal(body) } },
    );
};

// POST /v1/agent/proposals — save changes (called by the agent).
// { changes | action+params+candidates | groups, chatId?, mode?, heldId?, split? }
const createProposal = async (req, res) => {
    const userId = req.user._id;
    const body = req.body || {};
    try {
        const parsed = await planFromInput(body, userId);
        if (parsed.error) return res.status(400).json({ error: true, message: parsed.error });
        const chatId = typeof body.chatId === "string" && OBJECT_ID_RE.test(body.chatId) ? body.chatId : null;
        const { status, body: out } = await savePlan(userId, parsed.plan, {
            mode: body.mode === "separate" ? "separate" : "add",
            heldId: typeof body.heldId === "string" ? body.heldId : null,
            chatId,
            allowSplit: body.split === true,
            requiredNoteIds: [...parsed.plan.items.keys()],
        });
        return res.status(status).json(out);
    } catch (error) {
        console.error(`[${req.id}] Agent proposal failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// GET /v1/agent/proposals/pending — the user's pending list in brief (for
// the agent's context), or null.
const getPending = async (req, res) => {
    try {
        return res.json({ error: false, pending: pendingSummary(await pendingOf(req.user._id)) });
    } catch (error) {
        console.error(`[${req.id}] Agent pending lookup failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// POST /v1/agent/proposals/:proposalId/add — a held list's changes go into
// the pending list (or it becomes the pending list when none is).
// POST /v1/agent/proposals/:proposalId/show — "show it after": a held list
// becomes the pending list once nothing else is pending.
const releaseHeld = (into) => async (req, res) => {
    const userId = req.user._id;
    try {
        const held = await AgentProposal.findOne({ proposalId: req.params.proposalId, userId });
        if (!held) return res.status(404).json({ error: true, message: "These changes expired — ask again" });
        if (held.status !== "held") return res.status(409).json({ error: true, message: `These changes were already ${held.status === "open" ? "shown" : held.status}`, status: held.status });
        const pending = await pendingOf(userId);
        if (pending && into === "show") {
            return res.status(409).json({ error: true, message: "Apply or discard your pending list first", pendingChatId: pending.chatId });
        }
        const built = await buildList(userId, pending ? mergePlans([planFromProposal(pending), planFromProposal(held)]) : planFromProposal(held));
        if (built.candidates.length === 0) {
            held.status = "discarded";
            await held.save();
            return res.json({ error: false, empty: true, message: "Nothing to change any more — those notes are already like that." });
        }
        if (built.candidates.length > MAX_NOTES) return res.status(409).json({ error: true, message: OVER_LIMIT_MESSAGE });
        const doc = await writeList(userId, built, { doc: pending || held, status: "open", chatId: held.chatId });
        if (pending) await AgentProposal.deleteOne({ proposalId: held.proposalId, userId });
        const out = proposalBody(doc.toObject(), built.folderNames, built.notesById, { clashCount: built.clashCount, extended: Boolean(pending) });
        await hostInTurn(userId, held.proposalId, out);
        return res.json({ ...out, releasedFrom: held.proposalId });
    } catch (error) {
        console.error(`[${req.id}] Agent release-held failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// POST /v1/agent/proposals/:proposalId/discard — close a pending or held
// list unapplied.
const discardProposal = async (req, res) => {
    try {
        const doc = await AgentProposal.findOneAndUpdate(
            { proposalId: req.params.proposalId, userId: req.user._id, status: { $in: ["open", "held"] } },
            { $set: { status: "discarded" } },
            { new: true },
        ).lean();
        if (doc) return res.json({ error: false, status: "discarded" });
        const existing = await AgentProposal.findOne({ proposalId: req.params.proposalId, userId: req.user._id }).select("status").lean();
        if (!existing) return res.status(404).json({ error: true, message: "This list expired" });
        return res.status(409).json({ error: true, message: `This list was already ${existing.status}`, status: existing.status });
    } catch (error) {
        console.error(`[${req.id}] Agent discard failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// POST /v1/agent/select-notes — the complete list of this user's notes
// matching exact filters (architecture plan §2.5 step 1; no AI). Archived
// notes are left out unless `archived: true` asks for them. Tags match
// exactly, capitals included (as in the app).
const MAX_SELECT_NOTES = 2000;

const selectNotes = async (req, res) => {
    const userId = req.user._id;
    const f = (req.body && req.body.filters) || {};
    if (typeof f !== "object") return res.status(400).json({ error: true, message: "filters must be an object" });
    const query = { userId, isDeleted: { $ne: true } };
    query.isArchived = f.archived === true ? true : { $ne: true };

    try {
        if (f.tag !== undefined) {
            if (typeof f.tag !== "string" || !f.tag.trim() || f.tag.length > MAX_TAG_CHARS) return res.status(400).json({ error: true, message: "Invalid tag" });
            query.tags = f.tag.trim().replace(/^#+/, "");
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

// POST /v1/agent/selections/:selectionId/parts/:index/open — one split
// choice's notes go into the pending list (or start one). Topic changes'
// notes not judged yet go to FastAPI's borderline check first, for just
// this part.
const JUDGE_TIMEOUT_MS = 45_000;

const judgeNotes = async (req, userId, topic, keywords, noteIds) => {
    const url = process.env.FASTAPI_SUMMARIZE_URL;
    if (!url) throw new Error("AI service is not configured");
    const key = process.env.FASTAPI_INTERNAL_KEY;
    const response = await fetch(`${url}/agent/judge-part`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: req.headers["authorization"],
            "x-user-id": String(userId),
            ...(key ? { "x-api-key": key } : {}),
        },
        body: JSON.stringify({ topic, keywords, noteIds }),
        signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data?.candidates)) {
        console.error(`[${req.id}] judge-part failed (${response.status}):`, JSON.stringify(data).slice(0, 300));
        throw new Error(data?.detail || "judge failed");
    }
    return new Map(data.candidates.map((c) => [c.noteId, c]));
};

const openSelectionPart = async (req, res) => {
    const userId = req.user._id;
    const index = Number(req.params.index);
    try {
        const selection = await AgentSelection.findOne({ selectionId: req.params.selectionId, userId }).lean();
        if (!selection) return res.status(404).json({ error: true, message: "These choices have expired — ask the agent again" });
        const part = Number.isInteger(index) ? selection.parts[index] : null;
        if (!part) return res.status(404).json({ error: true, message: "Choice not found" });

        const plan = restrictPlan(planFromSelection(selection), part.noteIds);
        for (const change of plan.changes) {
            if (!change.topic) continue;
            const pending = [...plan.items].filter(([, list]) => list.some((i) => i.change === change.key && i.pending)).map(([noteId]) => noteId);
            if (pending.length === 0) continue;
            let verdicts;
            try {
                verdicts = await judgeNotes(req, userId, change.topic, change.keywords || [], pending);
            } catch {
                return res.status(502).json({ error: true, message: "The assistant couldn't check these notes right now. Try again shortly." });
            }
            for (const noteId of pending) {
                const v = verdicts.get(noteId);
                plan.items.set(noteId, plan.items.get(noteId).map((i) => (i.change === change.key
                    ? { ...i, pending: false, verdict: v?.verdict || "unjudged", reason: v?.reason || "couldn't judge — check it yourself" }
                    : i)));
            }
        }

        const openedFrom = `part:${selection.selectionId}:${index}`;
        const { status, body } = await savePlan(userId, plan, { source: "button", chatId: selection.chatId || null, openedFrom: [openedFrom] });
        if (status === 201 && selection.chatId) {
            // The list now lives in a new turn of this chat (older turns
            // showing it point here), so it's still there after a refresh.
            try {
                await markMoved(userId, body.proposalId);
                await appendTurns(userId, selection.chatId, [{
                    role: "assistant",
                    text: body.extended
                        ? `Added “${part.label}” to your pending list — review it below.`
                        : `Opened “${part.label}” — ${body.candidates.length} notes to review below.`,
                    citations: [],
                    proposal: chatProposal(body),
                }]);
            } catch (persistError) {
                console.error(`[${req.id}] Saving the opened part to the chat failed:`, persistError.message);
            }
        }
        return res.status(status).json({ ...body, partLabel: part.label });
    } catch (error) {
        console.error(`[${req.id}] Agent open-part failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

// ── Apply / Undo ──

// POST /v1/agent/proposals/:proposalId/apply — { picks: [{ noteId, changes:
// [keys] }] } (the ticked items), or { noteIds } = every item of those notes.
const applyProposal = async (req, res) => {
    const userId = req.user._id;
    const { proposalId } = req.params;
    const { picks, noteIds, version } = req.body || {};

    try {
        const proposal = await AgentProposal.findOne({ proposalId, userId }).lean();
        if (!proposal) return res.status(404).json({ error: true, message: "Proposal not found" });

        const existing = await AgentReceipt.findOne({ proposalId, userId }).lean();
        if (existing) return res.json({ error: false, alreadyApplied: true, receipt: summarizeReceipt(existing) });
        if (proposal.status === "replaced") return res.status(409).json({ error: true, message: "This list was replaced by a newer one below — use that one" });
        if (proposal.status === "discarded") return res.status(409).json({ error: true, message: "This list was discarded" });
        if (proposal.status === "held") return res.status(409).json({ error: true, message: "Add these changes to your pending list (or show them after it) first" });
        // Changes were added since the user looked: they review the new version.
        if (version !== undefined && version !== (proposal.version || 1)) {
            return res.status(409).json({ error: true, code: "list-updated", message: "This list was just updated — review it again below", version: proposal.version || 1 });
        }

        const changes = new Map(changesOf(proposal).map((c) => [c.key, c]));
        const candidates = new Map(proposal.candidates.map((c) => [c.noteId, c]));
        const chosen = Array.isArray(picks)
            ? picks
            : Array.isArray(noteIds) ? noteIds.map((id) => ({ noteId: id, changes: candidates.has(id) ? itemsOf(candidates.get(id)).map((i) => i.change) : [] })) : null;
        if (!chosen || chosen.length === 0 || chosen.length > MAX_NOTES
            || !chosen.every((p) => p && typeof p.noteId === "string" && OBJECT_ID_RE.test(p.noteId) && Array.isArray(p.changes) && p.changes.length > 0)
            || new Set(chosen.map((p) => p.noteId)).size !== chosen.length) {
            return res.status(400).json({ error: true, message: `Pick 1-${MAX_NOTES} distinct notes from the review list` });
        }
        for (const pick of chosen) {
            const candidate = candidates.get(pick.noteId);
            if (!candidate) return res.status(400).json({ error: true, message: "Only notes from the review list can be applied" });
            const items = new Map(itemsOf(candidate).map((i) => [i.change, i]));
            if (!pick.changes.every((k) => items.has(k))) return res.status(400).json({ error: true, message: "Only changes from the review list can be applied" });
            if (pick.changes.some((k) => (items.get(k).clashesWith || []).some((other) => pick.changes.includes(other)))) {
                return res.status(400).json({ error: true, message: "Two of the ticked changes on a note contradict each other — untick one" });
            }
        }

        let indexChanges = [];
        let receipt;
        try {
            receipt = await withRequiredTransaction(async (session) => {
                indexChanges = [];   // the transaction callback may be retried
                const usedKeys = new Set(chosen.flatMap((p) => p.changes));
                // A target folder may have gone to Trash since the list was made.
                for (const key of usedKeys) {
                    const c = changes.get(key);
                    if (c.action === "move" && c.params.targetFolderId && !(await findLivingFolder(c.params.targetFolderId, userId, session))) {
                        throw new TargetFolderGoneError();
                    }
                }
                const notes = await Note.find({ _id: { $in: chosen.map((p) => p.noteId) }, userId }).session(session);
                const byId = new Map(notes.map((n) => [String(n._id), n]));
                // "Move to a new folder": each folder is made, in this same
                // transaction, only once a note is actually going to move.
                const newFolders = new Map();
                const helpers = {
                    moveTo: async (note, params) => {
                        let target = params.targetFolderId || null;
                        if (params.newFolderName) {
                            if (!newFolders.has(params.newFolderName)) {
                                const folder = await createFolderRecord({ userId, name: params.newFolderName }, session);
                                newFolders.set(params.newFolderName, String(folder._id));
                            }
                            target = newFolders.get(params.newFolderName);
                        }
                        moveToFolder(note, target);
                    },
                    archive: (note, archived) => setArchived(note, archived, userId, session),
                    trash: (note) => Object.assign(note, trashFields()),
                };
                const ops = [];
                for (const pick of chosen) {
                    const candidate = candidates.get(pick.noteId);
                    const note = byId.get(pick.noteId);
                    if (!note || !sameState(stateOf(note), candidate.snapshot)) {
                        ops.push({ noteId: pick.noteId, title: note?.title || candidate.title, before: note ? stateOf(note) : null, after: null, status: "skipped-changed" });
                        continue;
                    }
                    const before = stateOf(note);
                    const applied = await applyChanges(note, pick.changes.map((k) => changes.get(k)), before, helpers);
                    const after = stateOf(note);
                    if (sameState(before, after)) {
                        ops.push({ noteId: pick.noteId, title: note.title, before, after, status: "skipped-unchanged" });
                        continue;
                    }
                    await note.save({ session });
                    ops.push({ noteId: pick.noteId, title: note.title, before, after, status: "applied", changes: applied });
                    if (indexedChange(before, after)) indexChanges.push({ noteId: pick.noteId, wasDeleted: before.isDeleted, isDeleted: after.isDeleted });
                }
                const allChanges = changesOf(proposal);
                const createdFolderIds = [...newFolders.values()];
                const single = allChanges.length === 1 ? allChanges[0] : null;
                const [created] = await AgentReceipt.create([{
                    proposalId, userId, instruction: proposal.instruction || single?.instruction || "",
                    changes: allChanges.map((c) => ({ key: c.key, action: c.action, params: c.params, instruction: c.instruction || "" })),
                    createdFolderIds,
                    action: single ? single.action : "multi",
                    params: single ? { ...single.params, ...(createdFolderIds[0] ? { createdFolderId: createdFolderIds[0] } : {}) } : {},
                    ops,
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

        syncSearchIndex(indexChanges, userId);
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

        let indexChanges = [];
        let receipt;
        try {
            receipt = await withRequiredTransaction(async (session) => {
                indexChanges = [];
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
                    if (indexedChange(op.before, op.after)) indexChanges.push({ noteId: op.noteId, wasDeleted, isDeleted: Boolean(note.isDeleted) });
                }
                // Folders this change created go to Trash once empty again
                // (restorable); kept if anything else is in them now.
                const createdIds = [...new Set([...(doc.createdFolderIds || []), ...(doc.params?.createdFolderId ? [doc.params.createdFolderId] : [])])];
                let trashedAny = false;
                for (const folderId of createdIds) {
                    if (await trashFolderIfEmpty(folderId, userId, session)) trashedAny = true;
                }
                if (trashedAny) {
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

        syncSearchIndex(indexChanges, userId);
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
    createProposal, getPending, releaseHeld, discardProposal, applyProposal, undoReceipt, listReceipts, selectNotes, openSelectionPart,
    stateOf, sameState,
};
