require("dotenv").config();

const connectDB = require("./config/db");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("node:crypto");
const { setTimeout: scheduleTimeout, clearTimeout: cancelTimeout } = require("node:timers");
const app = express();

const configuredOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length > 0
  ? configuredOrigins
  : ["http://localhost:5173", "http://localhost:3000"];

const authRoutes = require("./routes/auth.routes");
const noteRoutes = require("./routes/note.routes");
const folderRoutes = require("./routes/folder.routes");

app.set("trust proxy", 1);
app.use((req, res, next) => {
  const incomingId = req.headers["x-request-id"];
  const requestId = typeof incomingId === "string" && incomingId.trim()
    ? incomingId.trim()
    : crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});
app.use(express.json({ limit: "10mb" }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));
app.get("/", (req, res) => {
  res.json({ message: "Notes App API is running!" });
});
app.get("/health-check", (req, res) => {
  res.status(200).json({ message: "Server is awake and running." });
});
app.get("/ready", (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: true, message: "Database is not ready" });
  }
  return res.status(200).json({ status: "ready" });
});
// Public API contract. Frontend and backend are deployed together; no legacy
// unversioned aliases are retained.
app.use("/v1", authRoutes);
app.use("/v1", noteRoutes);
app.use("/v1", folderRoutes);

app.use((req, res) => {
  res.status(404).json({ error: true, message: "Route not found" });
});

// Express identifies error middleware by its four-argument signature.
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, _next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: true, message: "Request payload is too large" });
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: true, message: "Invalid JSON payload" });
  }

  console.error(`[${req.id || "no-req-id"}] Unhandled request error:`, error);
  return res.status(500).json({ error: true, message: "Internal Server Error" });
});

const PORT = process.env.PORT || 8000;

const startServer = async () => {
  await connectDB();
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  let isShuttingDown = false;
  const gracefulShutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`${signal} received, shutting down gracefully`);

    const forceExitTimer = scheduleTimeout(() => process.exit(1), 10_000);
    forceExitTimer.unref();
    server.close(async () => {
      try {
        await mongoose.connection.close(false);
      } finally {
        cancelTimeout(forceExitTimer);
        process.exit(0);
      }
    });
  };

  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => gracefulShutdown("SIGINT"));
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Server startup failed:", error);
    process.exit(1);
  });
}

module.exports = app;
