import { create } from 'zustand';

export const useUIStore = create((set) => ({
  isSidebarOpen: false,
  isNavbarVisible: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleNavbar: () => set((state) => ({ isNavbarVisible: !state.isNavbarVisible })),
}));