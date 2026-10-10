import { create } from 'zustand';

// Search bar state. Two modes: 'keyword' filters the notes on screen as you
// type; 'agent' turns the bar into a launcher for the notes agent chat. (The
// old one-shot "AI Search" mode was retired into the agent — architecture
// plan D22.)
export const useSearchStore = create((set) => ({
  searchQuery: '',
  searchMode: 'keyword',  // keyword | agent
  searchScope: 'home',  // 'home' | 'folder'
  scopeFolderIds: [],

  setSearchQuery: (query) => set({ searchQuery: query }),
  clearSearch: () => set({ searchQuery: '' }),
  setSearchMode: (mode) => set({ searchMode: mode, searchQuery: '' }),
  setSearchScope: (scope) => set({ searchScope: scope }),
  setScopeFolderIds: (ids) => set({ scopeFolderIds: ids }),
}));
