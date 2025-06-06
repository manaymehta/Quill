//dotenv
require("dotenv").config()

//mongoose
const config = require("./config.json");
const mongoose = require("mongoose")
mongoose.connect(config.connectionString)

//database
const User = require("./models/user.model");
const Note = require('./models/note.model');

//express
const express = require("express");
const cors = require("cors");
const app = express();

//jwt
const jwt = require("jsonwebtoken");
const { authenticateToken } = require("./utilities");

app.use(express.json());

app.use(
  cors({
    origin: "*",
  })
);

app.post("/create-account", async (req, res) => {
  const { fullName, email, password } = req.body;

  //error handling
  if (!fullName) {
    return res
      .status(400)
      .json({ error: true, message: "Full Name is required" });
  }

  if (!email) {
    return res
      .status(400)
      .json({ error: true, message: "Email is required" });
  }

  if (!password) {
    return res
      .status(400)
      .json({ error: true, message: "Password is required" });
  }

  //if email id already registered 
  const isUser = await User.findOne({ email: email });
  if (isUser) {
    return res
      .json({ error: true, message: "User already exists", });
  }

  //save new user info
  const user = new User({
    fullName,
    email,
    password,
  });
  await user.save();

  //signing new user info with token
  //const accesToken = jwt.sign({ user }, process.env.ACCESS_TOKEN_SECRET, {expiresIn: "36000m",});
  const accessToken = jwt.sign({
    _id: user._id
  },
    process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "36000m"
  }
  );

  return res.json({
    error: false,
    user,
    accessToken,
    message: "Registration Successful",
  });
});

app.post("/login", async (req, res) => {
  const { fullName, email, password } = req.body;

  //error handling
  if (!email) {
    return res
      .status(400)
      .json({ error: true, message: "Email is required" });
  }

  if (!password) {
    return res
      .status(400)
      .json({ error: true, message: "Password is required" });
  }

  //if email id already registered 
  const userInfo = await User.findOne({ email: email });
  if (!userInfo) {
    return res
      .json({ error: true, message: "User not found", });
  }

  if (userInfo.email == email && userInfo.password == password) {
    const accessToken = jwt.sign(
      { _id: userInfo._id },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "1h" }
    );

    return res.json({
      error: false,
      message: "Login successful",
      email,
      accessToken
    });
  } else {
    return res
      .status(400)
      .json({
        error: true,
        message: "Invalid Credentials"
      });
  }
});

app.post("/add-note", authenticateToken, async (req, res) => {
  const { title, content, tags } = req.body;
  const userId = req.user._id;

  //error handling
  if (!title && !content) {
    return res
      .status(400)
      .json({ error: true, message: "Content or Title is required", });
  }

  try {
    const note = new Note({
      title: title || " ",
      content: content || " ",
      tags: tags || [],
      userId,
    })

    await note.save();

    return res.json({
      error: false,
      note,
      message: "Note created succesfully",
    });
  }
  catch (error) {
    return res.json({
      error: true,
      message: error,
    });
  }
});

app.put("/edit-note/:noteId", authenticateToken, async (req, res) => {
  const noteId = req.params.noteId;
  const { title, content, tags, isPinned } = req.body;
  const userId = req.user._id;

  //error handling
  if (!title && !content && !tags) {
    return res
      .status(400)
      .json({ error: true, message: "No changes", });
  }

  try {
    const note = await Note.findOne({ _id: noteId, userId: userId });

    if (!note) {
      return res.json({ error: true, message: "Note doesn't exist" });
    }

    if (title) note.title = title;
    if (content) note.content = content;
    if (tags) note.tags = tags;
    if (typeof isPinned !== "undefined") {
      note.isPinned = isPinned;
    }

    await note.save();

    return res.json({
      error: false,
      note,
      message: "Note edited successfully"
    });
  }
  catch (error) {
    return res.json({
      error: true,
      message: "Internal Server Error",
    });
  }
});

app.listen(8000);

module.exports = app;