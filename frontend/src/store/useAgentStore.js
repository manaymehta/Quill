import { create } from 'zustand';
import { diffLines } from 'diff';
import axiosInstance from '../utils/axiosInstance';
import { useTabsStore } from './useTabsStore';

// Phase A agent conversation state. Memory is client-side in the store and
// persisted server-side (~3-day expiry); history is sent with each request
// and the working set is the list of notes the chat is "about".
let nextMessageId = 1;

const makeMessage = (partial) => ({ id: nextMessageId++, ...partial });

// Draft lane contract: agent-proposed writes become UNSAVED TabDock tabs.
// Nothing reaches the backend here; the save button in the editor is the only
// commit path (which then rides the normal save/embed pipeline).
const applyDraftsToDock = async (drafts) => {
  const tabsStore = useTabsStore.getState();
  const staged = [];

  for (const draft of drafts) {
    if (draft.action === 'create') {
      const id = tabsStore.createDraftTab(draft.folderId ?? null, {
        title: draft.title || '',
        content: draft.content || '',
        tags: draft.tags || [],
        isChecklist: draft.isChecklist ?? false,
        checklist: draft.checklist || [],
        agentStaged: true,
      });
      if (id) staged.push({ kind: 'create', tabId: id, title: draft.title });
      continue;
    }

    if (draft.action === 'edit' && draft.noteId) {
      try {
        // Refetch for a truthful baseline: the note may have changed since
        // the model proposed the edit.
        const res = await axiosInstance.get(`/get-note/${draft.noteId}`);
        const note = res.data?.note;
        if (!note) continue;

        tabsStore.openTab(note);
        const patch = {};
        for (const key of ['title', 'content', 'tags', 'isChecklist', 'checklist']) {
          if (draft[key] !== undefined && draft[key] !== null) patch[key] = draft[key];
        }
        if (Object.keys(patch).length === 0) continue;

        const agentDiff = patch.content !== undefined
          ? diffLines(note.content || '', patch.content)
          : null;
        useTabsStore.getState().updateTabState(note._id, {
          ...patch,
          agentStaged: true,
          agentDiff,
          agentOriginalContent: note.content || '',
          agentOriginalTitle: note.title || '',
        });
        staged.push({ kind: 'edit', tabId: note._id, title: patch.title ?? note.title });
      } catch {
        // A note that can't be fetched right now simply isn't staged; the
        // model already reported the draft, so surface the skip honestly.
        useTabsStore.getState().showTabToast('Could not stage one of the drafts (note fetch failed).', 'error');
      }
    }
  }

  return staged;
};

export const useAgentStore = create((set, get) => ({
  messages: [],        // { id, role: 'user'|'assistant', text, citations?: [{noteId,title}], isError?: bool }
  workingSet: [],      // [{ noteId, title }] — newest mention first
  isBusy: false,
  isHydrated: false,

  // Restores the persisted conversation (survives refresh; ~3-day expiry
  // server-side). Called once when the chat panel first mounts.
  hydrate: async () => {
    if (get().isHydrated) return;
    set({ isHydrated: true });
    try {
      const response = await axiosInstance.get('/agent/conversation');
      const data = response.data || {};
      const turns = Array.isArray(data.turns) ? data.turns : [];
      set({
        messages: turns.map((t) => makeMessage({ role: t.role, text: t.text, citations: t.citations || [] })),
        workingSet: Array.isArray(data.workingSet) ? data.workingSet : [],
      });
    } catch (error) {
      // Restore failure must never block a fresh conversation.
      console.error('Agent conversation restore failed:', error?.response?.status || error.message);
    }
  },

  sendMessage: async (rawText) => {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text || get().isBusy) return;

    const history = get().messages
      .filter((m) => !m.isError)
      .map((m) => ({ role: m.role, text: m.text }));
    const workingSetIds = get().workingSet.map((entry) => entry.noteId);

    set({
      messages: [...get().messages, makeMessage({ role: 'user', text })],
      isBusy: true,
    });

    try {
      const response = await axiosInstance.post('/agent/chat', {
        message: text,
        history,
        workingSet: workingSetIds,
      });

      const data = response.data || {};

      // Draft lane: stage any proposed writes as unsaved dock tabs (the model
      // never writes; your save button is the only commit).
      const draftsMeta = Array.isArray(data.drafts) && data.drafts.length > 0
        ? await applyDraftsToDock(data.drafts)
        : [];
      if (draftsMeta.length > 0) {
        useTabsStore.getState().showTabToast(
          `Staged ${draftsMeta.length} unsaved draft${draftsMeta.length > 1 ? 's' : ''} in your dock — review and save or discard.`,
          'success'
        );
      }

      set({
        messages: [
          ...get().messages,
          makeMessage({
            role: 'assistant',
            text: data.message || '',
            citations: data.citations || [],
            drafts: draftsMeta,
          }),
        ],
        workingSet: data.workingSet || get().workingSet,
        isBusy: false,
      });
    } catch (error) {
      const friendly = error?.response?.data?.message || 'The assistant could not respond. Try again.';
      set({
        messages: [
          ...get().messages,
          makeMessage({ role: 'assistant', text: friendly, isError: true }),
        ],
        isBusy: false,
      });
    }
  },

  resetConversation: () => {
    set({ messages: [], workingSet: [], isBusy: false });
    // Persisted copy is best-effort: local reset wins immediately either way.
    axiosInstance.delete('/agent/conversation').catch(() => {});
  },
}));
