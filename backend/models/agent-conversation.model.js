const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// One active agent conversation per user. Convenience memory ONLY — undo and
// audit live in receipts (Phase C), never here. The document auto-expires
// CONVERSATION_TTL_DAYS after lastActivityAt (see TTL index below).
const CONVERSATION_TTL_DAYS = 3;
const MAX_STORED_TURNS = 50;

const citationSchema = new Schema(
    {
        noteId: { type: String, required: true },
        title: { type: String, default: "" },
        // Shown on the chat's note cards (start of the text + a few tags).
        snippet: { type: String, default: "" },
        tags: { type: [String], default: [] },
    },
    { _id: false }
);

const turnSchema = new Schema(
    {
        role: { type: String, enum: ["user", "assistant"], required: true },
        text: { type: String, required: true },
        citations: { type: [citationSchema], default: [] },
        // A bulk change's review list or split choices, so they come back
        // after a refresh (validated by agent.controller before storing).
        proposal: { type: Schema.Types.Mixed, default: null },
        splitChoices: { type: Schema.Types.Mixed, default: null },
    },
    { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const agentConversationSchema = new Schema(
    {
        userId: { type: String, required: true, unique: true },
        turns: { type: [turnSchema], default: [] },
        workingSet: { type: [citationSchema], default: [] },
        lastActivityAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

// Auto-erase conversations ~3 days after the last message.
agentConversationSchema.index(
    { lastActivityAt: 1 },
    { expireAfterSeconds: CONVERSATION_TTL_DAYS * 24 * 60 * 60 }
);

module.exports = mongoose.model("AgentConversation", agentConversationSchema);
module.exports.MAX_STORED_TURNS = MAX_STORED_TURNS;
