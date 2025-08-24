import { create } from 'zustand';

export const useSearchStore = create((set) => ({
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  clearSearch: () => set({ searchQuery: '' }),
  handleSearch: () => {
    const { searchQuery } = useSearchStore.getState();
    console.log('Searching for:', searchQuery);
  },
}));