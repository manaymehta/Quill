import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import { useSearchStore } from './useSearchStore';


export const useNotesStore = create((set, get) => ({
  // Per-view caches keyed by view ID.
  // 'home' -> home notes, '<folderId>' -> that folder's subtree notes
  notesCache: {},      // { [viewKey: string]: Note[] }
  loadingViews: {},    // { [viewKey: string]: boolean }

  // Legacy flat list — kept for AllNotes / search / trash flows that
  // don't need per-folder isolation
  allNotes: [],
  trashNotes: [],
  isSearch: false,

  // ─── Per-view helpers ─────────────────────────────────────────────────────

  // Get notes for a specific view key — returns [] if not yet loaded
  getViewNotes: (viewKey) => get().notesCache[viewKey] ?? [],

  // Is a specific view currently loading?
  isViewLoading: (viewKey) => {
    if (get().notesCache[viewKey] === undefined) return true;
    return get().loadingViews[viewKey] ?? false;
  },

  // ─── Fetchers ─────────────────────────────────────────────────────────────

  getHomeNotes: async () => {
    const key = 'home';
    set(s => ({ loadingViews: { ...s.loadingViews, [key]: true } }));
    try {
      const response = await axiosInstance.get("/get-home-notes");
      if (response.data && response.data.notes) {
        const notes = response.data.notes;
        set(s => ({
          notesCache: { ...s.notesCache, [key]: notes },
          allNotes: notes,
          isSearch: false,
        }));
      }
    } catch (error) {
      console.log("Unexpected error fetching home notes", error);
    } finally {
      set(s => ({ loadingViews: { ...s.loadingViews, [key]: false } }));
    }
  },

  getFolderNotes: async (folderIds, viewKey) => {
    const key = viewKey || (Array.isArray(folderIds) ? folderIds[0] : folderIds);
    set(s => ({ loadingViews: { ...s.loadingViews, [key]: true } }));
    try {
      const folderIdsQuery = Array.isArray(folderIds) ? folderIds.join(",") : folderIds;
      const response = await axiosInstance.get("/get-folder-notes", {
        params: { folderIds: folderIdsQuery }
      });
      if (response.data && response.data.notes) {
        const notes = response.data.notes;
        set(s => ({
          notesCache: { ...s.notesCache, [key]: notes },
          allNotes: notes,
          isSearch: false,
        }));
      }
    } catch (error) {
      console.log("Error fetching folder notes:", error);
    } finally {
      set(s => ({ loadingViews: { ...s.loadingViews, [key]: false } }));
    }
  },

  getAllNotes: async () => {
    try {
      const response = await axiosInstance.get("/get-all-notes");
      if (response.data && response.data.notes) {
        set({ allNotes: response.data.notes, isSearch: false });
      }
    } catch (error) {
      console.log("Unexpected error. Please try again", error);
    }
  },

  onSearch: async (query) => {
    try {
      const response = await axiosInstance.get("/search-notes", {
        params: { query },
      });
      if (response.data && response.data.notes) {
        set({ allNotes: response.data.notes, isSearch: true });
      }
    } catch (error) {
      console.log(error);
    }
  },

  handleClearSearch: () => {
    if (get().isSearch) {
      get().getAllNotes();
    }
  },

  // ─── Mutations ────────────────────────────────────────────────────────────

  deleteNote: async (noteId) => {
    try {
      const response = await axiosInstance.delete("/delete-note/" + noteId);
      if (response.data && !response.data.error) {
        get().refreshActiveView();
      }
    } catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        console.log("Unexpected error. Please try again", error);
      }
    }
  },

  reorderNotes: async (reorderedNotes, viewKey) => {
    // Optimistic update in allNotes and cache
    set(s => ({ 
      allNotes: reorderedNotes,
      notesCache: viewKey ? { ...s.notesCache, [viewKey]: reorderedNotes } : s.notesCache
    }));
    const updates = reorderedNotes.map((note, index) => ({
      _id: note._id,
      orderIndex: index
    }));
    try {
      await axiosInstance.put("/reorder-notes", { updates });
    } catch (error) {
      console.log("Failed to persist order", error);
      get().refreshActiveView();
    }
  },

  reorderHomeNotes: async (reorderedNotes) => {
    set(s => ({ 
      allNotes: reorderedNotes,
      notesCache: { ...s.notesCache, 'home': reorderedNotes }
    }));
    const updates = reorderedNotes.map((note, index) => ({
      _id: note._id,
      homeOrderIndex: index
    }));
    try {
      await axiosInstance.put("/reorder-home-notes", { updates });
    } catch (error) {
      console.log("Failed to persist home order:", error);
      get().getHomeNotes();
    }
  },

  toggleHomePin: async (noteId) => {
    try {
      const response = await axiosInstance.put("/toggle-home-pin/" + noteId);
      if (response.data && !response.data.error) {
        await get().refreshActiveView();
      }
    } catch (error) {
      console.log("Failed to toggle home pin:", error);
    }
  },

  moveNote: async (noteId, targetFolderId) => {
    try {
      const response = await axiosInstance.put("/move-note/" + noteId, { targetFolderId });
      if (response.data && !response.data.error) {
        await get().refreshActiveView();
      }
    } catch (error) {
      console.log("Failed to move note:", error);
    }
  },

  // Refreshes the currently active view (used after saves / deletes)
  refreshActiveView: async () => {
    const { useFoldersStore } = await import('./useFoldersStore');
    const { activeFolderId, getSubtreeIds } = useFoldersStore.getState();
    if (activeFolderId === null) {
      await get().getHomeNotes();
    } else {
      const subtreeIds = getSubtreeIds(activeFolderId);
      await get().getFolderNotes(subtreeIds, activeFolderId);
    }
  },

  // ─── Trash ────────────────────────────────────────────────────────────────

  getTrashNotes: async () => {
    try {
      const response = await axiosInstance.get("/get-trash-notes");
      if (response.data && response.data.notes) {
        set({ trashNotes: response.data.notes });
      }
    } catch (error) {
      console.log("Unexpected error. Please try again", error);
    }
  },

  restoreNote: async (noteId) => {
    try {
      const response = await axiosInstance.put("/restore-note/" + noteId);
      if (response.data && !response.data.error) {
        get().getTrashNotes();
        get().getAllNotes();
      }
    } catch (error) {
      console.log("Unexpected error during restore.", error);
    }
  },

  deleteTrashNote: async (noteId) => {
    try {
      const response = await axiosInstance.delete("/delete-trash-note/" + noteId);
      if (response.data && !response.data.error) {
        get().getTrashNotes();
      }
    } catch (error) {
      console.log("Unexpected error during permanent delete.", error);
    }
  },

  // ─── AI Search ────────────────────────────────────────────────────────────

  onAiSearch: async (query) => {
    const { setIsSearchingAI, setSemanticResult } = useSearchStore.getState();
    setIsSearchingAI(true);
    try {
      const response = await axiosInstance.get("/semantic-search", { params: { query } });
      if (response.data && !response.data.error) {
        setSemanticResult({
          answer: response.data.answer,
          sourceNotes: response.data.sourceNotes || [],
        });
      }
    } catch (error) {
      console.log("AI search error:", error);
    } finally {
      setIsSearchingAI(false);
    }
  },
}));
