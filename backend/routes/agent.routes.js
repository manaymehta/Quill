const express = require("express");
const { chatWithAgent, wakeAgent, getAgentConversation, clearAgentConversation } = require("../controllers/agent.controller");
const { authenticateToken } = require("../middleware/auth.middleware");
const { agentChatLimiter } = require("../middleware/agent-rate-limit");
const { validateObjectBody } = require("../middleware/request-validation");
const { searchSupport } = require("../controllers/agent-search.controller");

const router = express.Router();

// Limiter runs after auth (needs the user id) and before the expensive proxy.
router.post("/agent/chat", authenticateToken, agentChatLimiter, validateObjectBody, chatWithAgent);
// Early wake-up: the chat panel pings this on open (no model call, not rate-limited).
router.get("/agent/wake", authenticateToken, wakeAgent);
router.get("/agent/conversation", authenticateToken, getAgentConversation);
router.delete("/agent/conversation", authenticateToken, clearAgentConversation);
// The agent search tool's note check + keyword search (called by FastAPI with the user's token).
router.post("/agent/search-support", authenticateToken, validateObjectBody, searchSupport);

module.exports = router;
