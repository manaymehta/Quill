const crypto = require("node:crypto");
const Folder = require("../models/folder.model");
const Note = require("../models/note.model");
const { findNearestLivingAncestor, getUserFolders } = require("./folder-tree.service");
const { isObjectId } = require("../utils/object-id");
const { HttpError } = require("../utils/http-error");

// The rules for moving, archiving, trashing and restoring a note, shared by
// the app's own routes (note.controller) and the agent's bulk Apply/Undo
// (agent-bulk.controller), so the two can't drift apart. Each helper works on
// a loaded note document and takes the caller's transaction `session` (or
// null); saving the note stays with the caller.


// A folder the note may go into: this user's and not in Trash. Returns
// { _id, name } or null. Check the ID with isObjectId first.
const findLivingFolder = (folderId, userId, session = null) => (
    Folder.findOne({ _id: folderId, userId, isDeleted: false })
        .select("_id name")
        .session(session)
        .lean()
);

// For a route putting something into a folder: throws a 400 for a malformed ID and a 404 when the
// folder isn't this user's living folder. `label` names it in the message ("folder",
// "target folder", "parent folder").
const requireLivingFolder = async (folderId, userId, label = "folder") => {
    if (!isObjectId(folderId)) throw new HttpError(400, `Invalid ${label}`);
    if (!(await findLivingFolder(folderId, userId))) {
        throw new HttpError(404, `${label[0].toUpperCase()}${label.slice(1)} not found`);
    }
};

// The folder a note should sit in: its own if still alive, otherwise the
// nearest living parent folder, otherwise none (null). `folders`: the user's
// folders already loaded (getUserFolders), for a caller handling many notes;
// the answer then needs no database reads.
const livingFolderId = async (folderId, userId, session = null, folders = null) => {
    if (!folderId) return null;
    if (folders) return findNearestLivingAncestor(folderId, folders);
    if (await findLivingFolder(folderId, userId, session)) return String(folderId);
    return findNearestLivingAncestor(folderId, await getUserFolders(userId, session));
};

// Move into a folder (or out of all folders with null). A note that was on
// Home stays on Home; an unfiled note is always on Home, so showInHome is off.
// The target must already be checked with findLivingFolder.
const moveToFolder = (note, targetFolderId) => {
    const wasOnHome = note.folderId === null || note.showInHome === true;
    note.folderId = targetFolderId || null;
    if (!targetFolderId) note.showInHome = false;
    else if (wasOnHome) note.showInHome = true;
};

// Archive or unarchive. Unarchiving out of a folder that went to Trash moves
// the note to the nearest living parent folder.
const setArchived = async (note, archived, userId, session = null) => {
    note.isArchived = archived;
    if (!archived && note.folderId) {
        note.folderId = await livingFolderId(note.folderId, userId, session);
    }
};

// The fields a single note gets when sent to Trash on its own (soft delete).
const trashFields = () => ({ isDeleted: true, deletedAt: new Date(), deletedBatchId: null });

// Take a trashed note out of Trash. Returns null on success, or the reason it
// can't be restored: a note trashed together with its folder must come back
// with that folder.
const restoreFromTrash = async (note, userId, session = null, folders = null) => {
    if (!note.isDeleted) return "Only a trashed note can be restored";
    if (note.deletedBatchId) return "Restore the containing folder instead";
    if (note.folderId) note.folderId = await livingFolderId(note.folderId, userId, session, folders);
    note.isDeleted = false;
    note.deletedAt = null;
    note.deletedBatchId = null;
    return null;
};

// A new folder, placed after its siblings — the same rules as the app's own
// New Folder (folder.controller createFolder) and the agent's "move to a new
// folder". The parent (if any) must already be checked.
const createFolderRecord = async ({ userId, name, parentId = null, color, icon }, session = null) => {
    const siblingCount = await Folder.countDocuments({ userId, parentId, isDeleted: false }).session(session);
    const [folder] = await Folder.create([{
        userId,
        name: name.trim(),
        parentId,
        color: color || "#e85d56",
        icon: icon || "📁",
        orderIndex: siblingCount,
    }], { session });
    return folder;
};

// Sends a folder to Trash only if nothing living is inside it (no notes, no
// subfolders) — used when undoing an agent change that created it. Returns
// true if it was trashed. Restorable from Trash like any deleted folder.
const trashFolderIfEmpty = async (folderId, userId, session = null) => {
    const [notes, children] = await Promise.all([
        Note.countDocuments({ userId, folderId: String(folderId), isDeleted: { $ne: true } }).session(session),
        Folder.countDocuments({ userId, parentId: String(folderId), isDeleted: false }).session(session),
    ]);
    if (notes > 0 || children > 0) return false;
    const result = await Folder.updateOne(
        { _id: folderId, userId, isDeleted: false },
        { $set: { isDeleted: true, deletedAt: new Date(), deletedBatchId: crypto.randomUUID(), isDeletedRoot: true } },
        { session },
    );
    return result.modifiedCount === 1;
};

module.exports = {
    createFolderRecord,
    trashFolderIfEmpty,
    findLivingFolder,
    requireLivingFolder,
    livingFolderId,
    moveToFolder,
    setArchived,
    trashFields,
    restoreFromTrash,
};
