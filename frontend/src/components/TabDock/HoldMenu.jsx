import { useEffect, useLayoutEffect, useRef } from 'react';
import { MdClose } from 'react-icons/md';
import { motion, animate, AnimatePresence, usePresence } from 'framer-motion';
import { DOCK_METRICS } from './dockMetrics';
import { EASE_IN, EASE_OUT, PILL_FADE, PILL_SPRING } from './dockMotion';
import { useEdgeFade } from './useEdgeFade';
import FadeTitle from './FadeTitle';

// Long-press notes list (phone): lists every open note, since the dock's strip can't show them all
// on a narrow screen.

// A closing row collapses its height in place and fades, rather than being pulled out of the list:
// that shrank the scroll height by a whole row at once, so when scrolled to the bottom the browser
// clamped the scroll and every row jumped. The negative top margin cancels its gap as it collapses
// (a top margin, so the collapsed row adds nothing to the scroll height).
const LIST_ROW_GAP_PX = 4;
const LIST_ROW_H = 38;
const LIST_ROW_EXIT = {
  height: 0, marginTop: -LIST_ROW_GAP_PX, opacity: 0,
  transition: { default: PILL_SPRING, opacity: PILL_FADE },
};
// The list's height cap (38% of the screen, at most 220px), snapped to whole rows plus half a
// peeking row, so an overflowing list shows a deliberate peek under the bottom fade instead of
// cutting a row at a random point. Uses the nearest fit, so it may exceed the cap by half a row.
const LIST_MAX_PX = 220;
const LIST_MAX_VIEWPORT = 0.38;
const LIST_PAD_Y_PX = 8;  // the card's top/bottom padding, inside the scrolling list (see HoldList)
const LIST_FADE_PX = 12;  // edge fade at the card's edge
const listMaxHeight = (viewportHeight) => {
  const available = Math.min(LIST_MAX_PX, viewportHeight * LIST_MAX_VIEWPORT);
  const pitch = LIST_ROW_H + LIST_ROW_GAP_PX;
  const fullRows = Math.max(1, Math.round((available - LIST_ROW_H / 2) / pitch));
  return fullRows * pitch + LIST_ROW_H / 2 + LIST_PAD_Y_PX; // top padding + rows + half peek
};

// The scrolling list. It spans the glass card edge to edge vertically (its padding lives inside the
// scrolling content), so rows scroll right up to the card's edge and dissolve at it, like content
// under the edge of an iOS sheet. Opens already scrolled so the active note is in view.
const HoldList = ({ activeTabId, rowCount, children }) => {
  const listRef = useRef(null);
  const updateFade = useEdgeFade(listRef, 'y', LIST_FADE_PX, rowCount);

  // Before the first paint, so the shutter reveals the list already positioned: scroll as little
  // as needed to show the active note fully, clear of the edge fades.
  useLayoutEffect(() => {
    const el = listRef.current;
    const row = el.querySelector(`[data-hold-tab-id="${CSS.escape(activeTabId)}"]`);
    if (row) {
      const rowTop = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      const rowBottom = rowTop + row.offsetHeight;
      let target = el.scrollTop;
      if (rowBottom + LIST_FADE_PX > target + el.clientHeight) target = rowBottom + LIST_FADE_PX - el.clientHeight;
      if (rowTop - LIST_FADE_PX < target) target = rowTop - LIST_FADE_PX;
      el.scrollTop = Math.min(Math.max(0, target), el.scrollHeight - el.clientHeight);
    }
    updateFade();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only when the popup opens

  return (
    <div
      ref={listRef}
      onScroll={updateFade}
      className="overflow-y-auto flex flex-col [scrollbar-width:none] [&::-webkit-scrollbar]:hidden touch-pan-y overscroll-contain"
      // maxHeight is read at open (the popup mounts on each long press), not tracked across resizes.
      style={{ gap: LIST_ROW_GAP_PX, paddingBlock: LIST_PAD_Y_PX, maxHeight: listMaxHeight(window.innerHeight) }}
    >
      {children}
    </div>
  );
};

// Opening: a pill pops up out of the dock, then the list rolls up out of it like a shutter. Closing:
// one accelerating collapse back into the dock.
// The morphing element is a separate glass BACKGROUND layer whose real width/height/radius animate,
// with the list content clipped to that shape — text is never scaled, squashed or re-wrapped.
const HOLD_PILL_H = DOCK_METRICS.mobile.pill[0]; // pops up as a dock pill
const HOLD_SHEET_RADIUS = 24;
const HOLD_POP_FROM = 0.7;        // the pill pops up from 70% of its size
const HOLD_POP_SPRING     = { type: 'spring', visualDuration: 0.12, bounce: 0.35 }; // pill pops up
const HOLD_SHUTTER_SPRING = { type: 'spring', visualDuration: 0.18, bounce: 0.22 }; // rolls up, slight overshoot
const HOLD_ROLL_DOWN_S = 0.12;   // closing collapse; narrowing and fading overlap it (see the close effect)
const HOLD_SHUTTER_DELAY_S = 0.05;

const HoldSheet = ({ className, onClick, children }) => {
  const [isPresent, safeToRemove] = usePresence();
  const containerRef = useRef(null);
  const glassRef = useRef(null);
  const contentRef = useRef(null);

  // The glass shape is driven by two progress values: pop (the pill, at the list's full width,
  // popping from 70% to full size) and shutter (its top edge rolling up to the list's height; may
  // overshoot for the bounce). The content RIDES the shutter's top edge, so it slides up out of the
  // pill and bounces with it (a static list inside a bouncing glass read as a messy morph), and is
  // clipped to the glass so rows never show outside it. No transforms on the glass: a scaled glass
  // drew smaller than the clip.
  const shapeRef = useRef({ pop: 0, shutter: 0, full: { w: 0, h: 0 } });
  const renderShape = () => {
    const { pop, shutter, full } = shapeRef.current;
    const pillScale = HOLD_POP_FROM + (1 - HOLD_POP_FROM) * pop;
    const w = full.w * pillScale;
    const h = HOLD_PILL_H * pillScale + (full.h - HOLD_PILL_H) * shutter;
    const r = Math.min(h / 2, HOLD_PILL_H / 2 + (HOLD_SHEET_RADIUS - HOLD_PILL_H / 2) * Math.min(1, shutter));
    const glass = glassRef.current;
    const content = contentRef.current;
    // Stopping an animation fires one last update — also during unmount, after the elements are gone.
    // Throwing there (inside React's effect cleanup) tore down the whole dock.
    if (!glass || !content) return;
    glass.style.width = `${w}px`;
    glass.style.height = `${h}px`;
    glass.style.borderRadius = `${r}px`;
    const side = Math.max(0, (full.w - w) / 2);
    // Content top follows the glass top: shifted down by (full height − glass height); negative
    // during the overshoot, so the list rises past its rest position and settles back with the glass.
    const shift = full.h - h;
    content.style.transform = `translateY(${shift}px)`;
    // In the content's own (shifted) coordinates the glass spans 0 → h from its top.
    content.style.clipPath = `inset(0px ${side}px ${Math.max(0, full.h - h)}px ${side}px round ${r}px)`;
  };
  const setShape = (key) => (value) => {
    shapeRef.current[key] = value;
    renderShape();
  };

  // Open: the pill pops up out of the dock; just after, the list rolls up out of it. The content
  // fades in as the shutter starts, so the pill pops clean. Afterwards the glass tracks the list
  // (100%) so rows closing inside it still resize it.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const glass = glassRef.current;
    shapeRef.current = { pop: 0, shutter: 0, full: { w: container.offsetWidth, h: container.offsetHeight } };
    renderShape();
    const fadeIn = animate(glass, { opacity: [0, 1] }, { duration: 0.04, ease: EASE_OUT });
    const contentIn = animate(contentRef.current, { opacity: [0, 1] }, { duration: 0.06, ease: EASE_OUT, delay: HOLD_SHUTTER_DELAY_S });
    const pop = animate(0, 1, { ...HOLD_POP_SPRING, onUpdate: setShape('pop') });
    const shutter = animate(0, 1, {
      ...HOLD_SHUTTER_SPRING,
      delay: HOLD_SHUTTER_DELAY_S,
      onUpdate: setShape('shutter'),
      onComplete: () => {
        pop.stop();
        if (!glassRef.current || !contentRef.current) return;
        glass.style.width = '100%';
        glass.style.height = '100%';
        glass.style.borderRadius = `${HOLD_SHEET_RADIUS}px`;
        contentRef.current.style.clipPath = '';
        contentRef.current.style.transform = '';
      },
    });
    return () => { fadeIn.stop(); contentIn.stop(); pop.stop(); shutter.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close, as ONE accelerating collapse: the shutter rolls down (ease-in, so it never decelerates),
  // the width starts narrowing halfway through the roll, and the glass fades over the last part of
  // the same motion. Easing the roll out, then narrowing and fading, left a full-width opaque pill
  // standing for ~40–50ms: a visible intermediate state.
  useEffect(() => {
    if (isPresent) return;
    const container = containerRef.current;
    shapeRef.current = { pop: 1, shutter: 1, full: { w: container.offsetWidth, h: container.offsetHeight } };
    const rollDown = animate(1, 0, { duration: HOLD_ROLL_DOWN_S, ease: EASE_IN, onUpdate: setShape('shutter') });
    const fade = animate(contentRef.current, { opacity: 0 }, { duration: 0.06, ease: EASE_IN, delay: HOLD_ROLL_DOWN_S * 0.4 });
    const popAway = animate(1, 0, { duration: HOLD_ROLL_DOWN_S * 0.6, ease: EASE_IN, delay: HOLD_ROLL_DOWN_S * 0.5, onUpdate: setShape('pop') });
    const vanish = animate(glassRef.current, { opacity: 0 }, { duration: HOLD_ROLL_DOWN_S * 0.5, ease: EASE_IN, delay: HOLD_ROLL_DOWN_S * 0.6 });
    vanish.then(() => safeToRemove?.());
    return () => { fade.stop(); rollDown.stop(); popAway.stop(); vanish.stop(); };
  }, [isPresent, safeToRemove]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} className={`relative ${className}`} onClick={onClick}>
      {/* The morphing glass: anchored bottom-centre, so it grows up out of the dock */}
      <div
        ref={glassRef}
        className="dock-glass absolute bottom-0 inset-x-0 mx-auto border border-white/10 shadow-2xl"
        style={{ height: HOLD_PILL_H, borderRadius: HOLD_PILL_H / 2, opacity: 0 }}
      />
      {/* Horizontal padding only; the vertical padding is inside the scrolling list (see HoldList) */}
      <div ref={contentRef} className="relative px-2" style={{ opacity: 0 }}>{children}</div>
    </div>
  );
};

// Must be the direct child of an AnimatePresence (its sheet waits for the close animation).
// Rows are deliberately NOT variant children of the sheet: Framer activates the exit of every variant
// child when the parent exits, which ran each row's removal collapse as the sheet closed.
const HoldMenu = ({ openTabs, activeTabId, onSelect, onClose }) => (
  <HoldSheet
    className="z-50 pointer-events-auto shrink-0 flex flex-col w-[min(200px,calc(100vw-2.5rem))] text-stone-100 select-none no-card-click mb-2"
    onClick={(e) => e.stopPropagation()}
  >
    <HoldList activeTabId={activeTabId} rowCount={openTabs.length}>
      <AnimatePresence>
        {openTabs.map((tab) => {
          const isActive = activeTabId === tab._id;
          return (
            <motion.div
              key={tab._id}
              data-hold-tab-id={tab._id}
              exit={LIST_ROW_EXIT}
              onClick={() => onSelect(tab._id)}
              style={{ height: LIST_ROW_H }}
              className={`
                shrink-0 flex items-center justify-between pl-3.5 pr-2 overflow-hidden rounded-full cursor-pointer transition-colors duration-150 select-none
                ${isActive
                  ? 'bg-[#f4eadc] text-[#222] shadow-sm font-semibold'
                  : 'bg-white/5 hover:bg-white/10 text-stone-200 font-medium'
                }
              `}
            >
              {/* Long titles fade out at their end, like the dock's pills */}
              <FadeTitle className="flex-1 min-w-0 text-xs tracking-wide">
                {tab.title || 'Untitled Note'}
              </FadeTitle>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab._id);
                }}
                className={`
                  ml-1.5 p-1.5 rounded-full shrink-0 flex items-center justify-center transition-colors duration-150
                  ${isActive
                    ? 'text-stone-400 hover:text-red-500 active:text-red-500 active:bg-red-500/10'
                    : 'text-stone-500 hover:text-red-400 active:text-red-400 active:bg-red-400/15'
                  }
                `}
                title="Close tab"
              >
                <MdClose className="text-xs cursor-pointer shrink-0" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </HoldList>
  </HoldSheet>
);

export default HoldMenu;
