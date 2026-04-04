import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import { useSearchStore } from './useSearchStore';


export const useNotesStore = create((set, get) => ({
  allNotes: [],
  trashNotes: [],
  isSearch: false,

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

  deleteNote: async (noteId) => {
    try {
      const response = await axiosInstance.delete("/delete-note/" + noteId);
      if (response.data && !response.data.error) {
        get().getAllNotes();
        // maybe return a success message to show a toast
      }
    } catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        console.log("Unexpected error. Please try again", error);
      }
    }
  },

  updateIsPinned: async (noteData) => {
    // We update the backend, but since Option B is "visual only pin" we just refresh
    // Wait, pinning no longer forces sort to top. It's just a boolean update.
    const noteId = noteData._id;
    try {
      const response = await axiosInstance.put("/update-note-pinned/" + noteId, { isPinned: !noteData.isPinned });
      if (response.data && response.data.note) {
        get().getAllNotes();
      }
    } catch (error) {
      console.log(error);
    }
  },

  reorderNotes: async (reorderedNotes) => {
    // 1. Optimistic UI update instantly
    set({ allNotes: reorderedNotes });

    // 2. Prepare payload of [{_id, orderIndex}]
    const updates = reorderedNotes.map((note, index) => ({
      _id: note._id,
      orderIndex: index
    }));

    // 3. Persist in background
    try {
      await axiosInstance.put("/reorder-notes", { updates });
    } catch (error) {
      console.log("Failed to persist order", error);
      // If it fails, we fall back to truth
      get().getAllNotes();
    }
  },

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
        get().getAllNotes(); // Refresh main list too
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


