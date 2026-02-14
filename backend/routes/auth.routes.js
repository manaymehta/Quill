const express = require("express");
const { createAccount, login, googleAuth, getUser } = require("../controllers/auth.controller");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/create-account", createAccount);
router.post("/login", login);
router.post("/auth/google", googleAuth);
router.get("/get-user", authenticateToken, getUser);

module.exports = router;
