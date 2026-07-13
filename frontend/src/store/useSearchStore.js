import { create } from 'zustand';

export const useSearchStore = create((set) => ({
  searchQuery: '',
  semanticResult: null,  // { answer: string, sourceNotes: [] }
  searchMode: 'keyword',  // keyword | semantic
  isSearchingAI: false,
  searchScope: 'home',  // 'home' | 'folder'
  scopeFolderIds: [],

  setSearchQuery: (query) => set({ searchQuery: query }),
  clearSearch: () => set({ searchQuery: '' }),
  handleSearch: () => { },
  setSearchMode: (mode) => set({ searchMode: mode }),
  setIsSearchingAI: (val) => set({ isSearchingAI: val }),
  setSemanticResult: (result) => set({ semanticResult: result }),
  clearSemanticResult: () => set({ semanticResult: null }),
  setSearchScope: (scope) => set({ searchScope: scope }),
  setScopeFolderIds: (ids) => set({ scopeFolderIds: ids }),
}))