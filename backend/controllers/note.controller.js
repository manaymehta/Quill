const Note = require("../models/note.model");
const Folder = require("../models/folder.model");
const axios = require("axios");

const findNearestLivingAncestor = async (startParentId, userId) => {
    if (!startParentId) return null;
    const allFolders = await Folder.find({ userId });
    let currentId = startParentId;
    while (currentId) {
        const folder = allFolders.find(f => f._id.toString() === currentId);
        if (!folder) return null;
        if (!folder.isDeleted) return folder._id.toString();
        currentId = folder.parentId;
    }
    return null;
};

const getFastApiHeaders = () => {
    const key = process.env.FASTAPI_INTERNAL_KEY;
    return key ? { headers: { "x-api-key": key } } : {};
};

// even if qdrant is down, it should not affect the saving of notes
const triggerEmbed = (note, userId) => {
    const url = process.env.FASTAPI_SUMMARIZE_URL;
    if (!url) return;

    // Build meaningful text for embedding, including checklist items if any
    let embedText = note.content || "";
    if (note.isChecklist && note.checklist && note.checklist.length > 0) {
        const checklistStr = note.checklist.map(item => `- [${item.completed ? 'x' : ' '}] ${item.text}`).join('\n');
        embedText = embedText ? `${embedText}\n\n${checklistStr}` : checklistStr;
    }

    // Skip embedding if note is completely blank
    if (!embedText.trim() && !(note.title && note.title.trim())) return;

    axios.post(`${url}/embed-note`, { noteId: String(note._id), userId: String(userId), title: note.title || "", text: embedText }, getFastApiHeaders())
        .catch((err) => console.error(`embedding process failed for note ${note._id}:`, err.message));
};

const deleteEmbed = (noteId) => {
    const url = process.env.FASTAPI_SUMMARIZE_URL;
    if (!url) return;
    axios.delete(`${url}/delete-embedding/${noteId}`, getFastApiHeaders())
        .catch((err) => console.error(`Delete embedding failed for ${noteId}:`, err.message));
};

const addNote = async (req, res) => {
    const { title, content, tags, isChecklist, checklist, folderId, showInHome } = req.body;
    const userId = req.user._id;

    if (!title && !content && (!checklist || checklist.length === 0)) {
        return res.status(400).json({ error: true, message: "Content or Title is required" });
    }

    try {
        const targetFolderId = folderId || null;
        let homeOrderIndex = 0;
        if (!targetFolderId) {
            const maxNote = await Note.findOne({
                userId,
                isDeleted: { $ne: true },
                isArchived: { $ne: true },
                $or: [{ folderId: null }, { showInHome: true }]
            }).sort({ homeOrderIndex: -1 }).select("homeOrderIndex");
            homeOrderIndex = maxNote ? maxNote.homeOrderIndex + 1 : 0;
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
            homeOrderIndex,
        });

        await note.save();

        triggerEmbed(note, userId);

        return res.json({
            error: false,
            note,
            message: "Note created successfully",
        });
    } catch (error) {
        console.error(error);
        return res.json({
            error: true,
            message: error.message || error,
        });
    }
};

const editNote = async (req, res) => {
    const noteId = req.params.noteId;
    const { title, content, tags, isChecklist, checklist, folderId, showInHome } = req.body;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ _id: noteId, userId: userId });

        if (!note) {
            return res.json({ error: true, message: "Note doesn't exist" });
        }

        if (title) note.title = title;
        if (content) note.content = content;
        if (tags) note.tags = tags;
        if (typeof isChecklist !== "undefined") {
            note.isChecklist = isChecklist;
        }
        if (checklist) note.checklist = checklist;
        if (typeof folderId !== "undefined") {
            note.folderId = folderId;
        }
        if (typeof showInHome !== "undefined") {
            note.showInHome = showInHome;
        }

        await note.save();

        // Only re-embed when semantic content actually changed — not for pin/tag-only edits
        const contentChanged = title || content || checklist || typeof isChecklist !== "undefined";
        if (contentChanged) {
            triggerEmbed(note, userId);
        }


        return res.json({
            error: false,
            note,
            message: "Note edited successfully",
        });
    } catch (error) {
        console.error(error);
        return res.json({
            error: true,
            message: "Internal Server Error",
        });
    }
};

const getAllNotes = async (req, res) => {
    const userId = req.user._id;

    try {
        const notes = await Note.find({ userId: userId, isDeleted: { $ne: true }, isArchived: { $ne: true } }).sort({
            orderIndex: 1,
            createdOn: -1,
        });

        return res.json({
            error: false,
            message: "All notes retrieved successfully",
            notes,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
};

const getHomeNotes = async (req, res) => {
    const userId = req.user._id;

    try {
        const notes = await Note.find({
            userId: userId,
            isDeleted: { $ne: true },
            isArchived: { $ne: true },
            $or: [{ folderId: null }, { showInHome: true }]
        }).sort({
            homeOrderIndex: 1,
            createdOn: -1,
        });

        return res.json({
            error: false,
            message: "Home notes retrieved successfully",
            notes,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
};

const getFolderNotes = async (req, res) => {
    const userId = req.user._id;
    const { folderIds } = req.query;

    try {
        let filter = { userId, isDeleted: { $ne: true }, isArchived: { $ne: true } };
        if (folderIds && folderIds !== "all") {
            const ids = typeof folderIds === "string" ? folderIds.split(",") : folderIds;
            filter.folderId = { $in: ids };
        }

        const notes = await Note.find(filter).sort({ orderIndex: 1, createdOn: -1 });

        return res.json({
            error: false,
            message: "Folder notes retrieved successfully",
            notes,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};


const getArchivedNotes = async (req, res) => {
    const userId = req.user._id;

    try {
        const notes = await Note.find({ userId: userId, isArchived: true, isDeleted: { $ne: true } }).sort({
            orderIndex: 1,
            createdOn: -1,
        });

        return res.json({
            error: false,
            message: "Archived notes retrieved successfully",
            notes,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
};

const deleteNote = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ userId: userId, _id: noteId });

        if (!note) {
            return res.status(404).json({
                error: true,
                message: "Note not found",
            });
        }

        await Note.updateOne({ _id: noteId, userId: userId }, { $set: { isDeleted: true, deletedAt: new Date() } });
        deleteEmbed(noteId);

        return res.json({
            error: false,
            message: "Note moved to trash",
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
};

const getTrashNotes = async (req, res) => {
    const userId = req.user._id;

    try {
        const notes = await Note.find({ userId: userId, isDeleted: true }).sort({ deletedAt: -1 });

        return res.json({
            error: false,
            message: "Trash notes retrieved successfully",
            notes,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const restoreNote = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ _id: noteId, userId: userId });

        if (!note) {
            return res.status(404).json({ error: true, message: "Note not found" });
        }

        note.isDeleted = false;
        note.deletedAt = null;
        await note.save();
        triggerEmbed(note, userId);

        return res.json({
            error: false,
            message: "Note restored successfully",
            note,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const permanentDeleteNote = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ _id: noteId, userId: userId });

        if (!note) {
            return res.status(404).json({ error: true, message: "Note not found" });
        }

        await Note.deleteOne({ _id: noteId, userId: userId });
        deleteEmbed(noteId);

        return res.json({
            error: false,
            message: "Note permanently deleted",
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const semanticSearch = async (req, res) => {
    const userId = req.user._id;
    const { query } = req.query;

    if (!query || !query.trim()) {
        return res.status(400).json({ error: true, message: "Query is required" });
    }

    const FASTAPI_URL = process.env.FASTAPI_SUMMARIZE_URL;
    if (!FASTAPI_URL) {
        return res.status(500).json({ error: true, message: "AI service URL not configured" });
    }

    try {
        // FastAPI now handles context entirely from Qdrant chunk payloads.
        // Express only needs to send query + userId.
        const response = await axios.post(`${FASTAPI_URL}/semantic-search`, {
            query: query.trim(),
            userId: String(userId),
        }, getFastApiHeaders());

        const { answer, sourceNoteIds } = response.data;

        // Fetch only the matched source notes by ID for the frontend card display
        const sourceNotes = sourceNoteIds.length
            ? await Note.find({ _id: { $in: sourceNoteIds }, userId, isDeleted: { $ne: true } })
            : [];

        return res.json({
            error: false,
            answer,
            sourceNotes,
        });
    } catch (error) {
        console.error(error);
        console.error("Semantic search error:", error.message);
        return res.status(500).json({ error: true, message: "Semantic search failed" });
    }
};


const updateNoteArchive = async (req, res) => {
    const noteId = req.params.noteId;
    const { isArchived } = req.body;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ userId: userId, _id: noteId });

        if (!note) {
            return res.status(404).json({ error: true, message: "Note not found" });
        }

        note.isArchived = isArchived;
        if (!isArchived) {
            // Un-archiving: verify folder is alive, otherwise bubble up
            if (note.folderId) {
                const folder = await Folder.findOne({ _id: note.folderId, userId, isDeleted: false });
                if (!folder) {
                    note.folderId = await findNearestLivingAncestor(note.folderId, userId);
                }
            }
        }
        await note.save();

        // Keep Qdrant in sync: archived notes leave AI context, un-archived notes return
        if (isArchived) {
            deleteEmbed(String(noteId));
        } else {
            triggerEmbed(note, userId);
        }

        return res.json({
            error: false,
            message: isArchived ? "Note archived" : "Note unarchived",
            note,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const searchNotes = async (req, res) => {
    const userId = req.user._id;
    const { query, scope, folderIds } = req.query;

    if (!query) {
        return res.status(400).json({ error: true, message: "Search query is required" });
    }

    try {
        let folderFilter = {};
        if (scope === "home") {
            folderFilter = { $or: [{ folderId: null }, { showInHome: true }] };
        } else if (folderIds) {
            const ids = typeof folderIds === "string" ? folderIds.split(",") : folderIds;
            folderFilter = { folderId: { $in: ids } };
        }

        const matchingNote = await Note.find({
            userId: userId,
            $or: [{ title: { $regex: new RegExp(query, "i") } }, { content: { $regex: new RegExp(query, "i") } }],
            isDeleted: { $ne: true },
            isArchived: { $ne: true },
            ...folderFilter,
        });

        return res.json({
            error: false,
            message: "note found successfully",
            notes: matchingNote,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const summarizeNote = async (req, res) => {
    const { text } = req.body;

    if (!text || text.trim() === "") {
        return res.status(400).json({
            error: true,
            message: "Text content is required for summarization.",
        });
    }

    try {
        const FASTAPI_SUMMARIZE_URL = process.env.FASTAPI_SUMMARIZE_URL;

        if (!FASTAPI_SUMMARIZE_URL) {
            console.error("FASTAPI_SUMMARIZE_URL is not defined in environment variables.");
            return res.status(500).json({
                error: true,
                message: "Summarization service URL is not configured.",
            });
        }

        const fastapiResponse = await axios.post(`${FASTAPI_SUMMARIZE_URL}/summarize`, {
            text: text,
        }, getFastApiHeaders());

        if (fastapiResponse.data && fastapiResponse.data.summary) {
            return res.json({
                error: false,
                summary: fastapiResponse.data.summary,
                message: "Note summarized successfully.",
            });
        } else {
            return res.status(500).json({
                error: true,
                message: "FastAPI did not return a valid summary.",
            });
        }
    } catch (error) {
        console.error(error);
        console.error("Error calling FastAPI summarization service:", error.message);

        let errorMessage;
        if (error.response) {
            if (error.response.data && error.response.data.detail) {
                errorMessage = "FastAPI Error: " + error.response.data.detail;
            } else {
                errorMessage = `FastAPI service responded with status ${error.response.status}: ${error.response.statusText}`;
            }
        } else if (error.request) {
            errorMessage = "Could not connect to the summarization service. Is FastAPI running?";
        } else {
            errorMessage = "An unexpected error occurred before sending request to FastAPI.";
        }

        return res.status(500).json({
            error: true,
            message: errorMessage,
        });
    }
};

const reorderNotes = async (req, res) => {
    const { updates } = req.body;
    const userId = req.user._id;

    if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ error: true, message: "Updates array is required" });
    }

    try {
        // Bulk write for optimal performance
        const bulkOps = updates.map((update) => ({
            updateOne: {
                filter: { _id: update._id, userId },
                update: { $set: { orderIndex: update.orderIndex } }
            }
        }));

        if (bulkOps.length > 0) {
            await Note.bulkWrite(bulkOps);
        }

        return res.json({ error: false, message: "Notes reordered successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const moveNote = async (req, res) => {
    const noteId = req.params.noteId;
    const { targetFolderId } = req.body;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ _id: noteId, userId });
        if (!note) {
            return res.status(404).json({ error: true, message: "Note not found" });
        }

        const wasOnHome = note.folderId === null || note.showInHome === true;
        note.folderId = targetFolderId || null;

        if (!targetFolderId) {
            note.showInHome = false;
        } else if (wasOnHome) {
            note.showInHome = true;
        }

        await note.save();
        return res.json({ error: false, note, message: "Note moved successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const toggleHomePin = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ _id: noteId, userId });
        if (!note) {
            return res.status(404).json({ error: true, message: "Note not found" });
        }

        if (note.folderId === null) {
            return res.status(400).json({ error: true, message: "Unfiled notes are always shown on Home" });
        }

        note.showInHome = !note.showInHome;
        await note.save();

        return res.json({
            error: false,
            message: note.showInHome ? "Added to Home" : "Removed from Home",
            note,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const reorderHomeNotes = async (req, res) => {
    const { updates } = req.body;
    const userId = req.user._id;

    if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ error: true, message: "Updates array is required" });
    }

    try {
        const bulkOps = updates.map((update) => ({
            updateOne: {
                filter: { _id: update._id, userId },
                update: { $set: { homeOrderIndex: update.homeOrderIndex } }
            }
        }));

        if (bulkOps.length > 0) {
            await Note.bulkWrite(bulkOps);
        }

        return res.json({ error: false, message: "Home notes reordered successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const restoreTrashNote = async (req, res) => {
    const noteId = req.params.noteId;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ _id: noteId, userId, isDeleted: true });
        if (!note) {
            return res.status(404).json({ error: true, message: "Trashed note not found" });
        }

        if (note.folderId) {
            const folder = await Folder.findOne({ _id: note.folderId, userId, isDeleted: false });
            if (!folder) {
                note.folderId = await findNearestLivingAncestor(note.folderId, userId);
            }
        }

        note.isDeleted = false;
        note.deletedAt = null;
        note.deletedBatchId = null;
        await note.save();

        triggerEmbed(note, userId);

        return res.json({ error: false, note, message: "Note restored successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

module.exports = {
    addNote,
    editNote,
    getAllNotes,
    getHomeNotes,
    getFolderNotes,
    deleteNote,
    getTrashNotes,
    restoreNote,
    restoreTrashNote,
    permanentDeleteNote,
    searchNotes,
    summarizeNote,
    updateNoteArchive,
    getArchivedNotes,
    semanticSearch,
    reorderNotes,
    reorderHomeNotes,
    moveNote,
    toggleHomePin,
    deleteEmbed,
    triggerEmbed,
};
