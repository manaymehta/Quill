const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// The undo record of an applied bulk change (architecture plan §5.2). Written
// in the SAME transaction as the change itself, so a change without a receipt
// cannot exist. Undo restores each note's `before` — but only if the note
// still looks like `after` (the user's newer edits are never reverted).
const RECEIPT_TTL_DAYS = 10;

const stateSchema = new Schema(
    {
        folderId: { type: String, default: null },
        showInHome: { type: Boolean, default: false },
        tags: { type: [String], default: [] },
        isArchived: { type: Boolean, default: false },
        isDeleted: { type: Boolean, default: false },
    },
    { _id: false }
);

const opSchema = new Schema(
    {
        noteId: { type: String, required: true },
        title: { type: String, default: "" },
        before: { type: stateSchema, default: null },
        after: { type: stateSchema, default: null },
        status: {
            type: String,
            enum: ["applied", "skipped-changed", "skipped-unchanged", "undone", "undo-skipped"],
            required: true,
        },
    },
    { _id: false }
);

const agentReceiptSchema = new Schema(
    {
        // One receipt per proposal: re-sending Apply returns this receipt
        // instead of applying twice (the unique index also blocks a race).
        proposalId: { type: String, required: true, unique: true },
        userId: { type: String, required: true },
        instruction: { type: String, default: "" },
        action: { type: String, required: true },
        params: { type: Schema.Types.Mixed, default: {} },
        ops: { type: [opSchema], default: [] },
        status: { type: String, enum: ["applied", "undone", "partially-undone"], default: "applied" },
        undoneAt: { type: Date, default: null },
    },
    { timestamps: true }
);

agentReceiptSchema.index({ userId: 1, createdAt: -1 });
agentReceiptSchema.index({ createdAt: 1 }, { expireAfterSeconds: RECEIPT_TTL_DAYS * 24 * 60 * 60 });

module.exports = mongoose.model("AgentReceipt", agentReceiptSchema);
module.exports.RECEIPT_TTL_DAYS = RECEIPT_TTL_DAYS;
