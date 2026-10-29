const Note = require("../models/note.model");
const { indexInBackground, deleteEmbed, indexStatusOf } = require("../services/note-index.service");
const { isFastApiConfigured, callFastApi } = require("../services/fastapi.service");
const { LIVE, LISTS, sortFor, homeFilter, listsOf, placeArrivals, reorderList } = require("../services/note-order.service");
const {
    requireLivingFolder, moveToFolder, setArchived, trashFields, restoreFromTrash,
} = require("../services/note-actions.service");
const { isObjectId } = require("../utils/object-id");
const NOTE_LIST_FIELDS = "_id title content tags folderId showInHome isArchived isChecklist checklist orderIndex homeOrderIndex archiveOrderIndex linkPreviews createdAt updatedAt";
const NOTE_TRASH_FIELDS = `${NOTE_LIST_FIELDS} isDeleted deletedAt deletedBatchId`;
const NOTE_GRAPH_FIELDS = "_id title tags isArchived";

// GET /note-index-status/:noteId -> { embedding: { status, … } }; "unknown" when nothing was
// indexed for it recently
const getNoteIndexStatus = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;
    if (!(await Note.exists({ _id: noteId, userId }))) {
        return res.status(404).json({ error: true, message: "Note not found" });
    }
    const embedding = (await indexStatusOf(noteId)) || { status: "unknown" };
    return res.json({ error: false, embedding });
};

const addNote = async (req, res) => {
    const { title, content, tags, isChecklist, checklist, folderId, showInHome, linkPreviews } = req.body;
    const userId = req.user._id;

    if (!title && !content && (!checklist || checklist.length === 0)) {
        return res.status(400).json({ error: true, message: "Content or Title is required" });
    }

    const targetFolderId = folderId || null;
    if (targetFolderId) {
        await requireLivingFolder(targetFolderId, userId);
    }
    const note = new Note({
        title: title || " ",
        content: content || " ",
        tags: tags || [],
        isChecklist: isChecklist || false,
        checklist: checklist || [],
        userId,
        folderId: targetFolderId,
        showInHome: typeof showInHome !== "undefined" ? showInHome : false,
        linkPreviews: linkPreviews || []
    });

    await placeArrivals(note, null, userId);
    await note.save();
    indexInBackground(note, userId);

    return res.json({
        error: false,
        note,
        indexing: true,
        message: "Note created successfully",
    });
};

const editNote = async (req, res) => {
    const noteId = req.params.noteId;
    const { title, content, tags, isChecklist, checklist, folderId, showInHome, linkPreviews } = req.body;
    const userId = req.user._id;

    const note = await Note.findOne({ _id: noteId, userId: userId, isDeleted: { $ne: true } });

    if (!note) {
        return res.status(404).json({ error: true, message: "Note doesn't exist" });
    }
    const listsBefore = listsOf(note);

    if (typeof title !== "undefined") note.title = title;
    if (typeof content !== "undefined") note.content = content;
    if (typeof tags !== "undefined") note.tags = tags;
    if (typeof isChecklist !== "undefined") {
        note.isChecklist = isChecklist;
    }
    if (typeof checklist !== "undefined") note.checklist = checklist;
    if (typeof folderId !== "undefined") {
        if (folderId !== null) await requireLivingFolder(folderId, userId);
        note.folderId = folderId;
    }
    if (typeof showInHome !== "undefined") {
        note.showInHome = showInHome;
    }
    if (typeof linkPreviews !== "undefined") {
        note.linkPreviews = linkPreviews;
    }

    await placeArrivals(note, listsBefore, userId);
    await note.save();

    // Only re-embed when indexed content changed (tags are indexed too) —
    // not for pin/folder-only edits.
    const contentChanged = typeof title !== "undefined"
        || typeof tags !== "undefined"
        || typeof content !== "undefined"
        || typeof checklist !== "undefined"
        || typeof isChecklist !== "undefined"
        || typeof linkPreviews !== "undefined";
    if (contentChanged) indexInBackground(note, userId);

    return res.json({
        error: false,
        note,
        indexing: contentChanged,
        message: "Note edited successfully",
    });
};

const getAllNotes = async (req, res) => {
    const userId = req.user._id;

    const notes = await Note.find({ userId, ...LIVE })
        .select(NOTE_LIST_FIELDS)
        .sort(sortFor(LISTS.folder.field))
        .lean();

    return res.json({
        error: false,
        message: "All notes retrieved successfully",
        notes,
    });
};

const getGraphNotes = async (req, res) => {
    const userId = req.user._id;
    const includeArchived = req.query.includeArchived === "true";

    const query = {
        userId,
        isDeleted: { $ne: true },
    };
    if (!includeArchived) {
        query.isArchived = { $ne: true };
    }

    const notes = await Note.find(query)
        .select(NOTE_GRAPH_FIELDS)
        .sort(sortFor(LISTS.folder.field))
        .lean();

    const formattedNotes = notes.map((note) => ({
        _id: note._id,
        title: note.title || "",
        tags: Array.isArray(note.tags)
            ? [...new Set(note.tags.filter((t) => t != null).map((t) => String(t).trim()).filter(Boolean))]
            : [],
        isArchived: Boolean(note.isArchived),
    }));

    return res.json({
        error: false,
        message: "Graph notes retrieved successfully",
        notes: formattedNotes,
    });
};

const getNoteById = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    const note = await Note.findOne({
        _id: noteId,
        userId,
        isDeleted: { $ne: true },
    })
        .select(NOTE_LIST_FIELDS)
        .lean();

    if (!note) {
        return res.status(404).json({ error: true, message: "Note not found" });
    }

    return res.json({
        error: false,
        message: "Note retrieved successfully",
        note,
    });
};

const getHomeNotes = async (req, res) => {
    const userId = req.user._id;

    // Unfiled notes, folder notes shown on Home, and notes whose folder is gone
    const notes = await Note.find(await homeFilter(userId))
        .select(NOTE_LIST_FIELDS).sort(sortFor(LISTS.home.field)).lean();

    return res.json({
        error: false,
        message: "Home notes retrieved successfully",
        notes,
    });
};

// GET /folder-note-counts -> { counts: { [folderId]: n } }: notes filed directly in each folder that
// aren't archived or trashed. What folder cards and the delete-folder dialog show, without
// downloading the notes themselves.
const getFolderNoteCounts = async (req, res) => {
    const userId = String(req.user._id);
    const rows = await Note.aggregate([
        { $match: { userId, ...LIVE, folderId: { $ne: null } } },
        { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]);
    return res.json({ error: false, counts: Object.fromEntries(rows.map((row) => [String(row._id), row.count])) });
};

const getFolderNotes = async (req, res) => {
    const userId = req.user._id;
    const { folderIds } = req.query;

    const filter = { userId, ...LIVE };
    if (folderIds && folderIds !== "all") {
        const ids = typeof folderIds === "string" ? folderIds.split(",") : folderIds;
        filter.folderId = { $in: ids };
    }

    const notes = await Note.find(filter)
        .select(NOTE_LIST_FIELDS)
        .sort(sortFor(LISTS.folder.field))
        .lean();

    return res.json({
        error: false,
        message: "Folder notes retrieved successfully",
        notes,
    });
};


const getArchivedNotes = async (req, res) => {
    const userId = req.user._id;

    const notes = await Note.find(await LISTS.archive.filter(userId))
        .select(NOTE_LIST_FIELDS)
        .sort(sortFor(LISTS.archive.field))
        .lean();

    return res.json({
        error: false,
        message: "Archived notes retrieved successfully",
        notes,
    });
};

const deleteNote = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    const note = await Note.findOne({ userId: userId, _id: noteId });

    if (!note) {
        return res.status(404).json({
            error: true,
            message: "Note not found",
        });
    }

    if (note.isDeleted) {
        return res.status(409).json({ error: true, message: "Note is already in Trash" });
    }

    const updateResult = await Note.updateOne(
        { _id: noteId, userId: userId, isDeleted: { $ne: true } },
        { $set: trashFields() }
    );
    if (updateResult.modifiedCount !== 1) {
        return res.status(409).json({ error: true, message: "Note changed before it could be moved to Trash" });
    }
    // Its search pieces are removed after the reply: nothing waits on that (the agent's search
    // already drops trashed notes), unlike a permanent delete, whose toast reports a failed cleanup
    void deleteEmbed(noteId);

    return res.json({
        error: false,
        message: "Note moved to trash",
    });
};

const getTrashNotes = async (req, res) => {
    const userId = req.user._id;

    const notes = await Note.find({ userId: userId, isDeleted: true, deletedBatchId: null })
        .select(NOTE_TRASH_FIELDS)
        .sort({ deletedAt: -1 })
        .lean();

    return res.json({
        error: false,
        message: "Trash notes retrieved successfully",
        notes,
    });
};

const restoreNote = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    const note = await Note.findOne({ _id: noteId, userId: userId });

    if (!note) {
        return res.status(404).json({ error: true, message: "Note not found" });
    }

    const listsBefore = listsOf(note);
    const refusal = await restoreFromTrash(note, userId);
    if (refusal) {
        return res.status(409).json({ error: true, message: refusal });
    }
    await placeArrivals(note, listsBefore, userId);
    await note.save();
    indexInBackground(note, userId);

    return res.json({
        error: false,
        message: "Note restored successfully",
        note,
        indexing: true,
    });
};

const permanentDeleteNote = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    const note = await Note.findOne({ _id: noteId, userId: userId });

    if (!note) {
        return res.status(404).json({ error: true, message: "Note not found" });
    }

    if (!note.isDeleted || note.deletedBatchId) {
        return res.status(409).json({ error: true, message: "Only an individually trashed note can be permanently deleted" });
    }

    const deleteResult = await Note.deleteOne({
        _id: noteId,
        userId: userId,
        isDeleted: true,
        deletedBatchId: null,
    });
    if (deleteResult.deletedCount !== 1) {
        return res.status(409).json({ error: true, message: "Note changed before permanent deletion" });
    }
    const embedding = await deleteEmbed(noteId);

    return res.json({
        error: false,
        embedding,
        message: "Note permanently deleted",
    });
};



const updateNoteArchive = async (req, res) => {
    const noteId = req.params.noteId;
    const { isArchived } = req.body;
    const userId = req.user._id;

    if (typeof isArchived !== "boolean") {
        return res.status(400).json({ error: true, message: "isArchived must be a boolean" });
    }

    const note = await Note.findOne({ userId: userId, _id: noteId });

    if (!note) {
        return res.status(404).json({ error: true, message: "Note not found" });
    }

    if (note.isDeleted) {
        return res.status(409).json({ error: true, message: "Trashed notes cannot be archived" });
    }

    const listsBefore = listsOf(note);
    await setArchived(note, isArchived, userId);
    await placeArrivals(note, listsBefore, userId);
    await note.save();

    // Archived notes remain part of semantic search; only Trash notes are removed.
    indexInBackground(note, userId);

    return res.json({
        error: false,
        message: isArchived ? "Note archived" : "Note unarchived",
        note,
        indexing: true,
    });
};

const summarizeNote = async (req, res) => {
    const { text } = req.body;

    if (!text || text.trim() === "") {
        return res.status(400).json({
            error: true,
            message: "Text content is required for summarization.",
        });
    }

    if (!isFastApiConfigured()) {
        console.error("FASTAPI_SUMMARIZE_URL is not defined in environment variables.");
        return res.status(500).json({
            error: true,
            message: "Summarization service URL is not configured.",
        });
    }

    let response;
    try {
        response = await callFastApi("/summarize", { method: "POST", body: { text } });
    } catch (error) {
        console.error("Error calling FastAPI summarization service:", error.message);
        return res.status(500).json({
            error: true,
            message: "Could not connect to the summarization service. Is FastAPI running?",
        });
    }

    const data = await response.json().catch(() => null);
    if (response.ok && data?.summary) {
        return res.json({
            error: false,
            summary: data.summary,
            message: "Note summarized successfully.",
        });
    }
    if (response.ok) {
        return res.status(500).json({
            error: true,
            message: "FastAPI did not return a valid summary.",
        });
    }
    console.error(`FastAPI summarization responded with status ${response.status}`);
    return res.status(500).json({
        error: true,
        message: data?.detail
            ? "FastAPI Error: " + data.detail
            : `FastAPI service responded with status ${response.status}: ${response.statusText}`,
    });
};

// A drag in one list: Home, a folder, or Archive (Trash has no order).
// Body: { list, folderId (for a folder), ids: the visible notes in their new order }.
const reorderNotes = async (req, res) => {
    const { list, folderId, ids } = req.body;
    const userId = req.user._id;

    if (!Object.hasOwn(LISTS, list)) {
        return res.status(400).json({ error: true, message: "Unknown list" });
    }
    if (list === "folder" && !isObjectId(folderId)) {
        return res.status(400).json({ error: true, message: "Invalid folder" });
    }
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000 || ids.some((id) => typeof id !== "string")) {
        return res.status(400).json({ error: true, message: "A list of note ids is required" });
    }

    const refusal = await reorderList(list, list === "folder" ? folderId : null, ids, userId);
    if (refusal) {
        return res.status(409).json({ error: true, message: refusal });
    }
    return res.json({ error: false, message: "Notes reordered successfully" });
};

const moveNote = async (req, res) => {
    const noteId = req.params.noteId;
    const { targetFolderId } = req.body;
    const userId = req.user._id;

    const note = await Note.findOne({ _id: noteId, userId, isDeleted: { $ne: true } });
    if (!note) {
        return res.status(404).json({ error: true, message: "Note not found" });
    }

    if (targetFolderId) await requireLivingFolder(targetFolderId, userId, "target folder");

    const listsBefore = listsOf(note);
    moveToFolder(note, targetFolderId);
    await placeArrivals(note, listsBefore, userId);
    await note.save();
    return res.json({ error: false, note, message: "Note moved successfully" });
};

// "Home" / "Un Home" on a filed note: shows it on Home as well as in its folder (showInHome)
const toggleShowInHome = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    const note = await Note.findOne({ _id: noteId, userId, isDeleted: { $ne: true } });
    if (!note) {
        return res.status(404).json({ error: true, message: "Note not found" });
    }

    if (note.folderId === null) {
        return res.status(400).json({ error: true, message: "Unfiled notes are always shown on Home" });
    }

    const listsBefore = listsOf(note);
    note.showInHome = !note.showInHome;
    await placeArrivals(note, listsBefore, userId);
    await note.save();

    return res.json({
        error: false,
        message: note.showInHome ? "Added to Home" : "Removed from Home",
        note,
    });
};

module.exports = {
    addNote,
    editNote,
    getNoteById,
    getAllNotes,
    getGraphNotes,
    getHomeNotes,
    getFolderNotes,
    getFolderNoteCounts,
    deleteNote,
    getTrashNotes,
    restoreNote,
    permanentDeleteNote,
    summarizeNote,
    updateNoteArchive,
    getArchivedNotes,
    reorderNotes,
    moveNote,
    toggleShowInHome,
    getNoteIndexStatus,
};
