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

// Match the list filters and sort keys used by the Home, Archive, and folder views.
noteSchema.index({ userId: 1, isDeleted: 1, isArchived: 1, orderIndex: 1, createdAt: -1 });
noteSchema.index({ userId: 1, isDeleted: 1, isArchived: 1, folderId: 1, orderIndex: 1, createdAt: -1 });
noteSchema.index({ userId: 1, isDeleted: 1, showInHome: 1, homeOrderIndex: 1, createdAt: -1 });
noteSchema.index({ userId: 1, isDeleted: 1, deletedBatchId: 1, deletedAt: -1 });

module.exports = mongoose.model("Note", noteSchema);
