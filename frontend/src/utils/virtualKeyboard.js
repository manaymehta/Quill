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

// The keyboard's covered height (px), 0 while closed. Used by surfaces that size themselves from
// the keyboard (the agent chat), including browsers where env(keyboard-inset-height) is 0.
export const useKeyboardInset = () => {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const scale = vv.scale || 1;
        const height = Math.round(window.innerHeight / scale - vv.height);
        setInset(height > 100 ? height : 0);
      });
    };
    vv.addEventListener('resize', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return inset;
};

// The keyboard's top edge in the window (px), or null while it's closed or not reported
export const useKeyboardTop = () => {
  const [top, setTop] = useState(null);
  useEffect(() => {
    const vk = keyboard();
    if (vk) {
      const update = () => setTop(vk.boundingRect.height > 0 ? vk.boundingRect.y : null);
      vk.addEventListener('geometrychange', update);
      update();
      return () => vk.removeEventListener('geometrychange', update);
    }

    // Fallback for HTTP (local Wi-Fi) and browsers without the VirtualKeyboard API (e.g. iOS Safari).
    // Measure the keyboard from the visual viewport: the height difference must be scaled (pinch
    // zoom shrinks visualViewport.height without a keyboard), and this is a resize signal only —
    // listening to visualViewport.scroll made the spacer change on every pan of the page.
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;

    let frame = 0;
    const updateFromViewport = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const scale = vv.scale || 1;
        const keyboardHeight = window.innerHeight / scale - vv.height;
        if (keyboardHeight > 100) {
          setTop(vv.offsetTop + vv.height);
        } else {
          setTop(null);
        }
      });
    };

    vv.addEventListener('resize', updateFromViewport);
    updateFromViewport();
    return () => {
      vv.removeEventListener('resize', updateFromViewport);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return top;
};
