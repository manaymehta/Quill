const Note = require("../models/note.model");
const axios = require("axios");

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
    const { title, content, tags, isChecklist, checklist } = req.body;
    const userId = req.user._id;

    if (!title && !content && (!checklist || checklist.length === 0)) {
        return res.status(400).json({ error: true, message: "Content or Title is required" });
    }

    try {
        const note = new Note({
            title: title || " ",
            content: content || " ",
            tags: tags || [],
            isChecklist: isChecklist || false,
            checklist: checklist || [],
            userId,
        });

        await note.save();

        triggerEmbed(note, userId);

        return res.json({
            error: false,
            note,
            message: "Note created succesfully",
        });
    } catch (error) {
        console.error(error);
        return res.json({
            error: true,
            message: error,
        });
    }
};

const editNote = async (req, res) => {
    const noteId = req.params.noteId;
    const { title, content, tags, isPinned, isChecklist, checklist } = req.body;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ _id: noteId, userId: userId });

        if (!note) {
            return res.json({ error: true, message: "Note doesn't exist" });
        }

        if (title) note.title = title;
        if (content) note.content = content;
        if (tags) note.tags = tags;
        if (typeof isPinned !== "undefined") {
            note.isPinned = isPinned;
        }
        if (typeof isChecklist !== "undefined") {
            note.isChecklist = isChecklist;
        }
        if (checklist) note.checklist = checklist;

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

const getPinnedNotes = async (req, res) => {
    const userId = req.user._id;

    try {
        const notes = await Note.find({ userId: userId, isPinned: true, isDeleted: { $ne: true }, isArchived: { $ne: true } });

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


const updateNotePinned = async (req, res) => {
    const noteId = req.params.noteId;
    const { isPinned } = req.body;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ userId: userId, _id: noteId });

        if (!note) {
            return res.status(404).json({ error: true, message: "Note not found" });
        }

        note.isPinned = isPinned;
        await note.save();

        return res.json({
            error: false,
            message: "Note unpinned",
            note,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
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
        if (isArchived) {
            note.isPinned = false;
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
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: true, message: "Search query is required" });
    }

    try {
        const matchingNote = await Note.find({
            userId: userId,
            $or: [{ title: { $regex: new RegExp(query, "i") } }, { content: { $regex: new RegExp(query, "i") } }],
            isDeleted: { $ne: true },
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

module.exports = {
    addNote,
    editNote,
    getAllNotes,
    getPinnedNotes,
    deleteNote,
    getTrashNotes,
    restoreNote,
    permanentDeleteNote,
    updateNotePinned,
    searchNotes,
    summarizeNote,
    updateNoteArchive,
    getArchivedNotes,
    semanticSearch,
    reorderNotes,
};
