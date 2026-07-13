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

const router = express.Router();

router.get("/get-folders", authenticateToken, getFolders);
router.post("/create-folder", authenticateToken, createFolder);
router.put("/edit-folder/:folderId", authenticateToken, editFolder);
router.delete("/delete-folder/:folderId", authenticateToken, deleteFolder);
router.put("/reorder-folders", authenticateToken, reorderFolders);
router.get("/get-trash-folders", authenticateToken, getTrashFolders);
router.put("/restore-folder/:folderId", authenticateToken, restoreFolder);
router.delete("/delete-folder-permanent/:folderId", authenticateToken, deleteFolderPermanent);

module.exports = router;
