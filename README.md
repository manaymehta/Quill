# Quill - AI-Powered MERN Notes App

Quill is a full-stack note-taking application built with the MERN stack, designed for modern productivity. It integrates an AI-powered summarization service, a dynamic graph visualization to explore note relationships, and a rich, responsive user interface.

**Live Demo**  - (https://quill-green.vercel.app/)

## Features

- **Secure Authentication**: Robust user authentication system using JWT and Google OAuth2.
- **Full CRUD Functionality**: Create, read, update, and delete notes seamlessly.
- **AI-Powered Summarization**: Instantly summarize long notes using a dedicated FastAPI and Groq API microservice.
- **Graph Visualization**: Interactively explore the relationships between your notes through a force-directed graph based on shared tags.
- **Rich Text Editing**: A clean and intuitive editor for formatting your notes.
- **Note Management**:
    - **Pinning**: Keep important notes at the top.
    - **Tagging**: Organize notes with custom tags.
    - **Archiving & Trash**: A complete lifecycle for managing your notes.
- **Dynamic Search**: Quickly find notes with a powerful real-time search.
- **Responsive Design**: A beautiful and functional UI that works on all devices.

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, `react-force-graph-2d`
- **Backend**: Node.js, Express.js
- **Database**: MongoDB, Mongoose
- **AI Microservice**: Python, FastAPI, Groq API
- **Authentication**: JSON Web Tokens (JWT), Google OAuth 2.0

