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
    updateNoteArchive,
    searchNotes,
    summarizeNote,
    getArchivedNotes,
    semanticSearch,
    reorderNotes,
} = require("../controllers/note.controller");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/add-note", authenticateToken, addNote);
router.put("/edit-note/:noteId", authenticateToken, editNote); // Changed from /edit-note/:noteId to match controller logic usage of noteId
router.get("/get-all-notes", authenticateToken, getAllNotes);
router.get("/get-all-pinned-notes", authenticateToken, getPinnedNotes);
router.get("/get-all-archived-notes", authenticateToken, getArchivedNotes);
router.delete("/delete-note/:noteId", authenticateToken, deleteNote);
router.get("/get-trash-notes", authenticateToken, getTrashNotes);
router.put("/restore-note/:noteId", authenticateToken, restoreNote);
router.delete("/delete-trash-note/:noteId", authenticateToken, permanentDeleteNote);
router.put("/update-note-pinned/:noteId", authenticateToken, updateNotePinned);
router.put("/update-note-archive/:noteId", authenticateToken, updateNoteArchive);
router.get("/search-notes", authenticateToken, searchNotes);
router.get("/semantic-search", authenticateToken, semanticSearch);
router.post("/summarize-note", authenticateToken, summarizeNote);
router.put("/reorder-notes", authenticateToken, reorderNotes);

module.exports = router;
