import { useCallback, useEffect } from 'react';

// Scroll edges for the chat: content that scrolls under the header / composer meets a 1px divider
// that appears only while something is under it (as iOS does), and its text softens over a short
// eased fade — not a long linear one, which turned the cream cards into a muddy grey band where they
// faded into the dark card. Each edge's strength follows the distance to that end (0 → size), so it
// grows with the scroll instead of popping. Written straight to the DOM: scrolling renders nothing.
//
// Returns `update`, for the container's onScroll; it also runs when the container or a child
// resizes (re-observed when `childrenKey` changes).
const easedMask = (start, end) => {
  if (start < 0.5 && end < 0.5) return '';
  const top = `transparent 0, rgb(0 0 0 / 0.4) ${start * 0.3}px, rgb(0 0 0 / 0.85) ${start * 0.65}px, black ${start}px`;
  const bottom = `black calc(100% - ${end}px), rgb(0 0 0 / 0.85) calc(100% - ${end * 0.65}px), rgb(0 0 0 / 0.4) calc(100% - ${end * 0.3}px), transparent 100%`;
  return `linear-gradient(to bottom, ${top}, ${bottom})`;
};

export const useScrollEdges = (ref, size, topLineRef, bottomLineRef, childrenKey) => {
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const start = Math.min(Math.max(0, el.scrollTop), size);
    const end = Math.min(Math.max(0, maxScroll - el.scrollTop), size);
    const mask = easedMask(start, end);
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
    if (topLineRef.current) topLineRef.current.style.opacity = String(start / size);
    if (bottomLineRef.current) bottomLineRef.current.style.opacity = String(end / size);
  }, [ref, size, topLineRef, bottomLineRef]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    update();
    const rafId = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [ref, update, childrenKey]);

  return update;
};
