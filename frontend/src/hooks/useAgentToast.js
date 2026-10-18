import { useEffect } from 'react';
import { useAgentStore } from '../store/useAgentStore';
import { useSearchStore } from '../store/useSearchStore';
import { useTabsStore } from '../store/useTabsStore';
import { useToastStore } from '../store/useToastStore';

// The agent's own toast, one persistent card in the toast stack while the chat isn't on screen:
//   "Agent working…"   — a turn is running
//   "Agent awaits you" — something waits for the user: a review list not applied (or a held one),
//                        an edit waiting for Apply / Skip, split choices with no part opened
//   "Agent replied"    — an answer arrived while away, not seen yet
// Tapping it opens the chat. Only the open (last-used) chat, and only things from this visit.
// Gone by itself when nothing is left; removed from the stack some other way (pushed out past
// the stack's limit), it stays away until its message changes.
const WORKING = 'Agent working…';
const AWAITS  = 'Agent awaits you';
const REPLIED = 'Agent replied';

const WAITING_EDIT = ['pending', 'conflict'];
const WAITING_LIST = ['open', 'held'];

const awaitsUser = (messages) => messages.some((m) => {
  if (!m.fresh) return false;
  if (WAITING_LIST.includes(m.proposal?.status)) return true;
  if (m.pendingEdits?.some((e) => WAITING_EDIT.includes(e.status))) return true;
  const choices = m.splitChoices;
  if (choices && !choices.expired) {
    const opened = messages.some((other) => other.proposal?.openedFrom?.some((from) => from.startsWith(`part:${choices.selectionId}:`)));
    if (!opened) return true;
  }
  return false;
});

const openChat = () => {
  useTabsStore.getState().setActiveTab('home'); // the chat shows in place of the page, under the editor
  useSearchStore.getState().setSearchMode('agent');
};

export const useAgentToast = () => {
  useEffect(() => {
    let toastId = null;
    let shownLabel = null;
    let hiddenLabel = null;  // removed by something else while it said this
    let unseenReply = false;
    let wasBusy = useAgentStore.getState().isBusy;
    let isSyncing = false; // showing / updating the toast notifies the toast store, which calls sync again

    const sync = () => {
      if (isSyncing) return;
      isSyncing = true;
      try {
        syncToast();
      } finally {
        isSyncing = false;
      }
    };

    const syncToast = () => {
      const { isBusy, messages } = useAgentStore.getState();
      const inAgentMode = useSearchStore.getState().searchMode === 'agent';

      if (wasBusy && !isBusy && !inAgentMode) unseenReply = true;
      wasBusy = isBusy;
      if (inAgentMode) unseenReply = false;

      const label = inAgentMode ? null
        : isBusy ? WORKING
          : awaitsUser(messages) ? AWAITS
            : unseenReply ? REPLIED
              : null;

      const toastStore = useToastStore.getState();
      const isShown = toastId && toastStore.toasts.some((t) => t.id === toastId);
      if (toastId && !isShown) {
        if (shownLabel) hiddenLabel = shownLabel;
        toastId = null;
      }
      if (!label) {
        if (toastId) toastStore.dismissToast(toastId);
        toastId = null;
        shownLabel = null;
        hiddenLabel = null;
        return;
      }
      if (label === hiddenLabel) return;
      hiddenLabel = null;
      if (label === shownLabel && toastId) return;
      const fields = { label, message: '', type: label === WORKING ? 'agent-working' : 'agent', persistent: true, onTap: openChat };
      if (toastId) toastStore.updateToast(toastId, fields);
      else toastId = toastStore.showToast(fields);
      shownLabel = label;
    };

    sync();
    const unsubscribers = [
      useAgentStore.subscribe(sync),
      useSearchStore.subscribe(sync),
      useToastStore.subscribe((state, prev) => { if (state.toasts !== prev.toasts) sync(); }),
    ];
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (toastId) useToastStore.getState().dismissToast(toastId);
    };
  }, []);
};
