const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// A user's agent chats (up to MAX_CHATS_PER_USER). Convenience memory ONLY —
// undo and audit live in receipts, never here. An unpinned chat is erased
// CHAT_TTL_DAYS after its last activity (each new message resets the clock);
// a pinned chat has no expiresAt, so the TTL index never erases it.
const CHAT_TTL_DAYS = 3;
const CHAT_TTL_MS = CHAT_TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_STORED_TURNS = 50;
const MAX_CHATS_PER_USER = 10;
const CHAT_TITLE_MAX = 80;

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
        groupSuggestions: { type: Schema.Types.Mixed, default: null },
    },
    { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const agentChatSchema = new Schema(
    {
        userId: { type: String, required: true },
        title: { type: String, default: "New chat" },
        pinned: { type: Boolean, default: false },
        turns: { type: [turnSchema], default: [] },
        workingSet: { type: [citationSchema], default: [] },
        lastActivityAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, default: () => new Date(Date.now() + CHAT_TTL_MS) },
    },
    { timestamps: true }
);

agentChatSchema.index({ userId: 1, lastActivityAt: -1 });
// MongoDB erases a chat once expiresAt passes; documents without it (pinned)
// are never erased.
agentChatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// The expiry for a chat with activity now: none while pinned.
const expiryFor = (pinned) => (pinned ? null : new Date(Date.now() + CHAT_TTL_MS));

module.exports = mongoose.model("AgentChat", agentChatSchema);
Object.assign(module.exports, {
    CHAT_TTL_DAYS, MAX_STORED_TURNS, MAX_CHATS_PER_USER, CHAT_TITLE_MAX, expiryFor,
});
