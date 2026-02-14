const express = require("express");
const {
    addNote,
    editNote,
    getAllNotes,
    getPinnedNotes,
    deleteNote,
    getTrashNotes,
    restoreNote,
    permanentDeleteNote,
    updateNotePinned,
    searchNotes,
    summarizeNote,
} = require("../controllers/note.controller");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/add-note", authenticateToken, addNote);
router.put("/edit-note/:noteId", authenticateToken, editNote); // Changed from /edit-note/:noteId to match controller logic usage of noteId
router.get("/get-all-notes", authenticateToken, getAllNotes);
router.get("/get-all-pinned-notes", authenticateToken, getAllNotes); // Wait, original was getPinnedNotes logic but endpoint /get-all-pinned-notes
router.get("/get-all-pinned-notes", authenticateToken, getPinnedNotes);
router.delete("/delete-note/:noteId", authenticateToken, deleteNote);
router.get("/get-trash-notes", authenticateToken, getTrashNotes);
router.put("/restore-note/:noteId", authenticateToken, restoreNote);
router.delete("/delete-trash-note/:noteId", authenticateToken, permanentDeleteNote);
router.put("/update-note-pinned/:noteId", authenticateToken, updateNotePinned);
router.get("/search-notes", authenticateToken, searchNotes);
router.post("/summarize-note", authenticateToken, summarizeNote);

module.exports = router;
