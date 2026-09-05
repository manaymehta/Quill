import { create } from 'zustand';
import { getSubtreeIds, getFolderPath } from '../utils/folderHierarchy';

export const useFoldersStore = create((set) => ({
    activeFolderId: null,
    activeDropdownFolderId: null,
    activeDropdownNoteId: null,

    setActiveFolderId: (id) => set({ activeFolderId: id }),
    setActiveDropdownFolderId: (id) => set({ activeDropdownFolderId: id, activeDropdownNoteId: null }),
    setActiveDropdownNoteId: (id) => set({ activeDropdownNoteId: id, activeDropdownFolderId: null }),

    getSubtreeIds,
    getFolderPath,
}));
