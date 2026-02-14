const Note = require("../models/note.model");
const axios = require("axios");

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

        return res.json({
            error: false,
            note,
            message: "Note created succesfully",
        });
    } catch (error) {
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

        return res.json({
            error: false,
            note,
            message: "Note edited successfully",
        });
    } catch (error) {
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
            isPinned: -1,
        });

        return res.json({
            error: false,
            message: "All notes retrieved successfully",
            notes,
        });
    } catch (error) {
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
            isPinned: -1,
        });

        return res.json({
            error: false,
            message: "Archived notes retrieved successfully",
            notes,
        });
    } catch (error) {
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

        return res.json({
            error: false,
            message: "Note moved to trash",
        });
    } catch (error) {
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

        return res.json({
            error: false,
            message: "Note restored successfully",
            note,
        });
    } catch (error) {
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

        return res.json({
            error: false,
            message: "Note permanently deleted",
        });
    } catch (error) {
        res.status(500).json({ error: true, message: "Internal Server Error" });
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

        return res.json({
            error: false,
            message: isArchived ? "Note archived" : "Note unarchived",
            note,
        });
    } catch (error) {
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
        });

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
        console.error("Error calling FastAPI summarization service:", error.message);

        let errorMessage = "Internal Server Error during summarization.";
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
};
