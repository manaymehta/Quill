import { create } from 'zustand';

// Full-screen editor. Every page load starts with the floating card editor; full screen lasts for
// the session once toggled on. (It used to be remembered across reloads, so a refresh could open
// notes full screen unexpectedly.) The key that remembered it is cleared once, left over from then.
try {
  localStorage.removeItem('quill:editorFullscreen');
} catch {
  // Storage unavailable: nothing to clean up
}

export const useUIStore = create((set) => ({
  isSidebarOpen: false,
  isNavbarVisible: true,
  isEditorFullscreen: false,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleNavbar: () => set((state) => ({ isNavbarVisible: !state.isNavbarVisible })),
  toggleEditorFullscreen: () => set((state) => ({ isEditorFullscreen: !state.isEditorFullscreen })),
}));
