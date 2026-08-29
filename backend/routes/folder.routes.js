const express = require("express");
const {
    getFolders,
    createFolder,
    editFolder,
    deleteFolder,
    reorderFolders,
    restoreFolder,
    deleteFolderPermanent,
    getTrashFolders,
} = require("../controllers/folder.controller");
const { authenticateToken } = require("../middleware/auth.middleware");
const { validateObjectBody, validateObjectIdParam } = require("../middleware/request-validation");

const router = express.Router();

router.param("folderId", validateObjectIdParam("folderId"));

router.get("/get-folders", authenticateToken, getFolders);
router.post("/create-folder", authenticateToken, validateObjectBody, createFolder);
router.put("/edit-folder/:folderId", authenticateToken, validateObjectBody, editFolder);
router.delete("/delete-folder/:folderId", authenticateToken, deleteFolder);
router.put("/reorder-folders", authenticateToken, validateObjectBody, reorderFolders);
router.get("/get-trash-folders", authenticateToken, getTrashFolders);
router.put("/restore-folder/:folderId", authenticateToken, restoreFolder);
router.delete("/delete-folder-permanent/:folderId", authenticateToken, deleteFolderPermanent);

module.exports = router;
