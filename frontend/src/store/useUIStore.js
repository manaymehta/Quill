import { create } from 'zustand';

export const useUIStore = create((set) => ({
  isSidebarOpen: false,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  isNavbarVisible: true,
  toggleNavbar: () => set((state) => ({ isNavbarVisible: !state.isNavbarVisible })),
}));