const AgentChat = require("../models/agent-chat.model");
const AgentProposal = require("../models/agent-proposal.model");
const { changeTitle } = require("./bulk-plan.service");

// The user's ONE pending review list (per account) and where it's shown,
// shared by the bulk-change routes and the chat turn that saves a reply.

// A stored list's / receipt's changes (lists from before several changes per
// list have one top-level action).
const changesOf = (doc) => (Array.isArray(doc.changes) && doc.changes.length > 0
    ? doc.changes
    : [{ key: "c1", action: doc.action, params: doc.params || {}, instruction: doc.instruction || "" }]);

const pendingOf = (userId) => AgentProposal.findOne({ userId: String(userId), status: "open" }).sort({ updatedAt: -1 });

// What the agent is told about it: its changes in a few words, note count.
const pendingSummary = (doc) => (doc ? {
    proposalId: doc.proposalId,
    changes: changesOf(doc).map((c) => changeTitle(c)).slice(0, 20),
    notes: doc.candidates.length,
} : null);

// The list lives in one chat turn at a time — the newest one that showed it.
// Every turn holding it (any chat) becomes a one-line pointer ("moved");
// call this before writing the new turn.
const markMoved = (userId, proposalId) => AgentChat.collection.updateMany(
    { userId: String(userId), "turns.proposal.proposalId": proposalId },
    { $set: { "turns.$[t].proposal": { proposalId, moved: true } } },
    { arrayFilters: [{ "t.proposal.proposalId": proposalId }] },
);

module.exports = { changesOf, pendingOf, pendingSummary, markMoved };
