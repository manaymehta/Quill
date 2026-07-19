const express = require("express");
const {
    addNote,
    editNote,
    getAllNotes,
    getHomeNotes,
    getFolderNotes,
    deleteNote,
    getTrashNotes,
    restoreNote,
    restoreTrashNote,
    permanentDeleteNote,
    updateNoteArchive,
    searchNotes,
    summarizeNote,
    getArchivedNotes,
    semanticSearch,
    reorderNotes,
    reorderHomeNotes,
    moveNote,
    toggleHomePin,
} = require("../controllers/note.controller");
const { extractLinkPreview } = require("../controllers/scraper.controller");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/add-note", authenticateToken, addNote);
router.put("/edit-note/:noteId", authenticateToken, editNote);
router.post("/notes/extract-preview", authenticateToken, extractLinkPreview);
router.get("/get-all-notes", authenticateToken, getAllNotes);
router.get("/get-home-notes", authenticateToken, getHomeNotes);
router.get("/get-folder-notes", authenticateToken, getFolderNotes);
router.get("/get-all-archived-notes", authenticateToken, getArchivedNotes);
router.delete("/delete-note/:noteId", authenticateToken, deleteNote);
router.get("/get-trash-notes", authenticateToken, getTrashNotes);
router.put("/restore-note/:noteId", authenticateToken, restoreNote);
router.put("/restore-trash-note/:noteId", authenticateToken, restoreTrashNote);
router.delete("/delete-trash-note/:noteId", authenticateToken, permanentDeleteNote);
router.put("/update-note-archive/:noteId", authenticateToken, updateNoteArchive);
router.get("/search-notes", authenticateToken, searchNotes);
router.get("/semantic-search", authenticateToken, semanticSearch);
router.post("/summarize-note", authenticateToken, summarizeNote);
router.put("/reorder-notes", authenticateToken, reorderNotes);
router.put("/reorder-home-notes", authenticateToken, reorderHomeNotes);
router.put("/move-note/:noteId", authenticateToken, moveNote);
router.put("/toggle-home-pin/:noteId", authenticateToken, toggleHomePin);

module.exports = router;
