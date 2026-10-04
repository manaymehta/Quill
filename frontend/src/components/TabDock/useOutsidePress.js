import { useEffect, useLayoutEffect, useRef } from 'react';

// While `active`, a press outside (anything `isInside(target)` says no to) calls `onPress` and is
// swallowed whole: it only dismisses, it never also lands on what's under it. That has to happen at
// the very start of the press, not on the click: an editor takes focus — and on a phone opens the
// keyboard — from the touch/press itself, before any click. So:
//   - touch: the touchstart is cancelled (non-passive listener), which stops the focus, the keyboard,
//     and the click the browser would make from it;
//   - mouse / pen: the pointerdown is cancelled, which cancels its mousedown (where an editor places
//     its cursor);
//   - and the click that may still follow is eaten.
// `ignore(event)` lets a press through untouched (e.g. a finger still down from a long press).
export const useOutsidePress = (active, { isInside, onPress, ignore }) => {
  const latest = useRef({ isInside, onPress, ignore });
  useLayoutEffect(() => {
    latest.current = { isInside, onPress, ignore };
  });

  useEffect(() => {
    if (!active) return;
    let swallowClick = false;
    let disposed = false;
    let timer = null;

    function onClick(e) {
      if (!swallowClick) return;
      e.preventDefault();
      e.stopPropagation();
      stopSwallowing();
    }
    function stopSwallowing() {
      swallowClick = false;
      clearTimeout(timer);
      if (disposed) document.removeEventListener('click', onClick, true);
    }
    const press = (e) => {
      const { isInside: inside, onPress: dismiss, ignore: skip } = latest.current;
      if (skip?.(e) || inside(e.target)) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      swallowClick = true;
      clearTimeout(timer);
      timer = setTimeout(stopSwallowing, 600); // no click followed (e.g. it became a drag)
      dismiss();
    };
    // Touch is handled at touchstart (cancelling a touch pointerdown doesn't stop the focus)
    const onPointerDown = (e) => { if (e.pointerType !== 'touch') press(e); };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('touchstart', press, { capture: true, passive: false });
    document.addEventListener('click', onClick, true);
    return () => {
      disposed = true;
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('touchstart', press, { capture: true });
      // Dismissing re-renders before the press's click arrives: keep the click listener until that
      // click has been eaten (or the timer gives up).
      if (!swallowClick) document.removeEventListener('click', onClick, true);
    };
  }, [active]);
};
