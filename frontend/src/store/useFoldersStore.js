import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';

export const useFoldersStore = create((set, get) => ({
    folders: [],
    trashFolders: [],
    activeFolderId: null,
    activeDropdownFolderId: null,

    setActiveFolderId: (id) => set({ activeFolderId: id }),
    setActiveDropdownFolderId: (id) => set({ activeDropdownFolderId: id }),

    getFolders: async () => {
        try {
            const response = await axiosInstance.get("/get-folders");
            if (response.data && response.data.folders) {
                set({ folders: response.data.folders });
            }
        } catch (error) {
            console.log("Error fetching folders:", error);
        }
    },

    createFolder: async (name, parentId, color, icon) => {
        try {
            const response = await axiosInstance.post("/create-folder", {
                name,
                parentId: parentId || null,
                color,
                icon
            });
            if (response.data && !response.data.error) {
                await get().getFolders();
                return response.data.folder;
            }
        } catch (error) {
            console.log("Error creating folder:", error);
        }
    },

    editFolder: async (folderId, patch) => {
        try {
            const response = await axiosInstance.put("/edit-folder/" + folderId, patch);
            if (response.data && !response.data.error) {
                await get().getFolders();
            }
        } catch (error) {
            console.log("Error editing folder:", error);
        }
    },

    deleteFolder: async (folderId) => {
        try {
            const subtreeIds = get().getSubtreeIds(folderId);
            const response = await axiosInstance.delete("/delete-folder/" + folderId, {
                data: { folderIdsInSubtree: subtreeIds }
            });
            if (response.data && !response.data.error) {
                await get().getFolders();
                // If the deleted folder or any of its children was active, clear active folder
                if (subtreeIds.includes(get().activeFolderId)) {
                    set({ activeFolderId: null });
                }
            }
        } catch (error) {
            console.log("Error deleting folder:", error);
        }
    },

    reorderFolders: async (parentId, updates) => {
        // Optimistically update frontend folder orderIndex values
        const currentFolders = get().folders;
        const updatedFolders = currentFolders.map(folder => {
            const update = updates.find(u => u._id === folder._id);
            if (update) {
                return { ...folder, orderIndex: update.orderIndex };
            }
            return folder;
        });
        set({ folders: updatedFolders });

        try {
            await axiosInstance.put("/reorder-folders", { parentId: parentId || null, updates });
        } catch (error) {
            console.log("Error persisting folder order:", error);
            await get().getFolders(); // Rollback to DB truth
        }
    },

    getTrashFolders: async () => {
        try {
            const response = await axiosInstance.get("/get-trash-folders");
            if (response.data && response.data.folders) {
                set({ trashFolders: response.data.folders });
            }
        } catch (error) {
            console.log("Error fetching trash folders:", error);
        }
    },

    restoreFolder: async (folderId) => {
        try {
            const response = await axiosInstance.put("/restore-folder/" + folderId);
            if (response.data && !response.data.error) {
                await get().getTrashFolders();
                await get().getFolders();
            }
        } catch (error) {
            console.log("Error restoring folder:", error);
        }
    },

    deleteFolderPermanent: async (folderId) => {
        try {
            const response = await axiosInstance.delete("/delete-folder-permanent/" + folderId);
            if (response.data && !response.data.error) {
                await get().getTrashFolders();
            }
        } catch (error) {
            console.log("Error permanently deleting folder:", error);
        }
    },

    getSubtreeIds: (folderId) => {
        const subtree = [folderId];
        const traverse = (id) => {
            const children = get().folders.filter(f => f.parentId === id);
            children.forEach(child => {
                subtree.push(child._id);
                traverse(child._id);
            });
        };
        traverse(folderId);
        return subtree;
    },

    getFolderPath: (folderId) => {
        const path = [];
        let currentId = folderId;
        while (currentId) {
            const folder = get().folders.find(f => f._id === currentId);
            if (!folder) break;
            path.unshift(folder);
            currentId = folder.parentId;
        }
        return path; // returns breadcrumb path starting from top parent
    }
}));
