const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const folderSchema = new Schema({
    userId: { type: String, required: true },
    name: { type: String, required: true },
    parentId: { type: String, default: null }, // null = top-level
    color: { type: String, default: '#e85d56' },
    icon: { type: String, default: '📁' },
    orderIndex: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBatchId: { type: String, default: null },
    isDeletedRoot: { type: Boolean, default: false }, // true only on the folder the user actually deleted
}, {
    timestamps: true
});

folderSchema.index({ userId: 1, isDeleted: 1 });
folderSchema.index({ userId: 1, parentId: 1 });
folderSchema.index({ userId: 1, deletedBatchId: 1 });
folderSchema.index({ userId: 1, isDeleted: 1, isDeletedRoot: 1 }); // getTrashFolders query

module.exports = mongoose.model("Folder", folderSchema);
