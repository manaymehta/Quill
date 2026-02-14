require("dotenv").config();

const connectDB = require("./config/db");
const express = require("express");
const cors = require("cors");
const app = express();

const authRoutes = require("./routes/auth.routes");
const noteRoutes = require("./routes/note.routes");

connectDB();

app.use(express.json());
app.use(cors({ origin: "*", }));
app.get("/", (req, res) => {
  res.json({ message: "Notes App API is running!" });
});
app.get("/health-check", (req, res) => {
  res.status(200).json({ message: "Server is awake and running." });
});
app.use("/", authRoutes);
app.use("/", noteRoutes);
app.listen(8000, () => {
  console.log("Server is running on port 8000");
});

module.exports = app;