const express = require("express");
const { createAccount, login, googleAuth, getUser } = require("../controllers/auth.controller");
const { authenticateToken } = require("../middleware/auth.middleware");
const { validateObjectBody } = require("../middleware/request-validation");

const router = express.Router();

router.post("/create-account", validateObjectBody, createAccount);
router.post("/login", validateObjectBody, login);
router.post("/auth/google", validateObjectBody, googleAuth);
router.get("/get-user", authenticateToken, getUser);

module.exports = router;
