const Folder = require("../models/folder.model");
const Note = require("../models/note.model");

// Where notes sit in each ordered list, shared by the app's routes and the
// agent's bulk Apply/Undo. Each note keeps one position number per list:
// Home (homeOrderIndex), its folder (orderIndex) and Archive
// (archiveOrderIndex); Trash has no order of its own (newest deletion first).
// Rule: a note arriving in a list goes to the bottom of it.

const LIVE = { isDeleted: { $ne: true }, isArchived: { $ne: true } };

// Unfiled notes, folder notes shown on Home, and notes whose folder is gone.
// The same filter getHomeNotes lists, so positions here match what Home shows.
const homeFilter = async (userId, session = null) => {
    const activeFolders = await Folder.find({ userId, isDeleted: false }).select("_id").session(session).lean();
    return {
        userId, ...LIVE,
        $or: [
            { folderId: null },
            { showInHome: true },
            { folderId: { $nin: activeFolders.map((f) => f._id.toString()) } },
        ],
    };
};

// Each list: its position field, its filter, and the order it is shown in
const LISTS = {
    home: { field: "homeOrderIndex", filter: (userId, _folderId, session) => homeFilter(userId, session) },
    folder: { field: "orderIndex", filter: async (userId, folderId) => ({ userId, ...LIVE, folderId }) },
    archive: { field: "archiveOrderIndex", filter: async (userId) => ({ userId, isDeleted: { $ne: true }, isArchived: true }) },
};
const sortFor = (field) => ({ [field]: 1, createdAt: -1 });

// Which lists a note is in (an orphaned note counts as on Home through its
// folder being gone; that is only known to the Home filter, so it's left out).
const listsOf = (note) => {
    const live = !note.isDeleted && !note.isArchived;
    return {
        home: live && (!note.folderId || note.showInHome === true),
        folder: live && note.folderId ? String(note.folderId) : null,
        archive: !note.isDeleted && note.isArchived === true,
    };
};

// Puts a note at the bottom of each list it has just joined. `before` is
// listsOf(note) taken before the change (null for a new note). `ends` carries
// the next free position per list across several notes in one request (the
// agent's bulk changes), so they line up in the order they're placed.
const placeArrivals = async (note, before, userId, session = null, ends = new Map()) => {
    const now = listsOf(note);
    const joined = [];
    if (now.home && !before?.home) joined.push(["home", null]);
    if (now.folder && now.folder !== before?.folder) joined.push(["folder", now.folder]);
    if (now.archive && !before?.archive) joined.push(["archive", null]);

    for (const [name, folderId] of joined) {
        const { field, filter } = LISTS[name];
        const key = `${name}:${folderId || ""}`;
        if (!ends.has(key)) {
            const last = await Note.findOne({ ...(await filter(userId, folderId, session)), _id: { $ne: note._id } })
                .sort({ [field]: -1 }).select(field).session(session).lean();
            ends.set(key, last ? (last[field] || 0) + 1 : 0);
        }
        note[field] = ends.get(key);
        ends.set(key, note[field] + 1);
    }
};

// A drag: `ids` are the notes the user could see, in their new order (a
// search can hide others). They take over the places those same notes held,
// so hidden notes don't move; then the whole list is numbered 0, 1, 2… (which
// also clears duplicate numbers from older data) and only changed notes are
// written. Returns an error message, or null.
const reorderList = async (name, folderId, ids, userId) => {
    const list = LISTS[name];
    const notes = await Note.find(await list.filter(userId, folderId)).sort(sortFor(list.field)).select(list.field).lean();
    const index = new Map(notes.map((n, i) => [String(n._id), i]));
    if (new Set(ids).size !== ids.length || ids.some((id) => !index.has(id))) {
        return "These notes aren't all in that list";
    }

    const slots = ids.map((id) => index.get(id)).sort((a, b) => a - b);
    const ordered = [...notes];
    slots.forEach((slot, i) => { ordered[slot] = notes[index.get(ids[i])]; });

    const ops = ordered
        .map((n, position) => (n[list.field] === position ? null : {
            updateOne: { filter: { _id: n._id, userId }, update: { $set: { [list.field]: position } } },
        }))
        .filter(Boolean);
    if (ops.length > 0) await Note.bulkWrite(ops);
    return null;
};

module.exports = { LISTS, sortFor, homeFilter, listsOf, placeArrivals, reorderList };
