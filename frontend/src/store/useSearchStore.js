import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';

let currentSearchAbortController = null;

export const useSearchStore = create((set) => ({
  searchQuery: '',
  semanticResult: null,  // { answer: string, sourceNotes: [] }
  searchMode: 'keyword',  // keyword | semantic
  isSearchingAI: false,
  searchScope: 'home',  // 'home' | 'folder'
  scopeFolderIds: [],

  setSearchQuery: (query) => set({ searchQuery: query }),
  clearSearch: () => {
    if (currentSearchAbortController) {
      currentSearchAbortController.abort();
      currentSearchAbortController = null;
    }
    set({ searchQuery: '', semanticResult: null, isSearchingAI: false });
  },
  setSearchMode: (mode) => {
    if (currentSearchAbortController) {
      currentSearchAbortController.abort();
      currentSearchAbortController = null;
    }
    set({ searchMode: mode, searchQuery: '', semanticResult: null, isSearchingAI: false });
  },
  setIsSearchingAI: (val) => set({ isSearchingAI: val }),
  setSemanticResult: (result) => set({ semanticResult: result }),
  clearSemanticResult: () => {
    if (currentSearchAbortController) {
      currentSearchAbortController.abort();
      currentSearchAbortController = null;
    }
    set({ semanticResult: null, isSearchingAI: false });
  },
  setSearchScope: (scope) => set({ searchScope: scope }),
  setScopeFolderIds: (ids) => set({ scopeFolderIds: ids }),

  executeAiSearch: async (query) => {
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed) return;

    if (currentSearchAbortController) {
      currentSearchAbortController.abort();
    }
    const controller = new AbortController();
    currentSearchAbortController = controller;

    set({ isSearchingAI: true, searchQuery: trimmed });
    try {
      const response = await axiosInstance.get('/semantic-search', {
        params: { query: trimmed },
        signal: controller.signal,
      });
      if (response.data && !response.data.error) {
        set({
          semanticResult: {
            answer: response.data.answer,
            sourceNotes: response.data.sourceNotes || [],
          },
        });
      }
    } catch (error) {
      if (error.name !== 'CanceledError' && error.name !== 'AbortError') {
        console.error('AI search error:', error);
      }
    } finally {
      if (currentSearchAbortController === controller) {
        set({ isSearchingAI: false });
        currentSearchAbortController = null;
      }
    }
  },
}));