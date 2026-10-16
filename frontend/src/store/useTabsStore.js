import { create } from 'zustand';
import { editorRegistry } from '../utils/editorRegistry';
import { useModalStore } from '../components/Modals/useModalStore';
import { useToastStore } from './useToastStore';
import { MODAL_MESSAGES } from '../constants/toastMessages';

export const MAX_OPEN_TABS = 12;

export const useTabsStore = create((set, get) => ({
  openTabs: [], // list of note/draft objects
  activeTabId: 'home', // 'home' | noteId | 'draft-'
  isTabOpen: (id) => Boolean(id && get().openTabs.some((t) => t._id === id)),

  showTabToast: (toastOrMsg, type = 'error') => {
    useToastStore.getState().showToast(toastOrMsg, type);
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  // opens a saved note as a tab
  openTab: (note) => {
    if (!note || !note._id) return false;

    const existing = get().openTabs.find((t) => t._id === note._id);
    if (existing) {
      set({ activeTabId: note._id });
      return true;
    }

    if (get().openTabs.length >= MAX_OPEN_TABS) {
      get().showTabToast(
        `Maximum limit of ${MAX_OPEN_TABS} open tabs reached. Please close an open tab first.`,
        'error'
      );
      return false;
    }

    // Register saved baseline & draft in in-memory registry
    editorRegistry.setBaseline(note._id, note);
    editorRegistry.setDraft(note._id, note);

    set({ openTabs: [...get().openTabs, note], activeTabId: note._id });
    return true;
  },

  createDraftTab: (folderId = null, initial = null) => {
    if (get().openTabs.length >= MAX_OPEN_TABS) {
      get().showTabToast(
        `Maximum limit of ${MAX_OPEN_TABS} open tabs reached. Please close an open tab first.`,
        'error'
      );
      return null;
    }

    const newDraftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const baseTab = {
      _id: newDraftId,
      title: '',
      content: '',
      tags: [],
      isChecklist: false,
      checklist: [],
      isDraft: true,
      folderId: folderId,
      linkPreviews: [],
    };
    const newTab = initial ? { ...baseTab, ...initial, _id: newDraftId, isDraft: true } : baseTab;

    // Baseline intentionally stays BLANK even for prefilled (agent-staged)
    // drafts: closing an unsaved staged draft must trigger the dirty guard,
    // so generated content can't vanish silently.
    editorRegistry.setBaseline(newDraftId, baseTab);
    editorRegistry.setDraft(newDraftId, newTab);

    set({ openTabs: [...get().openTabs, newTab], activeTabId: newDraftId });
    return newDraftId;
  },

  // Force close a tab without prompt and clean up registry
  forceCloseTab: (id) => {
    editorRegistry.cleanupTab(id);
    const closedIndex = get().openTabs.findIndex((t) => t._id === id);
    if (closedIndex === -1) return;

    const tabs = get().openTabs.filter((t) => t._id !== id);
    const wasActive = get().activeTabId === id;
    const fallback = tabs.length > 0
      ? tabs[Math.min(Math.max(closedIndex - 1, 0), tabs.length - 1)]._id
      : 'home';
    set({ openTabs: tabs, ...(wasActive ? { activeTabId: fallback } : {}) });
  },

  // Close tab with dirty-state confirmation check
  closeTab: (id, force = false) => {
    const tab = get().openTabs.find((t) => t._id === id);
    if (!tab) return;

    if (!force && editorRegistry.isTabDirty(id, tab)) {
      useModalStore.getState().openConfirmModal({
        ...MODAL_MESSAGES.DISCARD_UNSAVED_CHANGES,
        onConfirm: () => {
          get().forceCloseTab(id);
        },
      });
      return;
    }

    get().forceCloseTab(id);
  },

  // Update tab draft values from the editor
  updateTabState: (id, patch) => {
    editorRegistry.setDraft(id, patch);
    set({
      openTabs: get().openTabs.map((t) => (t._id === id ? { ...t, ...patch } : t)),
    });
  },

  // Change a tab's contents from outside the editor (agent edits, revert).
  // The editor copies a tab's fields only when it mounts, so bumping
  // externalRev (the editor slot's key) remounts it with the new contents;
  // dropping the CodeMirror snapshot stops the old document coming back.
  applyExternalUpdate: (id, patch) => {
    const tab = get().openTabs.find((t) => t._id === id);
    if (!tab) return false;
    editorRegistry.deleteEditorSnapshot(id);
    get().updateTabState(id, { ...patch, externalRev: (tab.externalRev || 0) + 1 });
    return true;
  },

  // "Revert agent edit": restore exactly what the tab held before the agent's
  // edit was applied (unsaved text included) and drop the agent markers.
  revertAgentEdit: (id) => {
    const tab = get().openTabs.find((t) => t._id === id);
    if (!tab?.agentRevert) return false;
    return get().applyExternalUpdate(id, {
      ...tab.agentRevert,
      agentStaged: false,
      agentDiff: null,
      agentRevert: null,
      agentOriginalContent: undefined,
      agentOriginalTitle: undefined,
    });
  },

  // Close all tabs and clean up registry — call on logout
  resetTabs: () => {
    get().openTabs.forEach((t) => editorRegistry.cleanupTab(t._id));
    set({ openTabs: [], activeTabId: 'home' });
  },
}));
