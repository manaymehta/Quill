const Folder = require("../models/folder.model");
const Note = require("../models/note.model");
const crypto = require("crypto");
const { deleteEmbed, triggerEmbed } = require("./note.controller");

// Helper to find nearest living ancestor
const findNearestLivingAncestor = (startParentId, allFolders) => {
    let currentId = startParentId;
    while (currentId) {
        const folder = allFolders.find(f => f._id.toString() === currentId);
        if (!folder) return null; // parent deleted or doesn't exist
        if (!folder.isDeleted) return folder._id.toString(); // found living ancestor
        currentId = folder.parentId; // walk up
    }
    return null;
};

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

    if (!name || !name.trim()) {
        return res.status(400).json({ error: true, message: "Folder name is required" });
    }

    try {
        // Calculate order index based on siblings
        const siblingCount = await Folder.countDocuments({ userId, parentId: parentId || null, isDeleted: false });

        const folder = new Folder({
            userId,
            name: name.trim(),
            parentId: parentId || null,
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
        const folder = await Folder.findOne({ _id: folderId, userId });
        if (!folder) {
            return res.status(404).json({ error: true, message: "Folder not found" });
        }

        if (name && name.trim()) folder.name = name.trim();
        if (color) folder.color = color;
        if (icon) folder.icon = icon;

        await folder.save();
        return res.json({ error: false, folder, message: "Folder updated successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const deleteFolder = async (req, res) => {
    const folderId = req.params.folderId;
    const { folderIdsInSubtree } = req.body;
    const userId = req.user._id;

    if (!folderIdsInSubtree || !Array.isArray(folderIdsInSubtree)) {
        return res.status(400).json({ error: true, message: "Subtree folder IDs are required" });
    }

    try {
        const targetFolder = await Folder.findOne({ _id: folderId, userId });
        if (!targetFolder) {
            return res.status(404).json({ error: true, message: "Folder not found" });
        }

        const deletedBatchId = crypto.randomUUID();
        const deletedAt = new Date();

        // 1. Mark target folder as the deleted root
        await Folder.updateOne(
            { _id: folderId, userId },
            { $set: { isDeletedRoot: true } }
        );

        // 2. Soft-delete all folders in the subtree
        await Folder.updateMany(
            { _id: { $in: folderIdsInSubtree }, userId },
            { $set: { isDeleted: true, deletedAt, deletedBatchId } }
        );

        // 3. Delete embeddings from Qdrant for notes being soft-deleted
        const notesToDelete = await Note.find(
            { folderId: { $in: folderIdsInSubtree }, userId },
            "_id"
        );
        notesToDelete.forEach(note => {
            deleteEmbed(String(note._id));
        });

        // 4. Soft-delete all notes in those folders
        await Note.updateMany(
            { folderId: { $in: folderIdsInSubtree }, userId },
            { $set: { isDeleted: true, deletedAt, deletedBatchId } }
        );

        return res.json({ error: false, message: "Folder and contents moved to Trash" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const reorderFolders = async (req, res) => {
    const { parentId, updates } = req.body;
    const userId = req.user._id;

    if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ error: true, message: "Updates array is required" });
    }

    try {
        const bulkOps = updates.map(update => ({
            updateOne: {
                filter: { _id: update._id, userId, parentId: parentId || null },
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
        const allFolders = await Folder.find({ userId });
        const rootFolder = allFolders.find(f => f._id.toString() === folderId);

        if (!rootFolder) {
            return res.status(404).json({ error: true, message: "Folder not found" });
        }

        const batchId = rootFolder.deletedBatchId;
        const newParentId = findNearestLivingAncestor(rootFolder.parentId, allFolders);

        if (batchId) {
            // Restore folders in batch
            await Folder.updateMany(
                { deletedBatchId: batchId, userId },
                { $set: { isDeleted: false, deletedAt: null, deletedBatchId: null, isDeletedRoot: false } }
            );

            // Re-generate Qdrant vector embeddings for the notes being restored
            const notesToRestore = await Note.find({ deletedBatchId: batchId, userId });
            notesToRestore.forEach(note => {
                triggerEmbed(note, userId);
            });

            // Restore notes in batch
            await Note.updateMany(
                { deletedBatchId: batchId, userId },
                { $set: { isDeleted: false, deletedAt: null, deletedBatchId: null } }
            );
        }

        // Apply bubble-up to root folder parentId
        rootFolder.parentId = newParentId;
        rootFolder.isDeleted = false;
        rootFolder.deletedAt = null;
        rootFolder.isDeletedRoot = false;
        rootFolder.deletedBatchId = null;
        await rootFolder.save();

        return res.json({ error: false, message: "Folder and contents restored successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const deleteFolderPermanent = async (req, res) => {
    const folderId = req.params.folderId;
    const userId = req.user._id;

    try {
        const rootFolder = await Folder.findOne({ _id: folderId, userId });
        if (!rootFolder) {
            return res.status(404).json({ error: true, message: "Folder not found" });
        }

        const batchId = rootFolder.deletedBatchId;
        if (batchId) {
            // Find note IDs to delete embeddings
            const notesToDelete = await Note.find({ deletedBatchId: batchId, userId }, "_id");
            notesToDelete.forEach(note => {
                deleteEmbed(note._id);
            });

            // Hard delete notes and folders
            await Note.deleteMany({ deletedBatchId: batchId, userId });
            await Folder.deleteMany({ deletedBatchId: batchId, userId });
        } else {
            // Safe fallback if deletedBatchId is somehow missing
            await Folder.deleteOne({ _id: folderId, userId });
        }

        return res.json({ error: false, message: "Folder permanently deleted" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
};

const getTrashFolders = async (req, res) => {
    const userId = req.user._id;
    try {
        const folders = await Folder.find({ userId, isDeleted: true, isDeletedRoot: true }).sort({ deletedAt: -1 });
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
