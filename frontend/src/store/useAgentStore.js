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
// A list whose saved record is gone (erased after 3 days; a pinned chat
// outlives it) is 'expired': shown, but it can't be applied any more.
const withReviewState = (proposal) => (proposal ? {
  ...proposal,
  ticked: proposal.candidates.filter((c) => c.verdict === 'likely').map((c) => c.noteId),
  status: proposal.expired ? 'expired' : 'open',
  receipt: null,
  error: null,
} : null);

const withChoiceState = (choices) => (choices ? { ...choices, opening: null } : null);
// Group cards: `opening` holds an "index:action" key (action: new-folder | tag).
const withGroupState = (groups) => (groups ? { ...groups, opening: null } : null);

// A split choice or group-card button that already opened a review list
// scrolls to it instead of opening a duplicate — unless that list was undone
// or expired, where a fresh one is the only way to act again.
// `openedFrom` ("part:<selectionId>:<index>" / "group:<groupingId>:<index>:<action>")
// is set by the server on the list.
const findOpenedList = (messages, openedFrom) => messages.find((m) => m.proposal?.openedFrom === openedFrom
  && m.proposal.status !== 'undone' && m.proposal.status !== 'expired');

export const CHAT_LIMIT = 10;
const CHAT_LIMIT_MESSAGE = `${CHAT_LIMIT} chats is the limit — delete one to start a new chat`;
const BUSY_MESSAGE = 'Wait for the answer (or press Stop) first.';
const showError = (message) => useTabsStore.getState().showTabToast(message, 'error');

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

// Agent chat state: up to CHAT_LIMIT chats per user, saved server-side (each
// erased 3 days after its last message unless pinned). The open chat's
// messages and working set (the notes it is "about") live here; recent
// history is sent with each request.
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

// The running turn's AbortController (Stop), and a counter bumped whenever
// the open chat changes, so a late reply never lands in another chat.
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
  chats: null,         // [{ chatId, title, pinned, lastActivityAt, expiresAt }] — pinned first (null = not loaded)
  chatsError: null,
  activeChatId: null,  // null = a new chat, saved by its first message
  isOpeningChat: false,
  scrollTarget: null,  // { messageId, at } — the panel scrolls to that message and highlights it

  wake: () => {
    const now = Date.now();
    if (now - lastWakeAt < WAKE_INTERVAL_MS) return;
    lastWakeAt = now;
    axiosInstance.get('/agent/wake').catch(() => {});
  },

  // First mount: load the chat list and reopen the most recently active chat
  // (unless a message was already sent meanwhile, e.g. from the search bar).
  hydrate: async () => {
    if (get().isHydrated) return;
    set({ isHydrated: true });
    await get().loadChats();
    const chats = get().chats || [];
    if (chats.length === 0 || get().activeChatId || get().messages.length > 0 || get().isBusy) return;
    const latest = [...chats].sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt))[0];
    await get().openChat(latest.chatId);
  },

  loadChats: async () => {
    try {
      const response = await axiosInstance.get('/agent/chats');
      set({ chats: response.data.chats || [], chatsError: null });
    } catch {
      set({ chatsError: 'Could not load your chats.' });
    }
  },

  openChat: async (chatId) => {
    if (get().isBusy) return showError(BUSY_MESSAGE);
    conversationEpoch += 1;
    const epoch = conversationEpoch;
    set({ isOpeningChat: true });
    try {
      const data = (await axiosInstance.get(`/agent/chats/${chatId}`)).data || {};
      if (epoch !== conversationEpoch) return;
      const turns = Array.isArray(data.turns) ? data.turns : [];
      let messages = turns.map((t) => makeMessage({
        role: t.role,
        text: t.text,
        citations: t.citations || [],
        proposal: withReviewState(t.proposal),
        splitChoices: withChoiceState(t.splitChoices),
        groupSuggestions: withGroupState(t.groupSuggestions),
      }));
      // Review lists already applied (or undone) show their result, not
      // fresh tick boxes: match them to the user's receipts.
      if (messages.some((m) => m.proposal)) {
        const receipts = (await axiosInstance.get('/agent/receipts')).data?.receipts || [];
        if (epoch !== conversationEpoch) return;
        const byProposal = new Map(receipts.map((r) => [r.proposalId, r]));
        messages = messages.map((m) => {
          const receipt = m.proposal && byProposal.get(m.proposal.proposalId);
          return receipt
            ? { ...m, proposal: { ...m.proposal, receipt, status: receipt.status === 'applied' ? 'applied' : 'undone' } }
            : m;
        });
      }
      set({
        activeChatId: chatId,
        messages,
        workingSet: Array.isArray(data.workingSet) ? data.workingSet : [],
        steps: [],
      });
    } catch (error) {
      if (epoch !== conversationEpoch) return;
      showError(error?.response?.data?.message || 'Could not open that chat.');
      if (error?.response?.status === 404) get().loadChats();
    } finally {
      if (epoch === conversationEpoch) set({ isOpeningChat: false });
    }
  },

  // An empty chat; it's saved (and counts toward the limit) with its first message.
  newChat: () => {
    if (get().isBusy) return showError(BUSY_MESSAGE);
    if ((get().chats || []).length >= CHAT_LIMIT) return showError(CHAT_LIMIT_MESSAGE);
    conversationEpoch += 1;
    set({ activeChatId: null, messages: [], workingSet: [], steps: [], isOpeningChat: false });
  },

  renameChat: async (chatId, title) => {
    try {
      const response = await axiosInstance.patch(`/agent/chats/${chatId}`, { title });
      set({ chats: (get().chats || []).map((c) => (c.chatId === chatId ? response.data.chat : c)) });
      return true;
    } catch (error) {
      showError(error?.response?.data?.message || 'Could not rename the chat.');
      return false;
    }
  },

  togglePin: async (chatId) => {
    const chat = (get().chats || []).find((c) => c.chatId === chatId);
    if (!chat) return;
    try {
      await axiosInstance.patch(`/agent/chats/${chatId}`, { pinned: !chat.pinned });
      await get().loadChats();   // re-sorts: pinned first
    } catch (error) {
      showError(error?.response?.data?.message || 'Could not change the pin.');
    }
  },

  deleteChat: async (chatId) => {
    if (get().isBusy && get().activeChatId === chatId) return showError(BUSY_MESSAGE);
    try {
      await axiosInstance.delete(`/agent/chats/${chatId}`);
    } catch (error) {
      if (error?.response?.status !== 404) {
        showError(error?.response?.data?.message || 'Could not delete the chat.');
        return;
      }
    }
    set({ chats: (get().chats || []).filter((c) => c.chatId !== chatId) });
    if (get().activeChatId === chatId) {
      conversationEpoch += 1;
      set({ activeChatId: null, messages: [], workingSet: [], steps: [] });
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
        { message: text, history, workingSet, unsavedNotes, chatId: get().activeChatId },
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
            groupSuggestions: withGroupState(data.groupSuggestions),
          }),
        ],
        workingSet: data.workingSet || get().workingSet,
        activeChatId: data.chatId || get().activeChatId,
        isBusy: false,
        steps: [],
      });
      get().loadChats();   // a new chat's title, and the new order
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
    const existing = findOpenedList(get().messages, `part:${choices.selectionId}:${index}`);
    if (existing) return set({ scrollTarget: { messageId: existing.id, at: Date.now() } });
    const patch = (fields) => set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, splitChoices: { ...m.splitChoices, ...fields } } : m)),
    });
    patch({ opening: index });
    try {
      const response = await axiosInstance.post(
        `/agent/selections/${choices.selectionId}/parts/${index}/open`, {}, { timeout: OPEN_PART_TIMEOUT_MS },
      );
      const data = response.data;
      patch({ opening: null });
      set({
        messages: [...get().messages, makeMessage({
          role: 'assistant',
          text: `Opened “${data.partLabel}” — ${data.candidates.length} notes to review below.`,
          citations: [],
          proposal: withReviewState({
            proposalId: data.proposalId, action: data.action, params: data.params, candidates: data.candidates, openedFrom: data.openedFrom,
          }),
        })],
      });
    } catch (error) {
      patch({ opening: null });
      useTabsStore.getState().showTabToast(error?.response?.data?.message || 'Could not open that part. Try again.', 'error');
    }
  },

  // A suggested group → its own review list (move to a new folder, or tag),
  // added to the chat as a new message.
  openGroupAction: async (messageId, index, action) => {
    const groups = get().messages.find((m) => m.id === messageId)?.groupSuggestions;
    if (!groups || groups.opening !== null || groups.expired) return;
    const key = `${index}:${action}`;
    const existing = findOpenedList(get().messages, `group:${groups.groupingId}:${key}`);
    if (existing) return set({ scrollTarget: { messageId: existing.id, at: Date.now() } });
    const patch = (fields) => set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, groupSuggestions: { ...m.groupSuggestions, ...fields } } : m)),
    });
    patch({ opening: key });
    try {
      const response = await axiosInstance.post(`/agent/groupings/${groups.groupingId}/groups/${index}/propose`, { action });
      const data = response.data;
      patch({ opening: null });
      set({
        messages: [...get().messages, makeMessage({
          role: 'assistant',
          text: `Review list for “${data.groupName}” — ${data.candidates.length} notes below.`,
          citations: [],
          proposal: withReviewState({
            proposalId: data.proposalId, action: data.action, params: data.params, candidates: data.candidates, openedFrom: data.openedFrom,
          }),
        })],
      });
    } catch (error) {
      patch({ opening: null });
      showError(error?.response?.data?.message || 'Could not prepare that review list. Try again.');
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
}));
