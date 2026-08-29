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
const {
    validateObjectBody,
    validateObjectIdParam,
    validateQueryParam,
} = require("../middleware/request-validation");

const router = express.Router();

router.param("noteId", validateObjectIdParam("noteId"));

router.post("/add-note", authenticateToken, validateObjectBody, addNote);
router.put("/edit-note/:noteId", authenticateToken, validateObjectBody, editNote);
router.post("/notes/extract-preview", authenticateToken, validateObjectBody, extractLinkPreview);
router.get("/get-all-notes", authenticateToken, getAllNotes);
router.get("/get-home-notes", authenticateToken, getHomeNotes);
router.get("/get-folder-notes", authenticateToken, validateQueryParam("folderIds", { required: true, maxLength: 4096 }), getFolderNotes);
router.get("/get-all-archived-notes", authenticateToken, getArchivedNotes);
router.delete("/delete-note/:noteId", authenticateToken, deleteNote);
router.get("/get-trash-notes", authenticateToken, getTrashNotes);
router.put("/restore-note/:noteId", authenticateToken, restoreNote);
router.put("/restore-trash-note/:noteId", authenticateToken, restoreTrashNote);
router.delete("/delete-trash-note/:noteId", authenticateToken, permanentDeleteNote);
router.put("/update-note-archive/:noteId", authenticateToken, validateObjectBody, updateNoteArchive);
router.get("/search-notes", authenticateToken, validateQueryParam("query", { required: true, maxLength: 4096 }), searchNotes);
router.get("/semantic-search", authenticateToken, validateQueryParam("query", { required: true, maxLength: 4096 }), semanticSearch);
router.post("/summarize-note", authenticateToken, validateObjectBody, summarizeNote);
router.put("/reorder-notes", authenticateToken, validateObjectBody, reorderNotes);
router.put("/reorder-home-notes", authenticateToken, validateObjectBody, reorderHomeNotes);
router.put("/move-note/:noteId", authenticateToken, validateObjectBody, moveNote);
router.put("/toggle-home-pin/:noteId", authenticateToken, validateObjectBody, toggleHomePin);

module.exports = router;
