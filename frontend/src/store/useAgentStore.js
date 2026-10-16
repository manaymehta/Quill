import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import { streamAgentChat } from '../utils/agentStream';
import { applyAgentEdit, collectUnsavedNotes, noteFields, stageAgentDrafts } from '../utils/agentEdits';
import { queryClient } from '../utils/queryClient';
import { useTabsStore } from './useTabsStore';
import { useToastStore } from './useToastStore';

// ── Bulk changes (review lists, step 3c) ─────────────────────────────────
// The user has at most ONE pending review list (per account), updated in
// place as changes are added. It's shown in the newest message that holds
// it; older messages show a one-line pointer ('moved'). Changes the agent
// prepared for a separate task while a list is pending are 'held': a short
// card with "Add to the pending list" / "Show it after".
// A list holds one or more changes; each note is one row with an item per
// change (labels and clashes worked out by the server). `ticked` holds
// "noteId|changeKey" per ticked item — likely items start ticked, clashing
// ones don't. Grouping lists show their changes per group: nothing starts
// ticked, and `excluded` holds notes left out (those that may not fit).
// status: open → applying → applied → undoing → undone; also held, moved,
// expired (record erased after 3 days), discarded, replaced (older lists).
const itemKey = (noteId, change) => `${noteId}|${change}`;

// Lists saved before several changes per list had one action and a verdict
// per note.
const normalizeProposal = (p) => {
  const changes = p.changes?.length ? p.changes : [{ key: 'c1', action: p.action, params: p.params || {} }];
  const candidates = (p.candidates || []).map((c) => ({
    ...c,
    items: c.items?.length ? c.items : [{ change: 'c1', verdict: c.verdict, reason: c.reason || '', label: '', clashesWith: [] }],
  }));
  const openedFrom = Array.isArray(p.openedFrom) ? p.openedFrom : p.openedFrom ? [p.openedFrom] : [];
  return { ...p, changes, candidates, openedFrom, groups: Array.isArray(p.groups) ? p.groups : [] };
};

const groupChangeKeys = (p) => new Set(p.groups.flatMap((g) => g.changes));

const withReviewState = (proposal) => {
  if (!proposal) return null;
  // movedTo: { chatId, title } when the list is now shown in another chat.
  if (proposal.moved) return { proposalId: proposal.proposalId, status: 'moved', movedTo: proposal.movedTo || null };
  const p = normalizeProposal(proposal);
  const grouped = groupChangeKeys(p);
  return {
    ...p,
    ticked: p.candidates.flatMap((c) => c.items
      .filter((i) => i.verdict === 'likely' && !(i.clashesWith || []).length && !grouped.has(i.change))
      .map((i) => itemKey(c.noteId, i.change))),
    excluded: p.candidates.filter((c) => c.items.some((i) => grouped.has(i.change) && i.verdict !== 'likely')).map((c) => c.noteId),
    status: p.closed || (p.expired ? 'expired' : p.status === 'held' ? 'held' : 'open'),
    receipt: null,
    error: null,
  };
};

// Notes with at least one ticked item, as Apply's picks.
export const reviewPicks = (proposal) => proposal.candidates
  .map((c) => ({ noteId: c.noteId, changes: c.items.filter((i) => proposal.ticked.includes(itemKey(c.noteId, i.change))).map((i) => i.change) }))
  .filter((p) => p.changes.length > 0);

// The list now lives in a newer message: older messages holding it point there.
const markMoved = (messages, proposalId) => messages.map((m) => (m.proposal?.proposalId === proposalId && m.proposal.status !== 'moved'
  ? { ...m, proposal: { proposalId, status: 'moved' } }
  : m));

const withChoiceState = (choices) => (choices ? { ...choices, opening: null } : null);

// A split-choice button whose part is already in a list scrolls to it
// instead of adding it again — unless that list is closed (undone, expired,
// discarded…), where opening the part again is the only way to act.
// `openedFrom` (["part:<selectionId>:<index>", …]) is set by the server.
const CLOSED_STATUSES = ['undone', 'expired', 'replaced', 'discarded', 'moved'];
const findOpenedList = (messages, openedFrom) => messages.find((m) => m.proposal?.openedFrom?.includes(openedFrom)
  && !CLOSED_STATUSES.includes(m.proposal.status));

export const CHAT_LIMIT = 10;
const CHAT_LIMIT_MESSAGE = `${CHAT_LIMIT} chats is the limit — delete one to start a new chat`;
const BUSY_MESSAGE = 'Wait for the answer (or press Stop) first.';
const showError = (message) => useTabsStore.getState().showTabToast(message, 'error');

const refreshNoteLists = () => {
  queryClient.invalidateQueries({ queryKey: ['notes'] });
  queryClient.invalidateQueries({ queryKey: ['folders'] });
};

// "Moved", "Tagged"… for a list or receipt with one change; "Changed" for several.
export const bulkDoneLabel = (proposal) => {
  const changes = proposal.changes?.length ? proposal.changes : [{ action: proposal.action, params: proposal.params }];
  if (changes.length !== 1) return 'Changed';
  const { action, params } = changes[0];
  if (action === 'archive') return params?.archived === false ? 'Unarchived' : 'Archived';
  return { move: 'Moved', tag: 'Tagged', trash: 'Moved to trash' }[action] || 'Done';
};
const singleAction = (proposal) => (proposal.changes?.length === 1 ? proposal.changes[0].action : null);

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
      // Review lists already applied (or undone) come with their receipt and
      // show the result, not fresh tick boxes. Moved pointers never have one.
      const reviewState = (proposal) => {
        const p = withReviewState(proposal);
        const receipt = p && p.status !== 'moved' && proposal.receipt;
        return receipt ? { ...p, receipt, status: receipt.status === 'applied' ? 'applied' : 'undone' } : p;
      };
      const messages = turns.map((t) => makeMessage({
        role: t.role,
        text: t.text,
        citations: t.citations || [],
        proposal: reviewState(t.proposal),
        splitChoices: withChoiceState(t.splitChoices),
        // Group cards from before grouping made review lists.
        oldGroupCards: Boolean(t.groupSuggestions),
      }));
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
          ...(data.proposal?.status === 'open' ? markMoved(get().messages, data.proposal.proposalId) : get().messages),
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
  // Ticking an item unticks the items it clashes with on that note.
  toggleReviewItem: (messageId, noteId, change) => {
    set({
      messages: get().messages.map((m) => {
        if (m.id !== messageId || m.proposal?.status !== 'open') return m;
        const key = itemKey(noteId, change);
        if (m.proposal.ticked.includes(key)) {
          return { ...m, proposal: { ...m.proposal, ticked: m.proposal.ticked.filter((k) => k !== key) } };
        }
        const item = m.proposal.candidates.find((c) => c.noteId === noteId)?.items.find((i) => i.change === change);
        const clashing = (item?.clashesWith || []).map((other) => itemKey(noteId, other));
        return { ...m, proposal: { ...m.proposal, ticked: [...m.proposal.ticked.filter((k) => !clashing.includes(k)), key] } };
      }),
    });
  },

  // One Apply for every ticked item: one server transaction, one receipt.
  applyReviewList: async (messageId) => {
    const proposal = get().messages.find((m) => m.id === messageId)?.proposal;
    const picks = proposal && reviewPicks(proposal);
    if (!proposal || proposal.status !== 'open' || picks.length === 0) return;
    const patch = (fields) => set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, proposal: { ...m.proposal, ...fields } } : m)),
    });
    patch({ status: 'applying', error: null });
    try {
      const response = await axiosInstance.post(`/agent/proposals/${proposal.proposalId}/apply`, { picks, version: proposal.version });
      const receipt = response.data.receipt;
      patch({ status: 'applied', receipt });
      refreshNoteLists();
      const count = receipt.counts.applied;
      const action = singleAction(proposal);
      useToastStore.getState().showToast({
        label: bulkDoneLabel(proposal),
        message: `${count} note${count === 1 ? '' : 's'}`,
        type: action === 'trash' ? 'delete' : action === 'archive' ? 'archive' : 'success',
        onUndo: () => get().undoByReceipt(receipt.receiptId),
      });
    } catch (error) {
      const data = error?.response?.data;
      // Closed or changed meanwhile (another tab or chat): show that instead
      // of an error that repeats on every click.
      const closed = error?.response?.status === 404 ? 'expired'
        : data?.code === 'list-updated' ? 'moved'
          : /replaced/.test(data?.message || '') ? 'replaced' : /discarded/.test(data?.message || '') ? 'discarded' : null;
      if (closed === 'moved') return patch({ status: 'moved' });
      patch(closed ? { status: closed } : { status: 'open', error: data?.message || 'Could not apply — nothing was changed. Try again.' });
    }
  },

  // Grouping lists: a group's change ("move to a new folder" / "tag") on or
  // off for the group's notes that aren't left out.
  toggleGroupChange: (messageId, groupIndex, change) => {
    set({
      messages: get().messages.map((m) => {
        if (m.id !== messageId || m.proposal?.status !== 'open') return m;
        const group = m.proposal.groups[groupIndex];
        const keys = group.noteIds.map((noteId) => itemKey(noteId, change));
        const on = m.proposal.ticked.some((k) => keys.includes(k));
        const ticked = on
          ? m.proposal.ticked.filter((k) => !keys.includes(k))
          : [...m.proposal.ticked, ...group.noteIds.filter((id) => !m.proposal.excluded.includes(id)).map((id) => itemKey(id, change))];
        return { ...m, proposal: { ...m.proposal, ticked } };
      }),
    });
  },

  // A note in a group in or out (its group's ticked changes follow).
  toggleGroupNote: (messageId, groupIndex, noteId) => {
    set({
      messages: get().messages.map((m) => {
        if (m.id !== messageId || m.proposal?.status !== 'open') return m;
        const group = m.proposal.groups[groupIndex];
        const out = m.proposal.excluded.includes(noteId);
        const onChanges = group.changes.filter((change) => m.proposal.ticked.some((k) => group.noteIds.some((id) => k === itemKey(id, change))));
        const own = group.changes.map((change) => itemKey(noteId, change));
        return {
          ...m,
          proposal: {
            ...m.proposal,
            excluded: out ? m.proposal.excluded.filter((id) => id !== noteId) : [...m.proposal.excluded, noteId],
            ticked: out
              ? [...m.proposal.ticked, ...onChanges.map((change) => itemKey(noteId, change))]
              : m.proposal.ticked.filter((k) => !own.includes(k)),
          },
        };
      }),
    });
  },

  // Held changes → into the pending list ('add') or, once nothing else is
  // pending, shown as the pending list ('show'). The list then lives in this
  // message; older messages showing it point here.
  releaseHeld: async (messageId, how) => {
    const proposal = get().messages.find((m) => m.id === messageId)?.proposal;
    if (!proposal || proposal.status !== 'held' || proposal.releasing) return;
    const patch = (fields) => set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, proposal: { ...m.proposal, ...fields } } : m)),
    });
    patch({ releasing: how, error: null });
    try {
      const data = (await axiosInstance.post(`/agent/proposals/${proposal.proposalId}/${how}`)).data;
      if (data.empty) return patch({ releasing: null, status: 'discarded', error: data.message });
      set({
        messages: markMoved(get().messages, data.proposalId).map((m) => (m.id === messageId ? { ...m, proposal: withReviewState(data) } : m)),
        scrollTarget: { messageId, at: Date.now() },
      });
    } catch (error) {
      const { status, data } = error?.response || {};
      // Gone, or already shown / discarded from another tab.
      const closed = status === 404 ? 'expired' : data?.status === 'discarded' ? 'discarded' : data?.status === 'open' ? 'moved' : null;
      if (closed === 'moved') return patch({ status: 'moved' });
      patch({ releasing: null, ...(closed && { status: closed }), error: data?.message || 'Could not do that. Try again.' });
    }
  },

  // Close a pending list or held changes without applying them.
  discardReviewList: async (messageId) => {
    const proposal = get().messages.find((m) => m.id === messageId)?.proposal;
    if (!proposal || (proposal.status !== 'open' && proposal.status !== 'held')) return;
    const patch = (fields) => set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, proposal: { ...m.proposal, ...fields } } : m)),
    });
    try {
      await axiosInstance.post(`/agent/proposals/${proposal.proposalId}/discard`);
      patch({ status: 'discarded', error: null });
    } catch (error) {
      const data = error?.response?.data;
      if (error?.response?.status === 404) patch({ status: 'expired', error: null });
      else if (data?.status === 'replaced' || data?.status === 'discarded') patch({ status: data.status });
      else patch({ error: data?.message || 'Could not discard. Try again.' });
    }
  },

  // The toast's Undo: through the list's message when it's still on screen,
  // else straight by receipt (the user may have switched chats since).
  undoByReceipt: (receiptId) => {
    const message = get().messages.find((m) => m.proposal?.receipt?.receiptId === receiptId);
    return message ? get().undoReviewList(message.id) : get().undoFromActivity(receiptId);
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
      if (data.empty) return showError(data.message || 'Nothing to change — these notes are already like that.');
      set({
        messages: [...markMoved(get().messages, data.proposalId), makeMessage({
          role: 'assistant',
          text: data.extended
            ? `Added “${data.partLabel}” to your pending list — review it below.`
            : `Opened “${data.partLabel}” — ${data.candidates.length} notes to review below.`,
          citations: [],
          proposal: withReviewState(data),
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
}));
