import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import { streamAgentChat } from '../utils/agentStream';
import { applyAgentEdit, collectUnsavedNotes, noteFields, stageAgentDrafts } from '../utils/agentEdits';
import { useTabsStore } from './useTabsStore';

// Agent conversation state. Memory is client-side in the store and persisted
// server-side (~3-day expiry); recent history is sent with each request and
// the working set is the list of notes the chat is "about".
let nextMessageId = 1;

const makeMessage = (partial) => ({ id: nextMessageId++, ...partial });

// Only the turns the model actually reads are sent (mirrors HISTORY_WINDOW in
// fast_api/agent/memory.py). Sending the whole session made long chats hit
// the server's 50-turn cap and fail.
const HISTORY_WINDOW = 10;
const WORKING_SET_TITLE_MAX = 500;

const recentHistory = (messages) => {
  const turns = messages
    .filter((m) => !m.isError)
    .map((m) => ({ role: m.role, text: m.text }))
    .slice(-HISTORY_WINDOW);
  // Start the window on a user turn so the model never sees a reply to a
  // question that was cut off.
  while (turns.length > 0 && turns[0].role !== 'user') turns.shift();
  return turns;
};

// The running turn's AbortController (Stop), and a counter bumped by reset so
// a turn that finishes after the conversation was cleared is ignored.
let activeTurn = null;
let conversationEpoch = 0;

// Progress lines kept on screen for the running turn.
const MAX_VISIBLE_STEPS = 6;

// Early wake-up (architecture plan §2.1 step 0): sleeping Render services
// start waking when the panel opens. At most one ping per 5 minutes.
const WAKE_INTERVAL_MS = 5 * 60_000;
let lastWakeAt = 0;

export const useAgentStore = create((set, get) => ({
  // { id, role: 'user'|'assistant', text, citations?: [{noteId,title}], isError?: bool,
  //   drafts?: staged-draft chips, pendingEdits?: edits waiting for Apply / Skip }
  messages: [],
  workingSet: [],      // [{ noteId, title }] — newest mention first
  isBusy: false,
  steps: [],           // progress lines for the running turn ("Searching your notes for …")
  isHydrated: false,

  wake: () => {
    const now = Date.now();
    if (now - lastWakeAt < WAKE_INTERVAL_MS) return;
    lastWakeAt = now;
    axiosInstance.get('/agent/wake').catch(() => {});
  },

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

    const history = recentHistory(get().messages);
    const workingSet = get().workingSet.map((entry) => ({
      noteId: entry.noteId,
      title: (entry.title || '').slice(0, WORKING_SET_TITLE_MAX),
    }));
    // Notes open with unsaved changes: the agent reads and edits these
    // versions. Keep exactly what was sent, to spot typing done mid-turn.
    const unsavedNotes = collectUnsavedNotes();
    const sentSnapshots = Object.fromEntries(unsavedNotes.map((n) => [n.noteId, noteFields(n)]));

    set({
      messages: [...get().messages, makeMessage({ role: 'user', text })],
      isBusy: true,
      steps: [],
    });

    const controller = new AbortController();
    activeTurn = controller;
    const epoch = conversationEpoch;

    try {
      const data = await streamAgentChat(
        { message: text, history, workingSet, unsavedNotes },
        {
          signal: controller.signal,
          onStep: (label) => {
            if (epoch !== conversationEpoch) return;
            set({ steps: [...get().steps, label].slice(-MAX_VISIBLE_STEPS) });
          },
        }
      ) || {};
      if (epoch !== conversationEpoch) return;

      // Draft lane: stage proposed writes as unsaved dock tabs, or as Apply /
      // Skip prompts for notes with unsaved changes. The model never writes;
      // the user's save is the only commit.
      const { staged, pending } = Array.isArray(data.drafts) && data.drafts.length > 0
        ? await stageAgentDrafts(data.drafts, sentSnapshots)
        : { staged: [], pending: [] };
      if (staged.length > 0) {
        useTabsStore.getState().showTabToast(
          `Staged ${staged.length} unsaved draft${staged.length > 1 ? 's' : ''} in your dock — review and save or discard.`,
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
            drafts: staged,
            pendingEdits: pending,
          }),
        ],
        workingSet: data.workingSet || get().workingSet,
        isBusy: false,
        steps: [],
      });
    } catch (error) {
      if (epoch !== conversationEpoch) return;
      // Error bubbles (including "Stopped.") are excluded from history.
      set({
        messages: [
          ...get().messages,
          makeMessage({
            role: 'assistant',
            text: error?.message || 'The assistant could not respond. Try again.',
            isError: true,
          }),
        ],
        isBusy: false,
        steps: [],
      });
    } finally {
      if (activeTurn === controller) activeTurn = null;
    }
  },

  // The user's answer to an edit prompt on an unsaved note.
  // action: 'apply' | 'applySave' | 'applyAnyway' | 'skip' | 'toggleConflictDiff'
  resolvePendingEdit: async (messageId, index, action) => {
    const edit = get().messages.find((m) => m.id === messageId)?.pendingEdits?.[index];
    if (!edit || edit.status === 'working') return;

    const update = (patch) => set({
      messages: get().messages.map((m) => (m.id !== messageId ? m : {
        ...m,
        pendingEdits: m.pendingEdits.map((e, i) => (i === index ? { ...e, ...patch } : e)),
      })),
    });

    if (action === 'skip') return update({ status: 'skipped' });
    if (action === 'toggleConflictDiff') return update({ showConflictDiff: !edit.showConflictDiff });

    update({ status: 'working' });
    // "Apply anyway" (after a typed-since warning) never saves, so the user
    // can still look at the result first.
    const result = await applyAgentEdit(edit, {
      force: action === 'applyAnyway',
      save: action === 'applySave',
    });
    if (result.status === 'conflict') {
      update({ status: 'conflict', conflictDiff: result.conflictDiff, showConflictDiff: false });
    } else if (result.status === 'applied') {
      update({ status: 'applied', saved: action === 'applySave' });
    } else {
      update({ status: 'failed', reason: result.reason });
    }
  },

  // Stop: closes the stream; Express and FastAPI see the connection close and
  // cancel the turn. Safe at any point — turns never write to the notes.
  stop: () => {
    activeTurn?.abort();
  },

  resetConversation: () => {
    conversationEpoch += 1;
    activeTurn?.abort();
    activeTurn = null;
    set({ messages: [], workingSet: [], isBusy: false, steps: [] });
    // Persisted copy is best-effort: local reset wins immediately either way.
    axiosInstance.delete('/agent/conversation').catch(() => {});
  },
}));
