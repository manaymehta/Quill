const Folder = require("../models/folder.model");
const Note = require("../models/note.model");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { deleteEmbed, triggerEmbed, runEmbeddingBatch } = require("./note.controller");
const {
    collectSubtreeFolderIds,
    findNearestLivingAncestor,
    getUserFolders,
} = require("../services/folder-tree.service");
const { withOptionalTransaction } = require("../services/mongo-transaction.service");

const getFolders = async (req, res) => {
    const userId = req.user._id;
    try {
        const folders = await Folder.find({ userId, isDeleted: false }).sort({ orderIndex: 1 });
        return res.json({ error: false, folders });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const createFolder = async (req, res) => {
    const { name, parentId, color, icon } = req.body;
    const userId = req.user._id;

    if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: true, message: "Folder name is required" });
    }

    try {
        const normalizedParentId = parentId || null;
        if (normalizedParentId) {
            if (!mongoose.Types.ObjectId.isValid(normalizedParentId)) {
                return res.status(400).json({ error: true, message: "Invalid parent folder" });
            }
            const parentFolder = await Folder.findOne({
                _id: normalizedParentId,
                userId,
                isDeleted: false,
            }).select("_id").lean();
            if (!parentFolder) {
                return res.status(404).json({ error: true, message: "Parent folder not found" });
            }
        }

        // Calculate order index based on siblings
        const siblingCount = await Folder.countDocuments({
            userId,
            parentId: normalizedParentId,
            isDeleted: false,
        });

        const folder = new Folder({
            userId,
            name: name.trim(),
            parentId: normalizedParentId,
            color: color || '#e85d56',
            icon: icon || '📁',
            orderIndex: siblingCount,
        });

        await folder.save();
        return res.json({ error: false, folder, message: "Folder created successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const editFolder = async (req, res) => {
    const folderId = req.params.folderId;
    const { name, color, icon } = req.body;
    const userId = req.user._id;

    try {
        const folder = await Folder.findOne({ _id: folderId, userId, isDeleted: false });
        if (!folder) {
            return res.status(404).json({ error: true, message: "Folder not found" });
        }

        if (typeof name !== "undefined") {
            if (typeof name !== "string" || !name.trim()) {
                return res.status(400).json({ error: true, message: "Folder name is required" });
            }
            folder.name = name.trim();
        }
        if (typeof color !== "undefined") folder.color = color;
        if (typeof icon !== "undefined") folder.icon = icon;

        await folder.save();
        return res.json({ error: false, folder, message: "Folder updated successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const deleteFolder = async (req, res) => {
    const folderId = req.params.folderId;
    const userId = req.user._id;

    try {
        const deletedBatchId = crypto.randomUUID();
        const deletedAt = new Date();

        const noteIds = await withOptionalTransaction(async (session) => {
            const folderQuery = getUserFolders(userId, session);
            const allFolders = await folderQuery;
            const activeFolders = allFolders.filter(folder => !folder.isDeleted);
            const folderIdsInSubtree = collectSubtreeFolderIds(activeFolders, folderId);
            if (folderIdsInSubtree.length === 0) {
                const error = new Error("Folder not found");
                error.statusCode = 404;
                throw error;
            }

            // The server derives the subtree. Client-provided folder lists are never trusted.
            await Folder.updateMany(
                { _id: { $in: folderIdsInSubtree }, userId, isDeleted: false },
                {
                    $set: {
                        isDeleted: true,
                        deletedAt,
                        deletedBatchId,
                        isDeletedRoot: false,
                    },
                },
                session ? { session } : undefined
            );
            const rootUpdate = await Folder.updateOne(
                { _id: folderId, userId, deletedBatchId },
                { $set: { isDeletedRoot: true } },
                session ? { session } : undefined
            );
            if (rootUpdate.matchedCount !== 1) {
                const error = new Error("Folder hierarchy changed while deleting");
                error.statusCode = 409;
                throw error;
            }

            // Individually deleted notes are deliberately excluded from this batch.
            const notesQuery = Note.find({
                folderId: { $in: folderIdsInSubtree },
                userId,
                isDeleted: { $ne: true },
            }, "_id");
            if (session) notesQuery.session(session);
            const notesToDelete = await notesQuery.lean();

            await Note.updateMany(
                {
                    folderId: { $in: folderIdsInSubtree },
                    userId,
                    isDeleted: { $ne: true },
                },
                { $set: { isDeleted: true, deletedAt, deletedBatchId } },
                session ? { session } : undefined
            );

            return notesToDelete.map(note => String(note._id));
        });

        void runEmbeddingBatch(noteIds.map(noteId => () => deleteEmbed(noteId)));

        return res.json({ error: false, message: "Folder and contents moved to Trash" });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: true, message: error.message });
        }
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const reorderFolders = async (req, res) => {
    const { parentId = null, updates } = req.body;
    const userId = req.user._id;

    if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ error: true, message: "Updates array is required" });
    }

    if (parentId) {
        if (!mongoose.Types.ObjectId.isValid(parentId)) {
            return res.status(400).json({ error: true, message: "Invalid parent folder" });
        }
        if (!await Folder.exists({ _id: parentId, userId, isDeleted: false })) {
            return res.status(404).json({ error: true, message: "Parent folder not found" });
        }
    }

    if (updates.some((update) => !update || typeof update._id === "undefined"
        || !mongoose.Types.ObjectId.isValid(update._id)
        || !Number.isInteger(Number(update.orderIndex)) || Number(update.orderIndex) < 0)) {
        return res.status(400).json({ error: true, message: "Invalid folder order updates" });
    }

    try {
        const updateIds = [...new Set(updates.map(update => String(update._id)))];
        const validSiblingCount = await Folder.countDocuments({
            _id: { $in: updateIds },
            userId,
            parentId: parentId || null,
            isDeleted: false,
        });
        if (validSiblingCount !== updateIds.length) {
            return res.status(409).json({ error: true, message: "Folder order contains an invalid sibling" });
        }

        const bulkOps = updates.map(update => ({
            updateOne: {
                filter: {
                    _id: update._id,
                    userId,
                    parentId: parentId || null,
                    isDeleted: false,
                },
                update: { $set: { orderIndex: update.orderIndex } }
            }
        }));

        if (bulkOps.length > 0) {
            await Folder.bulkWrite(bulkOps);
        }

        return res.json({ error: false, message: "Folders reordered successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const restoreFolder = async (req, res) => {
    const folderId = req.params.folderId;
    const userId = req.user._id;

    try {
        const allFolders = await getUserFolders(userId);
        const rootFolder = allFolders.find(f => String(f._id) === String(folderId));

        if (!rootFolder) {
            return res.status(404).json({ error: true, message: "Folder not found" });
        }

        if (!rootFolder.isDeleted || !rootFolder.isDeletedRoot || !rootFolder.deletedBatchId) {
            return res.status(409).json({ error: true, message: "Folder is not a restorable Trash root" });
        }

        const batchFolders = allFolders.filter(folder => (
            folder.deletedBatchId === rootFolder.deletedBatchId && folder.isDeleted
        ));
        if (!batchFolders.some(folder => String(folder._id) === String(folderId))) {
            return res.status(409).json({ error: true, message: "Folder deletion batch is invalid" });
        }

        const batchId = rootFolder.deletedBatchId;
        const newParentId = findNearestLivingAncestor(rootFolder.parentId, allFolders);

        const notesToRestore = await withOptionalTransaction(async (session) => {
            await Folder.updateMany(
                { deletedBatchId: batchId, userId, isDeleted: true },
                { $set: { isDeleted: false, deletedAt: null, deletedBatchId: null, isDeletedRoot: false } },
                session ? { session } : undefined
            );

            const rootUpdate = await Folder.updateOne(
                { _id: folderId, userId, isDeleted: false, deletedBatchId: null },
                { $set: { parentId: newParentId } },
                session ? { session } : undefined
            );
            if (rootUpdate.matchedCount !== 1) {
                const error = new Error("Folder restoration conflicted with another operation");
                error.statusCode = 409;
                throw error;
            }

            const notesQuery = Note.find({ deletedBatchId: batchId, userId, isDeleted: true }).lean();
            if (session) notesQuery.session(session);
            const notes = await notesQuery;
            await Note.updateMany(
                { deletedBatchId: batchId, userId, isDeleted: true },
                { $set: { isDeleted: false, deletedAt: null, deletedBatchId: null } },
                session ? { session } : undefined
            );
            return notes;
        });
        void runEmbeddingBatch(notesToRestore.map(note => () => triggerEmbed(note, userId)));

        return res.json({ error: false, message: "Folder and contents restored successfully" });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: true, message: error.message });
        }
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const deleteFolderPermanent = async (req, res) => {
    const folderId = req.params.folderId;
    const userId = req.user._id;

    try {
        const rootFolder = await Folder.findOne({
            _id: folderId,
            userId,
            isDeleted: true,
            isDeletedRoot: true,
        }).lean();
        if (!rootFolder) {
            return res.status(409).json({ error: true, message: "Only a deleted Trash folder can be permanently deleted" });
        }

        const batchId = rootFolder.deletedBatchId;
        if (!batchId) {
            return res.status(409).json({ error: true, message: "Trash folder deletion batch is invalid" });
        }

        const noteIds = await withOptionalTransaction(async (session) => {
            const batchFolderQuery = Folder.find({
                deletedBatchId: batchId,
                userId,
                isDeleted: true,
            }).select("_id");
            if (session) batchFolderQuery.session(session);
            const batchFolderIds = (await batchFolderQuery.lean()).map(folder => folder._id);
            if (batchFolderIds.length === 0) {
                const error = new Error("Trash folder deletion batch is invalid");
                error.statusCode = 409;
                throw error;
            }

            // Include individually deleted notes that still belong to this folder tree.
            // Otherwise permanently deleting the folders would leave orphaned notes.
            const notesQuery = Note.find({ userId, folderId: { $in: batchFolderIds } }, "_id");
            if (session) notesQuery.session(session);
            const notesToDelete = await notesQuery.lean();

            await Note.deleteMany(
                { userId, folderId: { $in: batchFolderIds } },
                session ? { session } : undefined
            );
            await Folder.deleteMany(
                { deletedBatchId: batchId, userId, isDeleted: true },
                session ? { session } : undefined
            );

            return notesToDelete.map(note => String(note._id));
        });
        void runEmbeddingBatch(noteIds.map(noteId => () => deleteEmbed(noteId)));

        return res.json({ error: false, message: "Folder permanently deleted" });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: true, message: error.message });
        }
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const getTrashFolders = async (req, res) => {
    const userId = req.user._id;
    try {
        const folders = await Folder.find({ userId, isDeleted: true, isDeletedRoot: true }).sort({ deletedAt: -1 }).lean();
        return res.json({ error: false, folders });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

module.exports = {
    getFolders,
    createFolder,
    editFolder,
    deleteFolder,
    reorderFolders,
    restoreFolder,
    deleteFolderPermanent,
    getTrashFolders,
};
