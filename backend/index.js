require("dotenv").config();

const connectDB = require("./config/db");
const express = require("express");
const cors = require("cors");
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

connectDB();

app.set("trust proxy", 1);
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
app.use((error, _req, res, _next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: true, message: "Request payload is too large" });
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: true, message: "Invalid JSON payload" });
  }

  console.error("Unhandled request error:", error);
  return res.status(500).json({ error: true, message: "Internal Server Error" });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
