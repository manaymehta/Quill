import { create } from 'zustand';

// The toast stack above the dock: oldest first, newest (the front card) last. Each toast has its own
// timer; all timers freeze while the stack is open as a list and resume with the time they had left.
export const MAX_TOASTS = 5; // a newer toast past this drops the oldest

// id → { timeoutId, remaining, startedAt }. Outside the state: timers never need to re-render anything.
const timers = new Map();

const defaultLabel = (type, message) => {
  if (type === 'delete') return 'Deleted';
  if (type === 'archive') return 'Archived';
  if (type === 'warning' || type === 'error') return message;
  return 'Saved';
};

// Every toast stays 5 s by default (persistent ones have no timer)
const DEFAULT_DURATION = 5000;

export const useToastStore = create((set, get) => {
  const clearTimer = (id) => {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer.timeoutId);
    timers.delete(id);
  };

  // Starts (or resumes) a toast's countdown with `remaining` ms — or only records it while frozen
  const runTimer = (id, remaining) => {
    clearTimer(id);
    if (get().isListOpen) {
      timers.set(id, { timeoutId: null, remaining, startedAt: null });
      return;
    }
    timers.set(id, {
      timeoutId: setTimeout(() => get().dismissToast(id), remaining),
      remaining,
      startedAt: Date.now(),
    });
  };

  return {
    toasts: [], // { id, rev, label, message, type: 'success' | 'delete' | 'error' | 'warning' | 'archive', onUndo?, onTap?, duration, persistent }
    isListOpen: false,

    // showToast(message, type) or showToast({ label, message, type, onUndo, onTap, duration, persistent }).
    // persistent: no timer — stays until dismissed. onTap: runs on a tap of the toast's body, instead of
    // hiding it. Returns the toast's id (for updateToast / dismissToast).
    showToast: (params, maybeType = 'success') => {
      let label = '';
      let message = '';
      let type = 'success';
      let onUndo = null;
      let onTap = null;
      let duration = null;
      let persistent = false;

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
        message = params.message || '';
        type = params.type || maybeType || 'success';
        label = params.label || defaultLabel(type, message);
        onUndo = params.onUndo || null;
        onTap = params.onTap || null;
        duration = params.duration ?? null;
        persistent = Boolean(params.persistent);
      }

      if (duration == null) duration = DEFAULT_DURATION;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const toast = { id, rev: 0, label, message, type, onUndo, onTap, duration, persistent };

      const kept = get().toasts;
      const dropped = kept.length >= MAX_TOASTS ? kept.slice(0, kept.length - MAX_TOASTS + 1) : [];
      dropped.forEach((t) => clearTimer(t.id));
      set({ toasts: [...kept.slice(dropped.length), toast] });
      if (!persistent) runTimer(id, duration);
      return id;
    },

    // Changes a toast in place (e.g. "Agent working…" → "Agent replied"). A new `duration`, or
    // `persistent: false`, starts its countdown afresh; `persistent: true` stops it.
    updateToast: (id, patch) => {
      const current = get().toasts.find((t) => t.id === id);
      if (!current) return;
      const next = { ...current, ...patch, id, rev: current.rev + 1 };
      set({ toasts: get().toasts.map((t) => (t.id === id ? next : t)) });
      if (next.persistent) clearTimer(id);
      else if (patch.duration != null || (current.persistent && patch.persistent === false)) runTimer(id, next.duration);
    },

    dismissToast: (id) => {
      clearTimer(id);
      const toasts = get().toasts.filter((t) => t.id !== id);
      if (toasts.length === get().toasts.length) return;
      set({ toasts });
      // The list needs two toasts: with one left it folds back into the single toast
      if (get().isListOpen && toasts.length <= 1) get().setListOpen(false);
    },

    // Hides the front toast (or the one with `id`)
    hideToast: (id) => {
      const { toasts } = get();
      const target = id ?? toasts[toasts.length - 1]?.id;
      if (target) get().dismissToast(target);
    },

    // Opening freezes every timer where it stands; closing resumes each with the time it had left
    setListOpen: (open) => {
      if (open === get().isListOpen) return;
      if (open && get().toasts.length < 2) return;
      if (open) {
        for (const timer of timers.values()) {
          if (timer.timeoutId === null) continue;
          clearTimeout(timer.timeoutId);
          timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
          timer.timeoutId = null;
          timer.startedAt = null;
        }
        set({ isListOpen: true });
        return;
      }
      set({ isListOpen: false });
      // A snapshot: runTimer re-inserts each entry, which a live Map iteration would visit again
      for (const [id, timer] of [...timers]) runTimer(id, timer.remaining);
    },
  };
});
