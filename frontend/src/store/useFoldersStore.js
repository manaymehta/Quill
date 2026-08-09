import { create } from 'zustand';

export const useFoldersStore = create((set) => ({
    activeFolderId: null,
    activeDropdownFolderId: null,

    setActiveFolderId: (id) => set({ activeFolderId: id }),
    setActiveDropdownFolderId: (id) => set({ activeDropdownFolderId: id }),

    getSubtreeIds: (foldersList, folderId) => {
        const folders = Array.isArray(foldersList) ? foldersList : [];
        const subtree = [folderId];
        const traverse = (id) => {
            const children = folders.filter(f => f.parentId === id);
            children.forEach(child => {
                subtree.push(child._id);
                traverse(child._id);
            });
        };
        traverse(folderId);
        return subtree;
    },

    getFolderPath: (foldersList, folderId) => {
        const folders = Array.isArray(foldersList) ? foldersList : [];
        const path = [];
        let currentId = folderId;
        while (currentId) {
            const folder = folders.find(f => f._id === currentId);
            if (!folder) break;
            path.unshift(folder);
            currentId = folder.parentId;
        }
        return path;
    }
}));
