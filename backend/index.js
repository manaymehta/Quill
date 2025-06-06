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

app.get("/", (req, res) => {
  res.json({ data: "Hello" });
});

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
  const accessToken = jwt.sign({ user }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "36000m",
  });

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
    const user = { user: userInfo };
    const accessToken = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
      expiresIn: "36000m"
    });

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
  const { user } = req.user;

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
      userId: user._id,
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
      message: "Internal Server Error",
    });
  }
});

app.listen(8000);

module.exports = app;