import { createContext } from 'react';
import { EASE_IN, EASE_OUT } from '../TabDock/dockMotion';

// The agent's shared values, in the app's own language: the dock's motion rules (springs for
// movement, short tweens for fades), the editor's buttons and chips, and how changes are worded.

// ── Motion ──
export const RISE_SPRING   = { type: 'spring', visualDuration: 0.24, bounce: 0.25 }; // something arriving
export const HEIGHT_SPRING = { type: 'spring', visualDuration: 0.24, bounce: 0 };    // sizes never bounce
export const TICK_SPRING   = { type: 'spring', visualDuration: 0.18, bounce: 0.4 };
export const FADE_IN  = { duration: 0.12, ease: EASE_OUT };
export const FADE_OUT = { duration: 0.06, ease: EASE_IN };
// A text that changes in place (the toast's crossfade)
export const SWAP = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.08, ease: EASE_OUT } },
  exit: { opacity: 0, transition: FADE_OUT },
};

// ── Words ──
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A change in a few words (the server sends `title`; older lists don't)
export const changeTitle = (c) => {
  if (c.title) return c.title;
  if (c.action === 'move' && c.params?.newFolderName) return `Move to new folder “${c.params.newFolderName}”`;
  if (c.action === 'move') return c.params?.targetFolderId ? `Move to “${c.params?.targetFolderName || 'that folder'}”` : 'Move out of folders';
  if (c.action === 'tag') return `Tags ${[...(c.params?.add || []).map((t) => `+#${t}`), ...(c.params?.remove || []).map((t) => `−#${t}`)].join(' ')}`;
  if (c.action === 'archive') return c.params?.archived === false ? 'Unarchive' : 'Archive';
  return 'Send to trash (recoverable)';
};

// ── Buttons (the editor's) ──
// Main action: the editor's "Save Changes"
export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 px-3 md:px-4 py-2 rounded-lg text-xs font-medium text-white bg-[#dd5e57] hover:bg-[#fb6d65] hover:shadow-md transition-all whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#dd5e57] disabled:hover:shadow-none';
// Quiet action: the editor's "Discard" / toolbar buttons
export const btnQuiet = 'inline-flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-lg text-xs font-medium text-stone-500 hover:text-[#333] hover:bg-black/5 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
// Soft chip: the editor's "Folder" chip
export const btnChip = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#ebe0d3] hover:bg-[#e4d7c8] border border-[#e0d2bf] shadow-sm text-xs font-medium text-stone-600 transition-all whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
// On the dark panel: round outlined icon button (the editor's expand button, in dark)
// On the dark panel: a round icon button in the panel's own material — the message box's fill and
// border (white 5%, 8%), so it sits with the composer and your messages instead of on top of them
const ROUND_DARK_BASE = 'w-9 h-9 shrink-0 rounded-full border flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
export const btnRoundDark = `${ROUND_DARK_BASE} bg-white/[0.05] border-white/[0.08] text-stone-300 hover:bg-white/[0.09] hover:border-white/[0.14] hover:text-stone-100`;
// "On" (its panel is open): the same disc, a step brighter
export const btnRoundDarkOn = `${ROUND_DARK_BASE} bg-white/[0.12] border-white/20 text-stone-50`;

// The cited note being fetched (its card pulses, the others wait). A context, not a prop, so only the
// citation rows re-render when it changes — not every message.
export const OpeningNoteContext = createContext(null);
