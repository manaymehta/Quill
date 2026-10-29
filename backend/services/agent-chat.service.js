const AgentChat = require("../models/agent-chat.model");

const { MAX_STORED_TURNS, expiryFor } = AgentChat;

// Appends turns to a chat (capped at MAX_STORED_TURNS, oldest dropped) and restarts its 3-day clock
// (none while pinned). chatId null creates the chat. `workingSet` undefined = unchanged. Returns the
// chat's ID, or null when chatId no longer exists.
// An existing chat gets one atomic $push, so two turns saved at once (an agent reply and a split
// choice opening) both land, and the stored turns are never read back and rewritten.
const appendTurns = async (userId, chatId, turns, { workingSet, newChatTitle } = {}) => {
    if (!chatId) {
        const doc = await AgentChat.create({
            userId: String(userId),
            title: newChatTitle || "New chat",
            turns: turns.slice(-MAX_STORED_TURNS),
            ...(workingSet !== undefined ? { workingSet } : {}),
            lastActivityAt: new Date(),
            expiresAt: expiryFor(false),
        });
        return String(doc._id);
    }

    const doc = await AgentChat.findOneAndUpdate(
        { _id: chatId, userId: String(userId) },
        {
            $push: { turns: { $each: turns, $slice: -MAX_STORED_TURNS } },
            $set: { lastActivityAt: new Date(), ...(workingSet !== undefined ? { workingSet } : {}) },
        },
        { returnDocument: "after", projection: { pinned: 1 } }
    ).lean();
    if (!doc) return null;
    // The clock follows the pin as it was at the push; a pin or unpin since then set its own expiry
    // and wins (the filter no longer matches)
    await AgentChat.updateOne(
        { _id: doc._id, pinned: Boolean(doc.pinned) },
        { $set: { expiresAt: expiryFor(doc.pinned) } }
    );
    return String(doc._id);
};

module.exports = { appendTurns };
