const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const noteSchema = new Schema({
    userId: { type: String, required: true },
    title: { type: String, default: "" },
    content: { type: String, default: "" },
    tags: { type: [String], default: [] },
    folderId: { type: String, default: null },
    showInHome: { type: Boolean, default: false },
    homeOrderIndex: { type: Number, default: 0 },
    deletedBatchId: { type: String, default: null },
    isArchived: { type: Boolean, default: false },
    createdOn: { type: Date, default: () => new Date() },
    isChecklist: { type: Boolean, default: false },
    checklist: [{
        text: { type: String },
        completed: { type: Boolean, default: false }
    }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    orderIndex: { type: Number, default: 0 },
    linkPreviews: [{
        url: { type: String, required: true },
        title: { type: String },
        description: { type: String },
        image: { type: String },
        siteName: { type: String },
        createdAt: { type: Date, default: Date.now }
    }],
}, {
    timestamps: true
});

noteSchema.index({ userId: 1, folderId: 1 });
noteSchema.index({ userId: 1, showInHome: 1 });
noteSchema.index({ userId: 1, deletedBatchId: 1 });
noteSchema.index({ userId: 1, isDeleted: 1, isArchived: 1 });

module.exports = mongoose.model("Note", noteSchema);