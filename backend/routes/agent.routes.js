const express = require("express");
const { chatWithAgent, getAgentConversation, clearAgentConversation, listAgentNotes } = require("../controllers/agent.controller");
const { authenticateToken } = require("../middleware/auth.middleware");
const { agentChatLimiter } = require("../middleware/agent-rate-limit");
const { validateObjectBody } = require("../middleware/request-validation");

const router = express.Router();

// Limiter runs after auth (needs the user id) and before the expensive proxy.
router.post("/agent/chat", authenticateToken, agentChatLimiter, validateObjectBody, chatWithAgent);
router.get("/agent/conversation", authenticateToken, getAgentConversation);
router.delete("/agent/conversation", authenticateToken, clearAgentConversation);
router.get("/agent/list-notes", authenticateToken, listAgentNotes);

module.exports = router;
