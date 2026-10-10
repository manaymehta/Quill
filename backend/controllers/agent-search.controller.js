const Note = require("../models/note.model");
const Folder = require("../models/folder.model");
const { buildIndexText, indexTextHash } = require("../services/note-index.service");
const { triggerEmbed, deleteEmbed } = require("./note.controller");

// The agent's search does its meaning search in FastAPI, then makes this ONE
// call (architecture plan §2.4, step 2a):
// - note check: are the matched notes still there, this user's, and is each
//   matched piece from the note's current text (fingerprint)? Leftover pieces
//   of deleted notes and out-of-date pieces are healed in the background;
// - exact search: notes containing the given keywords in the title, text,
//   tags or checklist items.
// Runs with the user's own token, so everything is scoped to req.user._id.

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const HASH_RE = /^[a-f0-9]{1,64}$/;
const MAX_CANDIDATES = 60;
const MAX_KEYWORDS = 5;
const MAX_KEYWORD_CHARS = 100;
const MAX_KEYWORD_NOTES = 50;
const WINDOW_RADIUS = 500;
const OPENING_CHARS = 1000;
// Don't re-trigger the same background fix on every search while it runs.
const HEAL_COOLDOWN_MS = 5 * 60_000;
const recentHeals = new Map();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const healOnce = (key, operation) => {
    const last = recentHeals.get(key);
    if (last && Date.now() - last < HEAL_COOLDOWN_MS) return;
    recentHeals.set(key, Date.now());
    Promise.resolve().then(operation).catch((error) => {
        console.error(`Search self-heal failed (${key}):`, error.message);
    });
};

const sanitizeBody = (body) => {
    const { keywords, candidates } = body || {};
    const terms = keywords === undefined || keywords === null ? [] : keywords;
    if (!Array.isArray(terms) || terms.length > MAX_KEYWORDS
        || !terms.every((k) => typeof k === "string" && k.trim() && k.length <= MAX_KEYWORD_CHARS)) {
        return null;
    }
    const list = candidates === undefined || candidates === null ? [] : candidates;
    if (!Array.isArray(list) || list.length > MAX_CANDIDATES) return null;
    const cleaned = [];
    for (const c of list) {
        if (!c || typeof c !== "object" || typeof c.noteId !== "string" || !OBJECT_ID_RE.test(c.noteId)) return null;
        if (c.textHash !== undefined && c.textHash !== null && c.textHash !== ""
            && (typeof c.textHash !== "string" || !HASH_RE.test(c.textHash))) return null;
        cleaned.push({ noteId: c.noteId, textHash: c.textHash || null });
    }
    return { keywords: terms.map((k) => k.trim()), candidates: cleaned };
};

const NOTE_FIELDS = "_id title content tags folderId isArchived isChecklist checklist linkPreviews isDeleted updatedAt";

const noteMeta = (note, folderNames) => ({
    title: note.title || "",
    folder: note.folderId ? folderNames.get(String(note.folderId)) || null : null,
    tags: Array.isArray(note.tags) ? note.tags : [],
    isArchived: Boolean(note.isArchived),
    isChecklist: Boolean(note.isChecklist),
    lastEdited: note.updatedAt,
});

// Where a note matched the keywords, plus a window of text around the first
// match in its body (or its checklist items / opening text).
const describeKeywordHit = (note, regexes) => {
    const matchedBy = new Set();
    let window = null;
    const content = note.content || "";

    for (const re of regexes) {
        if (re.test(note.title || "")) matchedBy.add("title");
        if ((note.tags || []).some((t) => re.test(String(t)))) matchedBy.add("tag");
        const items = (note.checklist || []).filter((item) => re.test(item.text || ""));
        if (items.length > 0) {
            matchedBy.add("checklist");
            if (!window) window = items.map((item) => `- ${item.text}`).join("\n").slice(0, WINDOW_RADIUS * 2);
        }
        const match = re.exec(content);
        if (match) {
            matchedBy.add("content");
            if (!window) {
                const start = Math.max(0, match.index - WINDOW_RADIUS);
                const end = Math.min(content.length, match.index + match[0].length + WINDOW_RADIUS);
                window = `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
            }
        }
    }
    if (!window) window = buildIndexText(note).text.slice(0, OPENING_CHARS);
    return { matchedBy: [...matchedBy], window };
};

// Title hits first, then tags, then checklist/content; more matched fields rank higher.
const keywordRank = (hit) => (
    (hit.matchedBy.includes("title") ? 8 : 0)
    + (hit.matchedBy.includes("tag") ? 4 : 0)
    + (hit.matchedBy.includes("checklist") ? 2 : 0)
    + (hit.matchedBy.includes("content") ? 1 : 0)
);

const searchSupport = async (req, res) => {
    const input = sanitizeBody(req.body);
    if (!input) {
        return res.status(400).json({
            error: true,
            message: `keywords must be up to ${MAX_KEYWORDS} non-empty strings and candidates up to ${MAX_CANDIDATES} { noteId, textHash } entries`,
        });
    }
    const userId = req.user._id;

    try {
        const candidateIds = [...new Set(input.candidates.map((c) => c.noteId))];
        const candidateNotes = candidateIds.length
            ? await Note.find({ _id: { $in: candidateIds }, userId }).select(NOTE_FIELDS).lean()
            : [];

        let keywordNotes = [];
        let regexes = [];
        if (input.keywords.length > 0) {
            regexes = input.keywords.map((k) => new RegExp(escapeRegex(k), "i"));
            keywordNotes = await Note.find({
                userId,
                isDeleted: { $ne: true },
                $or: regexes.flatMap((re) => [
                    { title: re }, { content: re }, { tags: re }, { "checklist.text": re },
                ]),
            }).select(NOTE_FIELDS).sort({ updatedAt: -1 }).limit(MAX_KEYWORD_NOTES).lean();
        }

        const folderIds = [...new Set([...candidateNotes, ...keywordNotes]
            .map((n) => n.folderId).filter(Boolean).map(String))];
        const folders = folderIds.length
            ? await Folder.find({ _id: { $in: folderIds }, userId }).select("_id name").lean()
            : [];
        const folderNames = new Map(folders.map((f) => [String(f._id), f.name || ""]));

        const notes = {};
        const byId = new Map(candidateNotes.map((n) => [String(n._id), n]));

        // Candidates not found for this user: heal only if the note no longer
        // exists at all (never touch another user's pieces).
        const missing = candidateIds.filter((id) => !byId.has(id));
        if (missing.length > 0) {
            const existing = await Note.find({ _id: { $in: missing } }).select("_id").lean();
            const existsElsewhere = new Set(existing.map((n) => String(n._id)));
            for (const id of missing) {
                notes[id] = { status: "gone" };
                if (existsElsewhere.has(id)) {
                    console.warn(`[${req.id}] search piece for note ${id} is not this user's; dropped`);
                } else {
                    healOnce(`delete:${id}`, () => deleteEmbed(id));
                }
            }
        }

        for (const candidate of input.candidates) {
            const note = byId.get(candidate.noteId);
            if (!note || notes[candidate.noteId]?.status === "stale") continue;
            if (note.isDeleted) {
                notes[candidate.noteId] = { status: "gone" };
                healOnce(`delete:${candidate.noteId}`, () => deleteEmbed(candidate.noteId));
                continue;
            }
            const indexText = buildIndexText(note);
            const isStale = candidate.textHash && candidate.textHash !== indexTextHash(indexText);
            if (isStale) {
                healOnce(`embed:${candidate.noteId}:${indexTextHash(indexText)}`, () => triggerEmbed(note, userId));
                notes[candidate.noteId] = {
                    status: "stale",
                    ...noteMeta(note, folderNames),
                    currentText: indexText.text.slice(0, OPENING_CHARS),
                };
            } else if (!notes[candidate.noteId]) {
                notes[candidate.noteId] = { status: "ok", ...noteMeta(note, folderNames) };
            }
        }

        const keywordHits = keywordNotes
            .map((note) => ({ noteId: String(note._id), ...describeKeywordHit(note, regexes) }))
            .sort((a, b) => keywordRank(b) - keywordRank(a));
        for (const note of keywordNotes) {
            const id = String(note._id);
            if (!notes[id]) notes[id] = { status: "ok", ...noteMeta(note, folderNames) };
        }

        return res.json({ error: false, notes, keywordHits });
    } catch (error) {
        console.error(`[${req.id}] Agent search-support failed:`, error.message);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

module.exports = { searchSupport };
