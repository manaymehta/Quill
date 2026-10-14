const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// A bulk change the agent proposed and the user hasn't applied yet (the
// in-chat review list — architecture plan §2.3). The list is resolved once
// and saved here, so Apply works on exactly what the user reviewed: notes
// can't repeat or go missing. Expires with the chat (3 days).
//
// A list holds one or more `changes`; each note appears once, with one item
// per change that affects it (services/bulk-plan.service.js). Lists saved
// before that have a single top-level action / params and per-note verdict.
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

const changeSchema = new Schema(
    {
        key: { type: String, required: true },
        action: { type: String, enum: ["move", "tag", "archive", "trash"], required: true },
        params: { type: Schema.Types.Mixed, default: {} },
        instruction: { type: String, default: "" },
        topic: { type: String, default: "" },
        keywords: { type: [String], default: [] },
    },
    { _id: false }
);

// One change on one note: `label` is the row text ("#a → #b"); clashing items
// can't both be applied.
const itemSchema = new Schema(
    {
        change: { type: String, required: true },
        verdict: { type: String, enum: ["likely", "rejected", "unjudged"], default: "likely" },
        reason: { type: String, default: "" },
        pending: { type: Boolean, default: false },
        label: { type: String, default: "" },
        clashesWith: { type: [String], default: [] },
    },
    { _id: false }
);

const candidateSchema = new Schema(
    {
        noteId: { type: String, required: true },
        title: { type: String, default: "" },
        items: { type: [itemSchema], default: undefined },
        // Lists saved before several changes per list:
        verdict: { type: String, enum: ["likely", "rejected", "unjudged"] },
        reason: { type: String },
        snapshot: { type: snapshotSchema, required: true },
    },
    { _id: false }
);

const agentProposalSchema = new Schema(
    {
        proposalId: { type: String, required: true, unique: true },
        userId: { type: String, required: true, index: true },
        // The chat it was made in (set by Express when the turn is saved).
        chatId: { type: String, default: null },
        changes: { type: [changeSchema], default: undefined },
        // Lists saved before several changes per list:
        action: { type: String, enum: ["move", "tag", "archive", "trash"] },
        params: { type: Schema.Types.Mixed },
        instruction: { type: String, default: "" },
        candidates: { type: [candidateSchema], default: [] },
        // The buttons that opened it ("group:…", "part:…"), so pressing one
        // again scrolls to this list instead of opening a duplicate.
        openedFrom: { type: [String], default: [] },
        // open = the user's ONE pending list (per account), updated in place
        // as changes are added; held = changes prepared while another list
        // was pending (not appliable until added to it or shown after it);
        // discarded = closed unapplied. replaced = older lists only.
        status: { type: String, enum: ["open", "held", "applied", "replaced", "discarded"], default: "open" },
        replacedBy: { type: String, default: null },
        // Bumped on every in-place update; Apply must name the version the
        // user saw, so a list changed meanwhile isn't applied blind.
        version: { type: Number, default: 1 },
        // Why a list is held: "separate" (the agent judged it a different
        // task) or "too-many" (adding it would take the pending list over 50).
        heldReason: { type: String, default: null },
        // Grouping: [{ name, tag, noteIds, changes: [moveKey, tagKey] }] —
        // those changes are shown per group.
        groups: { type: Schema.Types.Mixed, default: undefined },
        receiptId: { type: String, default: null },
    },
    { timestamps: true }
);

agentProposalSchema.index({ createdAt: 1 }, { expireAfterSeconds: PROPOSAL_TTL_DAYS * 24 * 60 * 60 });

module.exports = mongoose.model("AgentProposal", agentProposalSchema);
module.exports.PROPOSAL_TTL_DAYS = PROPOSAL_TTL_DAYS;
