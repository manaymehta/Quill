import { create } from 'zustand';

export const useToastStore = create((set, get) => ({
  toast: null, // { id, label, message, type: 'success' | 'delete' | 'error' | 'warning' | 'archive', onUndo?: () => void, duration?: number }
  timerId: null,

  showToast: (params, maybeType = 'success') => {
    const prevTimer = get().timerId;
    if (prevTimer) clearTimeout(prevTimer);

    let label = '';
    let message = '';
    let type = 'success';
    let onUndo = null;
    let duration = null;

    if (typeof params === 'string') {
      message = params;
      type = maybeType || 'success';
      if (type === 'delete') label = 'Deleted';
      else if (type === 'archive') label = 'Archived';
      else if (type === 'warning' || type === 'error') label = message;
      else if (/updated/i.test(message)) label = 'Updated';
      else if (/restore/i.test(message)) label = 'Restored';
      else if (/unpin/i.test(message)) label = 'Unpinned';
      else if (/pin/i.test(message)) label = 'Pinned';
      else label = 'Saved';
    } else if (params && typeof params === 'object') {
      label = params.label || '';
      message = params.message || '';
      type = params.type || maybeType || 'success';
      onUndo = params.onUndo || null;
      duration = params.duration ?? null;
      if (!label) {
        if (type === 'delete') label = 'Deleted';
        else if (type === 'archive') label = 'Archived';
        else if (type === 'warning' || type === 'error') label = message;
        else label = 'Saved';
      }
    }

    // Default duration: 5000ms for undoable actions, 3500ms for errors/warnings, 2000ms for quick confirmations
    if (duration == null) {
      duration = onUndo ? 5000 : (type === 'error' || type === 'warning' ? 3500 : 2000);
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newTimer = setTimeout(() => {
      get().hideToast();
    }, duration);

    set({
      toast: { id, label, message, type, onUndo, duration },
      timerId: newTimer,
    });
  },

  hideToast: () => {
    const prevTimer = get().timerId;
    if (prevTimer) clearTimeout(prevTimer);

    set({
      toast: null,
      timerId: null,
    });
  },
}));
