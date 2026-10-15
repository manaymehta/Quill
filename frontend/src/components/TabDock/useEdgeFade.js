import { useCallback, useEffect } from 'react';

// Edge fades for a scroll container (axis 'x' or 'y'). Each fade's length scales with the distance
// to that end (0 → size), so they grow and shrink with the scroll instead of popping on/off at a
// threshold. Written straight to the element's style, so scrolling triggers no React render.
//
// Returns `update`, for the container's onScroll and anything else that changes the scroll range.
// It also runs on its own when the container or any direct child resizes: content can grow or
// shrink without a scroll event (items opening or collapsing). The children are re-observed when
// `childrenKey` changes (e.g. the item count).
export const useEdgeFade = (ref, axis, size, childrenKey) => {
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const [scroll, scrollSize, clientSize, direction] = axis === 'x'
      ? [el.scrollLeft, el.scrollWidth, el.clientWidth, 'to right']
      : [el.scrollTop, el.scrollHeight, el.clientHeight, 'to bottom'];
    const maxScroll = Math.max(0, scrollSize - clientSize);
    const start = Math.min(Math.max(0, scroll), size);
    const end = Math.min(Math.max(0, maxScroll - scroll), size);
    const mask = start < 0.5 && end < 0.5
      ? ''
      : `linear-gradient(${direction}, transparent 0, black ${start}px, black calc(100% - ${end}px), transparent 100%)`;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  }, [ref, axis, size]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
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
