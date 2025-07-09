const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

const axios = require('axios');

app.use(express.json());

app.use(
  cors({
    origin: "*",
  })
);
//User
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
    _id: user._id,
    email: user.email,
    fullName: user.fullName
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
    const accessToken = jwt.sign({
      _id: userInfo._id,
      email: userInfo.email,
      fullName: userInfo.fullName
    },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "36000m" }
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

app.post("/auth/google", async (req, res) => {
  const { token } = req.body;

  try {
    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        email,
        fullName: name,
        googleId,
      });
    }

    const accessToken = jwt.sign(
      {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "36000m" }
    );

    return res.json({
      error: false,
      message: "Google Login Successful",
      accessToken,
    });
  } catch (error) {
    console.error("Google Auth Error", error);
    res.status(401).json({ error: true, message: "Invalid Google Token" });
  }
});

app.get("/get-user", authenticateToken, async (req, res) => {
  const userId = req.user._id;

  try {
    const userInfo = await User.findOne({ _id: userId });

    if (!userInfo) {
      return res.status(401);
    }
    return res.json({
      error: false,
      message: "User Info",
      user: {
        fullName: userInfo.fullName,
        email: userInfo.email,
        _id: userInfo._id,
        createdOn: userInfo.createdOn,
      }
    })
  }
  catch (error) {
    res.status(500).json({ error: true, message: "Internal Server Error" });
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

//Note
app.put("/edit-note/:noteId", authenticateToken, async (req, res) => {
  const noteId = req.params.noteId;
  const { title, content, tags, isPinned } = req.body;
  const userId = req.user._id;

  //error handling
  if (!title && !content && !tags && !isPinned) {
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

app.get("/get-all-notes", authenticateToken, async (req, res) => {
  const userId = req.user._id;

  try {
    const notes = await Note.find({ userId: userId }).sort({ isPinned: -1 });

    return res.json({
      error: false,
      message: "All notes retrieved successfully",
      notes
    })
  }
  catch (error) {
    res
      .status(500)
      .json({
        error: true,
        message: "Internal Server Error"
      })
  }
});

app.get("/get-all-pinned-notes", authenticateToken, async (req, res) => {
  const userId = req.user._id;

  try {
    const notes = await Note.find({ userId: userId, isPinned: true });

    return res.json({
      error: false,
      message: "All notes retrieved successfully",
      notes
    })
  }
  catch (error) {
    res
      .status(500)
      .json({
        error: true,
        message: "Internal Server Error"
      })
  }
});

app.delete("/delete-note/:noteId", authenticateToken, async (req, res) => {
  const noteId = req.params.noteId;
  const userId = req.user._id;

  try {
    const note = await Note.findOne({ userId: userId, _id: noteId });

    if (!note) {
      return res
        .status(404)
        .json({
          error: true,
          message: "Note not found"
        });
    }

    await Note.deleteOne({ userId: userId, _id: noteId })

    return res.json({
      error: false,
      message: "Note deleted successfully"
    });
  }
  catch (error) {
    res
      .status(500)
      .json({
        error: true,
        message: "Internal Server Error"
      })
  }
});

app.put("/update-note-pinned/:noteId", authenticateToken, async (req, res) => {
  const noteId = req.params.noteId;
  const {isPinned} = req.body;
  const userId = req.user._id;

  try {
    const note = await Note.findOne({ userId: userId, _id: noteId });

    if (!note) { return res.status(404).json({ error: true, message: "Note not found" }); }

    note.isPinned = isPinned;
    await note.save();

    return res.json({
      error: false,
      message: "Note unpinned",
      note
    });
  }
  catch (error) {
    res.status(500).json({ error: true, message: "Internal Server Error" })
  }
});

app.get("/search-notes/", authenticateToken, async (req, res) => {
  const userId = req.user._id;
  const {query} = req.query;

  if(!query){
    return res.status(400).json({error: true, message: "Search query is required"})
  }

  try {
    const matchingNote = await Note.find({
      userId: userId,
      $or: [
        {title: {$regex: new RegExp(query, "i")}},
        {content: {$regex: new RegExp(query, "i")}}
      ]
    });

    return res.json({
      error: false,
      message: "note found successfully",
      notes: matchingNote
    })
  } catch (error) {
    return res.status(500).json({error: true, message: "Internal Server Error"});
  }
});

app.post("/summarize-note", authenticateToken, async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim() === "") {
    return res.status(400).json({
      error: true,
      message: "Text content is required for summarization."
    });
  }

  try {
    // IMPORTANT: Set this in your .env file
    // For local development, this might be 'http://localhost:8001/summarize'
    // For deployment on Render, it would be your deployed FastAPI service URL
    const FASTAPI_SUMMARIZE_URL = process.env.FASTAPI_SUMMARIZE_URL;

    if (!FASTAPI_SUMMARIZE_URL) {
        console.error("FASTAPI_SUMMARIZE_URL is not defined in environment variables.");
        return res.status(500).json({
            error: true,
            message: "Summarization service URL is not configured."
        });
    }

    const fastapiResponse = await axios.post(FASTAPI_SUMMARIZE_URL, {
      text: text,
    });

    if (fastapiResponse.data && fastapiResponse.data.summary) {
      return res.json({
        error: false,
        summary: fastapiResponse.data.summary,
        message: "Note summarized successfully."
      });
    } else {
      return res.status(500).json({
        error: true,
        message: "FastAPI did not return a valid summary."
      });
    }

  } catch (error) {
    console.error("Error calling FastAPI summarization service:", error.message);

    let errorMessage = "Internal Server Error during summarization.";
    if (error.response) {
      if (error.response.data && error.response.data.detail) {
        errorMessage = "FastAPI Error: " + error.response.data.detail;
      } else {
        errorMessage = `FastAPI service responded with status ${error.response.status}: ${error.response.statusText}`;
      }

    } else if (error.request) {
      // The request was made but no response was received
      errorMessage = "Could not connect to the summarization service. Is FastAPI running?";

    } else {
      // Something else happened in setting up the request
      errorMessage = "An unexpected error occurred before sending request to FastAPI.";
    }

    return res.status(500).json({
      error: true,
      message: errorMessage,
    });
  }
});


app.listen(8000);

module.exports = app;