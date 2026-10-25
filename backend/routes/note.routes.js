const express = require("express");
const {
    addNote,
    editNote,
    getNoteById,
    getAllNotes,
    getGraphNotes,
    getHomeNotes,
    getFolderNotes,
    getFolderNoteCounts,
    deleteNote,
    getTrashNotes,
    restoreNote,
    permanentDeleteNote,
    updateNoteArchive,
    searchNotes,
    summarizeNote,
    getArchivedNotes,
    reorderNotes,
    moveNote,
    toggleShowInHome,
    getNoteIndexStatus,
} = require("../controllers/note.controller");
const { extractLinkPreview } = require("../controllers/scraper.controller");
const { authenticateToken } = require("../middleware/auth.middleware");
const { summarizeLimiter, linkPreviewLimiter } = require("../middleware/rate-limit");
const {
    validateObjectBody,
    validateObjectIdParam,
    validateQueryParam,
} = require("../middleware/request-validation");

const router = express.Router();

router.param("noteId", validateObjectIdParam("noteId"));

router.post("/add-note", authenticateToken, validateObjectBody, addNote);
router.put("/edit-note/:noteId", authenticateToken, validateObjectBody, editNote);
router.get("/note-index-status/:noteId", authenticateToken, getNoteIndexStatus);
router.post("/notes/extract-preview", authenticateToken, linkPreviewLimiter, validateObjectBody, extractLinkPreview);
router.get("/get-note/:noteId", authenticateToken, getNoteById);
router.get("/get-all-notes", authenticateToken, getAllNotes);
router.get("/get-graph-notes", authenticateToken, validateQueryParam("includeArchived", { required: false, maxLength: 10 }), getGraphNotes);
router.get("/get-home-notes", authenticateToken, getHomeNotes);
router.get("/folder-note-counts", authenticateToken, getFolderNoteCounts);
router.get("/get-folder-notes", authenticateToken, validateQueryParam("folderIds", { required: true, maxLength: 4096 }), getFolderNotes);
router.get("/get-all-archived-notes", authenticateToken, getArchivedNotes);
router.delete("/delete-note/:noteId", authenticateToken, deleteNote);
router.get("/get-trash-notes", authenticateToken, getTrashNotes);
router.put("/restore-note/:noteId", authenticateToken, restoreNote);
router.delete("/delete-trash-note/:noteId", authenticateToken, permanentDeleteNote);
router.put("/update-note-archive/:noteId", authenticateToken, validateObjectBody, updateNoteArchive);
router.get("/search-notes", authenticateToken, validateQueryParam("query", { required: true, maxLength: 4096 }), searchNotes);
router.post("/summarize-note", authenticateToken, summarizeLimiter, validateObjectBody, summarizeNote);
router.put("/reorder-notes", authenticateToken, validateObjectBody, reorderNotes);
router.put("/move-note/:noteId", authenticateToken, validateObjectBody, moveNote);
router.put("/toggle-show-in-home/:noteId", authenticateToken, validateObjectBody, toggleShowInHome);
// Old name, kept while a frontend from before the rename may still be open or deploying: remove after the next deploy
router.put("/toggle-home-pin/:noteId", authenticateToken, validateObjectBody, toggleShowInHome);

module.exports = router;
