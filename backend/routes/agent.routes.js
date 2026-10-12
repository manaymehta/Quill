const express = require("express");
const {
    chatWithAgent, wakeAgent, listChats, getChat, updateChat, deleteChat, getAgentSettings, updateAgentSettings,
} = require("../controllers/agent.controller");
const { authenticateToken } = require("../middleware/auth.middleware");
const { agentChatLimiter } = require("../middleware/agent-rate-limit");
const { validateObjectBody } = require("../middleware/request-validation");
const { searchSupport } = require("../controllers/agent-search.controller");
const {
    createProposal, applyProposal, undoReceipt, listReceipts, selectNotes, createSelection, openSelectionPart,
    createGrouping, proposeGroup,
} = require("../controllers/agent-bulk.controller");

const router = express.Router();

// Limiter runs after auth (needs the user id) and before the expensive proxy.
router.post("/agent/chat", authenticateToken, agentChatLimiter, validateObjectBody, chatWithAgent);
// Early wake-up: the chat panel pings this on open (no model call, not rate-limited).
router.get("/agent/wake", authenticateToken, wakeAgent);
// Chats (up to 10 per user): list, open, rename / pin, delete. A chat is
// created by its first message (POST /agent/chat without chatId).
router.get("/agent/chats", authenticateToken, listChats);
router.get("/agent/chats/:chatId", authenticateToken, getChat);
router.patch("/agent/chats/:chatId", authenticateToken, validateObjectBody, updateChat);
router.delete("/agent/chats/:chatId", authenticateToken, deleteChat);
// Permission toggles: what the agent may do (read is always on).
router.get("/agent/settings", authenticateToken, getAgentSettings);
router.put("/agent/settings", authenticateToken, validateObjectBody, updateAgentSettings);
// The agent search tool's note check + keyword search (called by FastAPI with the user's token).
router.post("/agent/search-support", authenticateToken, validateObjectBody, searchSupport);
// Bulk changes: saved review lists, one-transaction apply with a receipt, undo.
router.post("/agent/proposals", authenticateToken, validateObjectBody, createProposal);
router.post("/agent/proposals/:proposalId/apply", authenticateToken, validateObjectBody, applyProposal);
router.post("/agent/receipts/:receiptId/undo", authenticateToken, undoReceipt);
router.get("/agent/receipts", authenticateToken, listReceipts);
// Bulk selection (step 3b): complete exact-filter list, split choices, opening a choice.
router.post("/agent/select-notes", authenticateToken, validateObjectBody, selectNotes);
router.post("/agent/selections", authenticateToken, validateObjectBody, createSelection);
router.post("/agent/selections/:selectionId/parts/:index/open", authenticateToken, openSelectionPart);
// Grouping: suggested groups of related notes; a group → a review list (new folder or tag).
router.post("/agent/groupings", authenticateToken, validateObjectBody, createGrouping);
router.post("/agent/groupings/:groupingId/groups/:index/propose", authenticateToken, validateObjectBody, proposeGroup);

module.exports = router;
