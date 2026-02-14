const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const noteSchema = new Schema({
    userId: { type: String, required: true },
    title: { type: String, default: "" },
    content: { type: String, default: "" },
    tags: { type: [String], default: [] },
    isPinned: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    createdOn: { type: Date, default: () => new Date() },
    isChecklist: { type: Boolean, default: false },
    checklist: [{
        text: { type: String },
        completed: { type: Boolean, default: false }
    }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
}, {
    timestamps: true
});

module.exports = mongoose.model("Note", noteSchema);