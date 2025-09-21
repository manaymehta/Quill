import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';

export const useNotesStore = create((set, get) => ({
  allNotes: [],
  isSearch: false,

  getAllNotes: async () => {
    try {
      const response = await axiosInstance.get("/get-all-notes");
      if (response.data && response.data.notes) {
        set({ allNotes: response.data.notes, isSearch: false });
      }
    } catch (error) {
      console.log("Unexpected error. Please try again");
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
        console.log("Unexpected error. Please try again");
      }
    }
  },

  updateIsPinned: async (noteData) => {
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
}));
