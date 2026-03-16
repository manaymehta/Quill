import { create } from 'zustand';

export const useTabsStore = create((set, get) => ({
  openTabs: [],    // list of note/draft objects
  activeTabId: 'home',  // 'home'|noteId|'draft-'

  setActiveTab: (id) => set({ activeTabId: id }),

  // opens a saved note as a tab
  openTab: (note) => {
    const existing = get().openTabs.find(t => t._id === note._id);
    if (!existing) {
      set({ openTabs: [...get().openTabs, note] });
    }
    set({ activeTabId: note._id });
  },

  // creates a blank temp tab and goes to home
  createDraftTab: () => {
    const newDraftId = `draft-${Date.now()}`;
    const newTab = {
      _id: newDraftId,
      title: '',
      content: '',
      tags: [],
      isChecklist: false,
      checklist: [],
      isDraft: true,
    };
    set({ openTabs: [...get().openTabs, newTab], activeTabId: newDraftId });
    return newDraftId;
  },

  // closes a tab falls back to the previous tab or home
  closeTab: (id) => {
    const tabs = get().openTabs.filter(t => t._id !== id);
    const wasActive = get().activeTabId === id;
    const fallback = tabs.length > 0 ? tabs[tabs.length - 1]._id : 'home';
    set({ openTabs: tabs, ...(wasActive ? { activeTabId: fallback } : {}) });
  },

  // state changes - title, content, tags, checklist, isChecklist from the editor
  updateTabState: (id, patch) => {
    set({
      openTabs: get().openTabs.map(t => t._id === id ? { ...t, ...patch } : t),
    });
  },
}));
