import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import { useSearchStore } from './useSearchStore';

export const useNotesStore = create((set) => ({
  isSearch: false,
  searchResults: [],

  onSearch: (results) => set({ isSearch: true, searchResults: results }),
  handleClearSearch: () => set({ isSearch: false, searchResults: [] }),

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
