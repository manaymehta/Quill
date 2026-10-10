const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// A bulk selection too big for one review list (more than 50 notes), saved
// with the split choices code built for it (architecture plan §2.5 step 2).
// Opening a choice turns that part into a proposal; the borderline AI check
// runs only for the part opened. The full ordered list is kept here, so parts
// never repeat or skip notes. Expires with the chat (3 days).
const SELECTION_TTL_DAYS = 3;

const partSchema = new Schema(
    {
        label: { type: String, required: true },
        noteIds: { type: [String], default: [] },
    },
    { _id: false }
);

const agentSelectionSchema = new Schema(
    {
        selectionId: { type: String, required: true, unique: true },
        userId: { type: String, required: true, index: true },
        action: { type: String, enum: ["move", "tag", "archive", "trash"], required: true },
        params: { type: Schema.Types.Mixed, default: {} },
        instruction: { type: String, default: "" },
        topic: { type: String, default: "" },
        keywords: { type: [String], default: [] },
        // Reason shown for every note when the selection used exact filters only.
        filterReason: { type: String, default: "" },
        parts: { type: [partSchema], default: [] },
    },
    { timestamps: true }
);

agentSelectionSchema.index({ createdAt: 1 }, { expireAfterSeconds: SELECTION_TTL_DAYS * 24 * 60 * 60 });

module.exports = mongoose.model("AgentSelection", agentSelectionSchema);
