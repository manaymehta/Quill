import { create } from 'zustand';

export const useToastStore = create((set, get) => ({
  toast: null, // { id, message, type: 'success' | 'delete' | 'error' | 'warning', onUndo?: () => void, duration?: number }
  timerId: null,

  showToast: (params, maybeType = 'success') => {
    const prevTimer = get().timerId;
    if (prevTimer) clearTimeout(prevTimer);

    let message = '';
    let type = 'success';
    let onUndo = null;
    let duration = null;

    if (typeof params === 'string') {
      message = params;
      type = maybeType || 'success';
    } else if (params && typeof params === 'object') {
      message = params.message || '';
      type = params.type || 'success';
      onUndo = params.onUndo || null;
      duration = params.duration ?? null;
    }

    // Default duration: 5000ms for undoable actions, 2000ms for quick confirmations (3500ms for errors)
    if (duration == null) {
      duration = onUndo ? 5000 : (type === 'error' ? 3500 : 2000);
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newTimer = setTimeout(() => {
      get().hideToast();
    }, duration);

    set({
      toast: { id, message, type, onUndo, duration },
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
