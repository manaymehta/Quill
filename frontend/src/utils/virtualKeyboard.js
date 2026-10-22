import { useEffect, useState } from 'react';

// The on-screen keyboard while a note or the agent chat is open (Chrome on Android; other browsers
// keep their own behaviour). In "overlay" mode the keyboard simply covers the page: nothing shrinks
// (the dock stays behind it) and the browser no longer drags the whole screen to reach the cursor,
// which it did even for just selecting text. Each surface makes room itself, from the keyboard's
// height: the agent chat ends above it (env(keyboard-inset-height) in AgentPanel), the note editor
// keeps the cursor above it inside its own scroll area (AddEditNotes, MarkdownEditor). Only on
// those two screens: elsewhere (sign-in forms) the browser still scrolls a field into view itself.
const keyboard = () => (typeof navigator !== 'undefined' ? navigator.virtualKeyboard : undefined);

export const setKeyboardOverlaysContent = (on) => {
  const vk = keyboard();
  if (vk) vk.overlaysContent = on;
};

// The keyboard's top edge in the window (px), or null while it's closed or not reported
export const useKeyboardTop = () => {
  const [top, setTop] = useState(null);
  useEffect(() => {
    const vk = keyboard();
    if (!vk) return undefined;
    const update = () => setTop(vk.boundingRect.height > 0 ? vk.boundingRect.y : null);
    vk.addEventListener('geometrychange', update);
    update();
    return () => vk.removeEventListener('geometrychange', update);
  }, []);
  return top;
};
