const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// A bulk change the agent proposed and the user hasn't applied yet (the
// in-chat review list — architecture plan §2.3). The list is resolved once
// and saved here, so Apply works on exactly what the user reviewed: notes
// can't repeat or go missing. Expires with the chat (3 days).
const PROPOSAL_TTL_DAYS = 3;

// The note fields an action reads or writes, captured by Express when the
// proposal is made. Apply skips any note whose current state differs.
const snapshotSchema = new Schema(
    {
        folderId: { type: String, default: null },
        showInHome: { type: Boolean, default: false },
        tags: { type: [String], default: [] },
        isArchived: { type: Boolean, default: false },
        isDeleted: { type: Boolean, default: false },
    },
    { _id: false }
);

const candidateSchema = new Schema(
    {
        noteId: { type: String, required: true },
        title: { type: String, default: "" },
        verdict: { type: String, enum: ["likely", "rejected", "unjudged"], default: "likely" },
        reason: { type: String, default: "" },
        snapshot: { type: snapshotSchema, required: true },
    },
    { _id: false }
);

const agentProposalSchema = new Schema(
    {
        proposalId: { type: String, required: true, unique: true },
        userId: { type: String, required: true, index: true },
        action: { type: String, enum: ["move", "tag", "archive", "trash"], required: true },
        params: { type: Schema.Types.Mixed, default: {} },
        instruction: { type: String, default: "" },
        candidates: { type: [candidateSchema], default: [] },
        status: { type: String, enum: ["open", "applied"], default: "open" },
        receiptId: { type: String, default: null },
    },
    { timestamps: true }
);

agentProposalSchema.index({ createdAt: 1 }, { expireAfterSeconds: PROPOSAL_TTL_DAYS * 24 * 60 * 60 });

module.exports = mongoose.model("AgentProposal", agentProposalSchema);
module.exports.PROPOSAL_TTL_DAYS = PROPOSAL_TTL_DAYS;
