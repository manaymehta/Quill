const Note = require("../models/note.model");
const Folder = require("../models/folder.model");
const axios = require("axios");
const mongoose = require("mongoose");
const { findNearestLivingAncestor, getUserFolders } = require("../services/folder-tree.service");
const FASTAPI_REQUEST_TIMEOUT_MS = 30_000;
const FASTAPI_EMBEDDING_TIMEOUT_MS = 10_000;
const embeddingLocks = new Map();
const NOTE_LIST_FIELDS = "_id title content tags folderId showInHome isArchived isChecklist checklist orderIndex homeOrderIndex linkPreviews createdAt updatedAt";
const NOTE_TRASH_FIELDS = `${NOTE_LIST_FIELDS} isDeleted deletedAt deletedBatchId`;
const NOTE_GRAPH_FIELDS = "_id title tags isArchived";

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveNearestLivingAncestor = async (startParentId, userId) => (
    findNearestLivingAncestor(startParentId, await getUserFolders(userId))
);

const getFastApiHeaders = (timeout = FASTAPI_REQUEST_TIMEOUT_MS) => {
    const key = process.env.FASTAPI_INTERNAL_KEY;
    return {
        timeout,
        ...(key ? { headers: { "x-api-key": key } } : {}),
    };
};

const getEmbeddingVersion = (note) => {
    const updatedAt = note.updatedAt instanceof Date
        ? note.updatedAt
        : new Date(note.updatedAt || Date.now());
    return Number.isNaN(updatedAt.getTime()) ? new Date().toISOString() : updatedAt.toISOString();
};

const runEmbeddingOperation = (noteId, operation) => {
    const previous = embeddingLocks.get(noteId) || Promise.resolve();
    const current = previous
        .catch(() => undefined)
        .then(operation);
    embeddingLocks.set(noteId, current);

    return current.finally(() => {
        if (embeddingLocks.get(noteId) === current) {
            embeddingLocks.delete(noteId);
        }
    });
};

const performDeleteEmbed = async (noteId) => {
    const url = process.env.FASTAPI_SUMMARIZE_URL;
    if (!url) return { status: "skipped", reason: "not-configured" };

    try {
        const response = await axios.delete(`${url}/delete-embedding/${noteId}`, getFastApiHeaders(FASTAPI_EMBEDDING_TIMEOUT_MS));
        if (response.data?.status !== "ok" || String(response.data.noteId) !== String(noteId)) {
            throw new Error("Invalid embedding deletion response");
        }
        return { status: "ok" };
    } catch (error) {
        console.error(`Delete embedding failed for ${noteId}:`, error.message);
        return { status: "failed", message: "Embedding cleanup failed" };
    }
};

const deleteEmbed = (noteId) => runEmbeddingOperation(String(noteId), () => performDeleteEmbed(String(noteId)));

const runEmbeddingBatch = async (operations, batchSize = 4) => {
    let failures = 0;
    for (let index = 0; index < operations.length; index += batchSize) {
        const results = await Promise.allSettled(operations.slice(index, index + batchSize).map(operation => operation()));
        failures += results.filter(result => (
            result.status === "rejected"
            || ["failed", "partial"].includes(result.value?.status)
        )).length;
    }
    if (failures > 0) {
        console.error(`Embedding batch completed with ${failures} failed operation(s)`);
    }
    return failures;
};

// The note is saved before this operation is started. Embedding failures therefore
// never roll back or hide a successful MongoDB save.
const triggerEmbed = (note, userId) => runEmbeddingOperation(String(note._id), async () => {
    const url = process.env.FASTAPI_SUMMARIZE_URL;
    if (!url) return { status: "skipped", reason: "not-configured" };

    // Build meaningful text for embedding, including checklist items if any
    let embedText = note.content || "";
    if (note.isChecklist && note.checklist && note.checklist.length > 0) {
        const checklistStr = note.checklist.map(item => `- [${item.completed ? 'x' : ' '}] ${item.text}`).join('\n');
        embedText = embedText ? `${embedText}\n\n${checklistStr}` : checklistStr;
    }

    if (note.linkPreviews && note.linkPreviews.length > 0) {
        const previewsStr = note.linkPreviews.map(p => `[Link Preview] ${p.title || ""} - ${p.description || ""}`).join('\n');
        embedText = embedText ? `${embedText}\n\n${previewsStr}` : previewsStr;
    }

    // A title-only note still has useful searchable content.
    if (!embedText.trim() && note.title && note.title.trim()) {
        embedText = note.title.trim();
    }

    // A note that became blank must not leave its old vectors searchable.
    if (!embedText.trim()) return performDeleteEmbed(String(note._id));

    try {
        const response = await axios.post(`${url}/embed-note`, {
            noteId: String(note._id),
            userId: String(userId),
            title: note.title || "",
            text: embedText,
            embeddingVersion: getEmbeddingVersion(note),
            isArchived: Boolean(note.isArchived),
        }, getFastApiHeaders(FASTAPI_EMBEDDING_TIMEOUT_MS));

        const data = response.data;
        const hasValidChunkCount = Number.isInteger(data?.chunks) && data.chunks >= 0;
        const hasValidStaleChunkCount = data?.status !== "partial"
            || (Number.isInteger(data?.staleChunks) && data.staleChunks > 0);
        if (!data || !["ok", "stale", "partial"].includes(data.status)
            || String(data.noteId) !== String(note._id)
            || (["ok", "partial"].includes(data.status) && !hasValidChunkCount)
            || !hasValidStaleChunkCount) {
            throw new Error("Invalid embedding response");
        }
        return { status: data.status, chunks: data.chunks, staleChunks: data.staleChunks };
    } catch (error) {
        console.error(`Embedding process failed for note ${note._id}:`, error.message);
        return { status: "failed", message: "Embedding failed" };
    }
});

const addNote = async (req, res) => {
    const { title, content, tags, isChecklist, checklist, folderId, showInHome, linkPreviews } = req.body;
    const userId = req.user._id;

    if (!title && !content && (!checklist || checklist.length === 0)) {
        return res.status(400).json({ error: true, message: "Content or Title is required" });
    }

    try {
        const targetFolderId = folderId || null;
        if (targetFolderId) {
            if (typeof targetFolderId !== "string" || !mongoose.Types.ObjectId.isValid(targetFolderId)) {
                return res.status(400).json({ error: true, message: "Invalid folder" });
            }
            const targetFolder = await Folder.findOne({
                _id: targetFolderId,
                userId,
                isDeleted: false,
            }).select("_id").lean();
            if (!targetFolder) {
                return res.status(404).json({ error: true, message: "Folder not found" });
            }
        }
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
            linkPreviews: linkPreviews || []
        });

        await note.save();

        const embedding = await triggerEmbed(note, userId);

        return res.json({
            error: false,
            note,
            embedding,
            message: "Note created successfully",
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: true,
            message: error.message || "Internal Server Error",
        });
    }
};

const editNote = async (req, res) => {
    const noteId = req.params.noteId;
    const { title, content, tags, isChecklist, checklist, folderId, showInHome, linkPreviews } = req.body;
    const userId = req.user._id;

    try {
        const note = await Note.findOne({ _id: noteId, userId: userId, isDeleted: { $ne: true } });

        if (!note) {
            return res.status(404).json({ error: true, message: "Note doesn't exist" });
        }

        if (typeof title !== "undefined") note.title = title;
        if (typeof content !== "undefined") note.content = content;
        if (typeof tags !== "undefined") note.tags = tags;
        if (typeof isChecklist !== "undefined") {
            note.isChecklist = isChecklist;
        }
        if (typeof checklist !== "undefined") note.checklist = checklist;
        if (typeof folderId !== "undefined") {
            if (folderId !== null) {
                if (typeof folderId !== "string" || !mongoose.Types.ObjectId.isValid(folderId)) {
                    return res.status(400).json({ error: true, message: "Invalid folder" });
                }
                const targetFolder = await Folder.findOne({
                    _id: folderId,
                    userId,
                    isDeleted: false,
                }).select("_id").lean();
                if (!targetFolder) {
                    return res.status(404).json({ error: true, message: "Folder not found" });
                }
            }
            note.folderId = folderId;
        }
        if (typeof showInHome !== "undefined") {
            note.showInHome = showInHome;
        }
        if (typeof linkPreviews !== "undefined") {
            note.linkPreviews = linkPreviews;
        }

        await note.save();

        // Only re-embed when semantic content actually changed — not for pin/tag-only edits
        const contentChanged = typeof title !== "undefined"
            || typeof content !== "undefined"
            || typeof checklist !== "undefined"
            || typeof isChecklist !== "undefined"
            || typeof linkPreviews !== "undefined";
        let embedding;
        if (contentChanged) {
            embedding = await triggerEmbed(note, userId);
        }


        return res.json({
            error: false,
            note,
            ...(embedding ? { embedding } : {}),
            message: "Note edited successfully",
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
};

const getAllNotes = async (req, res) => {
    const userId = req.user._id;

    try {
        const notes = await Note.find({ userId: userId, isDeleted: { $ne: true }, isArchived: { $ne: true } })
            .select(NOTE_LIST_FIELDS)
            .sort({ orderIndex: 1, createdAt: -1 })
            .lean();

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

const getGraphNotes = async (req, res) => {
    const userId = req.user._id;
    const includeArchived = req.query.includeArchived === "true";

    try {
        const query = {
            userId,
            isDeleted: { $ne: true },
        };
        if (!includeArchived) {
            query.isArchived = { $ne: true };
        }

        const notes = await Note.find(query)
            .select(NOTE_GRAPH_FIELDS)
            .sort({ orderIndex: 1, createdAt: -1 })
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
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
};

const getHomeNotes = async (req, res) => {
    const userId = req.user._id;

    try {
        // Fetch active (non-deleted) folder IDs belonging to the user
        const activeFolders = await Folder.find({ userId, isDeleted: false }).select('_id').lean();
        const activeFolderIds = activeFolders.map(f => f._id.toString());

        // A note is retrieved on Home if:
        // 1. folderId is null (unfiled)
        // 2. OR showInHome is true (surfaced folder note)
        // 3. OR folderId points to a deleted/non-existent folder (orphaned note)
        const notes = await Note.find({
            userId: userId,
            isDeleted: { $ne: true },
            isArchived: { $ne: true },
            $or: [
                { folderId: null },
                { showInHome: true },
                { folderId: { $nin: activeFolderIds } }
            ]
        }).select(NOTE_LIST_FIELDS).sort({ homeOrderIndex: 1, createdAt: -1 }).lean();

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

        const notes = await Note.find(filter)
            .select(NOTE_LIST_FIELDS)
            .sort({ orderIndex: 1, createdAt: -1 })
            .lean();

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
        const notes = await Note.find({ userId: userId, isArchived: true, isDeleted: { $ne: true } })
            .select(NOTE_LIST_FIELDS)
            .sort({ orderIndex: 1, createdAt: -1 })
            .lean();

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

        if (note.isDeleted) {
            return res.status(409).json({ error: true, message: "Note is already in Trash" });
        }

        const updateResult = await Note.updateOne(
            { _id: noteId, userId: userId, isDeleted: { $ne: true } },
            { $set: { isDeleted: true, deletedAt: new Date(), deletedBatchId: null } }
        );
        if (updateResult.modifiedCount !== 1) {
            return res.status(409).json({ error: true, message: "Note changed before it could be moved to Trash" });
        }
        const embedding = await deleteEmbed(noteId);

        return res.json({
            error: false,
            embedding,
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
        const notes = await Note.find({ userId: userId, isDeleted: true, deletedBatchId: null })
            .select(NOTE_TRASH_FIELDS)
            .sort({ deletedAt: -1 })
            .lean();

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

        if (!note.isDeleted) {
            return res.status(409).json({ error: true, message: "Only a trashed note can be restored" });
        }
        if (note.deletedBatchId) {
            return res.status(409).json({ error: true, message: "Restore the containing folder instead" });
        }

        if (note.folderId) {
            const folder = await Folder.findOne({ _id: note.folderId, userId, isDeleted: false }).select("_id").lean();
            if (!folder) {
                note.folderId = await resolveNearestLivingAncestor(note.folderId, userId);
            }
        }

        note.isDeleted = false;
        note.deletedAt = null;
        note.deletedBatchId = null;
        await note.save();
        const embedding = await triggerEmbed(note, userId);

        return res.json({
            error: false,
            message: "Note restored successfully",
            note,
            embedding,
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

        const { answer, sourceNoteIds } = response.data || {};
        if (typeof answer !== "string" || !Array.isArray(sourceNoteIds)
            || sourceNoteIds.some(noteId => typeof noteId !== "string")) {
            return res.status(502).json({ error: true, message: "AI service returned an invalid search response" });
        }

        // Fetch only the matched source notes by ID for the frontend card display
        const sourceNotes = sourceNoteIds.length
            ? await Note.find({ _id: { $in: sourceNoteIds }, userId, isDeleted: { $ne: true } })
                .select(NOTE_LIST_FIELDS)
                .lean()
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

    if (typeof isArchived !== "boolean") {
        return res.status(400).json({ error: true, message: "isArchived must be a boolean" });
    }

    try {
        const note = await Note.findOne({ userId: userId, _id: noteId });

        if (!note) {
            return res.status(404).json({ error: true, message: "Note not found" });
        }

        if (note.isDeleted) {
            return res.status(409).json({ error: true, message: "Trashed notes cannot be archived" });
        }

        note.isArchived = isArchived;
        if (!isArchived) {
            // Un-archiving: verify folder is alive, otherwise bubble up
            if (note.folderId) {
                const folder = await Folder.findOne({ _id: note.folderId, userId, isDeleted: false });
                if (!folder) {
                    note.folderId = await resolveNearestLivingAncestor(note.folderId, userId);
                }
            }
        }
        await note.save();

        // Archived notes remain part of semantic search; only Trash notes are removed.
        const embedding = await triggerEmbed(note, userId);

        return res.json({
            error: false,
            message: isArchived ? "Note archived" : "Note unarchived",
            note,
            embedding,
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

        const safeQuery = escapeRegex(query.trim());
        const matchingNote = await Note.find({
            userId: userId,
            $or: [{ title: { $regex: new RegExp(safeQuery, "i") } }, { content: { $regex: new RegExp(safeQuery, "i") } }],
            isDeleted: { $ne: true },
            isArchived: { $ne: true },
            ...folderFilter,
        }).select(NOTE_LIST_FIELDS).limit(100).lean();

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
        const note = await Note.findOne({ _id: noteId, userId, isDeleted: { $ne: true } });
        if (!note) {
            return res.status(404).json({ error: true, message: "Note not found" });
        }

        if (targetFolderId) {
            if (typeof targetFolderId !== "string" || !mongoose.Types.ObjectId.isValid(targetFolderId)) {
                return res.status(400).json({ error: true, message: "Invalid target folder" });
            }
            const targetFolder = await Folder.findOne({
                _id: targetFolderId,
                userId,
                isDeleted: false,
            }).select("_id").lean();
            if (!targetFolder) {
                return res.status(404).json({ error: true, message: "Target folder not found" });
            }
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
        const note = await Note.findOne({ _id: noteId, userId, isDeleted: { $ne: true } });
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

module.exports = {
    addNote,
    editNote,
    getAllNotes,
    getGraphNotes,
    getHomeNotes,
    getFolderNotes,
    deleteNote,
    getTrashNotes,
    restoreNote,
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
    runEmbeddingBatch,
};
