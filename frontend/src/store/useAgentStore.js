import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import { streamAgentChat } from '../utils/agentStream';
import { applyAgentEdit, collectUnsavedNotes, noteFields, stageAgentDrafts } from '../utils/agentEdits';
import { queryClient } from '../utils/queryClient';
import { useTabsStore } from './useTabsStore';
import { useToastStore } from './useToastStore';

// ── Bulk changes (review lists, step 3c) ─────────────────────────────────
// A review list's UI state: likely notes start ticked. status: open →
// applying → applied → undoing → undone. The server keeps the real record
// (proposal + receipt); this mirrors it for the chat.
const withReviewState = (proposal) => (proposal ? {
  ...proposal,
  ticked: proposal.candidates.filter((c) => c.verdict === 'likely').map((c) => c.noteId),
  status: 'open',
  receipt: null,
  error: null,
} : null);

const withChoiceState = (choices) => (choices ? { ...choices, opening: null, opened: [] } : null);

const refreshNoteLists = () => {
  queryClient.invalidateQueries({ queryKey: ['notes'] });
  queryClient.invalidateQueries({ queryKey: ['folders'] });
};

export const bulkDoneLabel = (proposal) => {
  if (proposal.action === 'archive') return proposal.params?.archived === false ? 'Unarchived' : 'Archived';
  return { move: 'Moved', tag: 'Tagged', trash: 'Moved to trash' }[proposal.action] || 'Done';
};

// Opening a split choice may run the AI check for that part (up to ~45 s).
const OPEN_PART_TIMEOUT_MS = 60_000;

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
        messages: turns.map((t) => makeMessage({
          role: t.role,
          text: t.text,
          citations: t.citations || [],
          proposal: withReviewState(t.proposal),
          splitChoices: withChoiceState(t.splitChoices),
        })),
        workingSet: Array.isArray(data.workingSet) ? data.workingSet : [],
      });
      // Review lists already applied (or undone) show their result, not
      // fresh tick boxes: match them to the user's receipts.
      if (get().messages.some((m) => m.proposal)) {
        const receipts = (await axiosInstance.get('/agent/receipts')).data?.receipts || [];
        const byProposal = new Map(receipts.map((r) => [r.proposalId, r]));
        set({
          messages: get().messages.map((m) => {
            const receipt = m.proposal && byProposal.get(m.proposal.proposalId);
            return receipt
              ? { ...m, proposal: { ...m.proposal, receipt, status: receipt.status === 'applied' ? 'applied' : 'undone' } }
              : m;
          }),
        });
      }
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
            proposal: withReviewState(data.proposal),
            splitChoices: withChoiceState(data.splitChoices),
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

  // ── Permission toggles + activity log (step 3d) ──
  scopes: null,        // { compose, organize, destructive } — read is always on
  activity: null,      // receipts, newest first (null = not loaded)
  activityError: null,

  loadScopes: async () => {
    try {
      const response = await axiosInstance.get('/agent/settings');
      set({ scopes: response.data.scopes });
    } catch {
      set({ scopes: null });
    }
  },

  setScope: async (key, value) => {
    const previous = get().scopes;
    set({ scopes: { ...previous, [key]: value } });   // instant feedback
    try {
      const response = await axiosInstance.put('/agent/settings', { [key]: value });
      set({ scopes: response.data.scopes });
    } catch (error) {
      set({ scopes: previous });
      useTabsStore.getState().showTabToast(error?.response?.data?.message || 'Could not save the setting.', 'error');
    }
  },

  loadActivity: async () => {
    try {
      const response = await axiosInstance.get('/agent/receipts');
      set({ activity: response.data.receipts || [], activityError: null });
    } catch {
      set({ activityError: 'Could not load the activity log.' });
    }
  },

  // Undo from the activity log (also updates the matching review list in the chat).
  undoFromActivity: async (receiptId) => {
    try {
      const response = await axiosInstance.post(`/agent/receipts/${receiptId}/undo`);
      const receipt = response.data.receipt;
      set({
        activity: (get().activity || []).map((r) => (r.receiptId === receiptId ? receipt : r)),
        messages: get().messages.map((m) => (m.proposal?.receipt?.receiptId === receiptId
          ? { ...m, proposal: { ...m.proposal, status: 'undone', receipt } }
          : m)),
      });
      refreshNoteLists();
      useToastStore.getState().showToast({ label: 'Undone', message: 'notes put back', type: 'success' });
    } catch (error) {
      useTabsStore.getState().showTabToast(error?.response?.data?.message || 'Could not undo. Try again.', 'error');
      get().loadActivity();
    }
  },

  // ── Review lists ──
  toggleReviewNote: (messageId, noteId) => {
    set({
      messages: get().messages.map((m) => {
        if (m.id !== messageId || m.proposal?.status !== 'open') return m;
        const ticked = m.proposal.ticked.includes(noteId)
          ? m.proposal.ticked.filter((id) => id !== noteId)
          : [...m.proposal.ticked, noteId];
        return { ...m, proposal: { ...m.proposal, ticked } };
      }),
    });
  },

  // One Apply for every ticked note: one server transaction, one receipt.
  applyReviewList: async (messageId) => {
    const proposal = get().messages.find((m) => m.id === messageId)?.proposal;
    if (!proposal || proposal.status !== 'open' || proposal.ticked.length === 0) return;
    const patch = (fields) => set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, proposal: { ...m.proposal, ...fields } } : m)),
    });
    patch({ status: 'applying', error: null });
    try {
      const response = await axiosInstance.post(`/agent/proposals/${proposal.proposalId}/apply`, { noteIds: proposal.ticked });
      const receipt = response.data.receipt;
      patch({ status: 'applied', receipt });
      refreshNoteLists();
      const count = receipt.counts.applied;
      useToastStore.getState().showToast({
        label: bulkDoneLabel(proposal),
        message: `${count} note${count === 1 ? '' : 's'}`,
        type: proposal.action === 'trash' ? 'delete' : proposal.action === 'archive' ? 'archive' : 'success',
        onUndo: () => get().undoReviewList(messageId),
      });
    } catch (error) {
      patch({ status: 'open', error: error?.response?.data?.message || 'Could not apply — nothing was changed. Try again.' });
    }
  },

  undoReviewList: async (messageId) => {
    const proposal = get().messages.find((m) => m.id === messageId)?.proposal;
    if (!proposal?.receipt || proposal.status !== 'applied') return;
    const patch = (fields) => set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, proposal: { ...m.proposal, ...fields } } : m)),
    });
    patch({ status: 'undoing', error: null });
    try {
      const response = await axiosInstance.post(`/agent/receipts/${proposal.receipt.receiptId}/undo`);
      patch({ status: 'undone', receipt: response.data.receipt });
      refreshNoteLists();
      useToastStore.getState().showToast({ label: 'Undone', message: bulkDoneLabel(proposal).toLowerCase() + ' notes put back', type: 'success' });
    } catch (error) {
      const data = error?.response?.data;
      if (error?.response?.status === 409 && data?.receipt) {
        patch({ status: 'undone', receipt: data.receipt });   // already undone elsewhere
      } else {
        patch({ status: 'applied', error: data?.message || 'Could not undo. Try again.' });
      }
    }
  },

  // A split choice → its own review list, added to the chat as a new message.
  openSplitChoice: async (messageId, index) => {
    const choices = get().messages.find((m) => m.id === messageId)?.splitChoices;
    if (!choices || choices.opening !== null) return;
    const patch = (fields) => set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, splitChoices: { ...m.splitChoices, ...fields } } : m)),
    });
    patch({ opening: index });
    try {
      const response = await axiosInstance.post(
        `/agent/selections/${choices.selectionId}/parts/${index}/open`, {}, { timeout: OPEN_PART_TIMEOUT_MS },
      );
      const data = response.data;
      patch({ opening: null, opened: [...get().messages.find((m) => m.id === messageId).splitChoices.opened, index] });
      set({
        messages: [...get().messages, makeMessage({
          role: 'assistant',
          text: `Opened “${data.partLabel}” — ${data.candidates.length} notes to review below.`,
          citations: [],
          proposal: withReviewState({ proposalId: data.proposalId, action: data.action, params: data.params, candidates: data.candidates }),
        })],
      });
    } catch (error) {
      patch({ opening: null });
      useTabsStore.getState().showTabToast(error?.response?.data?.message || 'Could not open that part. Try again.', 'error');
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
