import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MdAdd, MdHome, MdClose, MdDeleteOutline, MdErrorOutline, MdOutlineArchive } from 'react-icons/md';
import { LuCheck, LuUndo2 } from 'react-icons/lu';
import { motion, animate, frame, AnimatePresence, PresenceContext, useIsPresent, usePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useTabsStore } from '../../store/useTabsStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useToastStore } from '../../store/useToastStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DOCK_METRICS, DOCK_MOBILE_QUERY } from './dockMetrics';

const getToastDisplayText = (toast) => {
  if (!toast) return '';
  if (toast.type === 'warning' || toast.type === 'error') {
    return toast.message || toast.label || 'Warning';
  }
  return toast.label || toast.message || 'Saved';
};

const renderToastIcon = (type) => {
  const iconClass = 'text-sm shrink-0';
  if (type === 'warning') return <MdErrorOutline className={`${iconClass} text-amber-400`} />;
  if (type === 'error')   return <MdErrorOutline className={`${iconClass} text-red-400`} />;
  if (type === 'archive') return <MdOutlineArchive className={`${iconClass} text-stone-300`} />;
  if (type === 'delete')  return <MdDeleteOutline className={`${iconClass} text-red-400`} />;
  return <LuCheck className={`${iconClass} text-stone-300`} />;
};

// Home ↔ editor compaction. All dock sizes are rounded to whole pixels, so how the spring *ends*
// decides whether the end looks clean. An overdamped spring crawls through its last pixels, so the
// final 1px steps arrive several frames apart (hold, hold, jump) — a visible tick at rest. A slight
// bounce carries the motion through its last pixels at speed; its overshoot stays under half a
// pixel on every dock size, so rounding hides it. Simulated on the real metrics (phone + desktop,
// both directions): longest hold between steps 4 → 2 frames (height: 1), visible end 250 → 150ms,
// no rounded size ever passes its target. Bounce ≥ 0.25 starts to overshoot visibly.
const DOCK_SPRING = { type: 'spring', visualDuration: 0.2, bounce: 0.2 };
// Pill border width (Tailwind `border`)
const PILL_BORDER_PX = 1;

// Tab strip: edge fade width, and the spring for programmatic scrolling (bringing the active pill
// into view, resetting to the start on Home)
const STRIP_FADE_PX = 16;
const STRIP_SCROLL_SPRING = { type: 'spring', visualDuration: 0.3, bounce: 0 };

// A dock dimension interpolated along the compaction spring ([home, editor] px), rounded to whole
// pixels. Unrounded (sub-pixel) sizes make every text glyph and icon re-snap to the pixel grid on
// its own each frame while box edges move smoothly, so contents visibly jitter inside the dock for
// the whole motion. Rounding trades that for small stair-steps in the spring's slow tail.
const useDockPx = (progress, [from, to]) =>
  useTransform(progress, (v) => Math.round(from + (to - from) * v));

// A dock dimension for an item vertically centred in the dock (button, pill, separator, undo).
// Rounding item and dock height independently makes their difference odd on some frames, so the
// item sits ½px off-centre until the other one steps too (16 item-frames per resize). Deriving the
// item from the rounded dock height minus twice a rounded inset keeps the difference even: always
// centred, and still exactly the original sizes at both ends.
const useCenteredDockPx = (progress, [heightFrom, heightTo], [from, to]) =>
  useTransform(progress, (v) => {
    const height = heightFrom + (heightTo - heightFrom) * v;
    const item = from + (to - from) * v;
    return Math.round(height) - 2 * Math.round((height - item) / 2);
  });

// Toast motion, tuned iOS-style: shape/scale use springs specified by perceived duration +
// bounce (like SwiftUI's .spring(duration:bounce:)); opacity never rides a spring (a spring's
// long settling tail reads as a lazy fade), it uses short tweens instead.
const EASE_OUT = [0.16, 1, 0.3, 1];
const EASE_IN  = [0.4, 0, 1, 1];

// Capsule appear/dismiss: pops up out of the dock with a visible overshoot (bounce ~0.4; measured:
// bounce 0.28 gave only 1.5% overshoot, which reads as no bounce, while 0.45 gave ~6%),
// opacity done in a blink so the pop is carried by scale, not a fade. Leaves fast.
const TOAST_SHELL_HIDDEN = { opacity: 0, scale: 0.5, y: 10 };
const TOAST_SHELL_SHOWN = {
  opacity: 1, scale: 1, y: 0,
  transition: {
    default: { type: 'spring', visualDuration: 0.22, bounce: 0.4 },
    opacity: { duration: 0.08, ease: EASE_OUT },
  },
};
const TOAST_SHELL_EXIT = {
  opacity: 0, scale: 0.6, y: 8,
  transition: { duration: 0.1, ease: EASE_IN },
};

// Message swap: the text swaps near-instantly at its natural size (quick simultaneous crossfade,
// so no blink), and the capsule visibly snaps to the new width. Growing, the capsule's edges
// reveal the new text; shrinking, they close in as the old text fades — the eye follows the
// shape changing, so it reads as one capsule resizing rather than a new toast replacing it.
const TOAST_WIDTH_SPRING = { type: 'spring', visualDuration: 0.16, bounce: 0.3 };
const TOAST_CONTENT_HIDDEN = { opacity: 0 };
const TOAST_CONTENT_SHOWN = { opacity: 1, transition: { duration: 0.08, ease: EASE_OUT } };
const TOAST_CONTENT_EXIT = { opacity: 0, transition: { duration: 0.06, ease: EASE_IN } };

// One message inside the toast capsule, centred at its natural size. Reports that size so the
// capsule can spring to fit it: synchronously on mount (so the capsule starts moving this frame),
// then via ResizeObserver for later changes (e.g. the dock compacting changes padding/undo size).
const ToastContent = ({ onResize, style, ...props }) => {
  // An exiting message stays mounted during the crossfade; only the present one sizes the capsule.
  const isPresent = useIsPresent();
  const isPresentRef = useRef(isPresent);
  useLayoutEffect(() => {
    isPresentRef.current = isPresent;
  }, [isPresent]);

  const nodeRef = useRef(null);
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const measure = () => {
      if (isPresentRef.current) onResize(node);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onResize]);

  return <motion.div ref={nodeRef} style={{ ...style, x: '-50%' }} {...props} />;
};

// Tab pills and the separator + strip group enter/leave by springing their width between 0 and
// their content's natural width (see SpringWidth). The negative margin cancels the element's flex
// gap as it collapses, so neighbours close up exactly.
const PILL_GAP_PX     = 4; // between pills in the strip
const DOCK_ROW_GAP_PX = 4; // between items in the dock row
// No bounce: a bouncy width overshoots and comes back (0.12 → ~0.3%, ≈0.35px on a 115px pill), and
// since the dock is centred its edges and contents move out and back — with glyphs snapping to
// whole device pixels that shows as a small horizontal twitch. Widths land flat.
const PILL_SPRING = { type: 'spring', visualDuration: 0.22, bounce: 0 };
const PILL_FADE   = { duration: 0.12, ease: EASE_OUT };

// Long-press notes list (phone): a closing row collapses its height in place and fades. The
// negative top margin cancels its gap as it collapses (a top margin pulls it onto the row above, so
// the collapsed row adds nothing to the list's scroll height — the same trap as the dock pills).
const LIST_ROW_GAP_PX = 4;
const LIST_ROW_EXIT = {
  height: 0, marginTop: -LIST_ROW_GAP_PX, opacity: 0,
  transition: { default: PILL_SPRING, opacity: PILL_FADE },
};

// Opens from width 0 to its content's natural width when entering, and closes back to 0 when
// leaving (AnimatePresence waits for it). Settled, it is plain `width: auto`.
//
// Driven by a fixed 0→1 open-progress spring, with width = progress × the content's *live* natural
// width. The dock often resizes at the same moment (compacting as a note opens, which shrinks the
// pill), and approaches that instead chase the width lose out: Framer's width: 'auto' measures the
// target once (stale → end snap), and re-targeting a spring every frame restarts it each frame
// (measured: a crawl at ~5px/frame, twice as slow). Tracking content through a ResizeObserver while
// settled also lags 1–2 frames, which clipped the content; hence real `auto` once open.
// animateEnter={false}: appear already open (no grow-in), but still close on exit.
const SpringWidth = ({ gap, animateEnter = true, className, style, transition, contentClassName, contentStyle, onSettled, children, ...rest }) => {
  const [isPresent, safeToRemove] = usePresence();
  const presenceSkipsEnter = useContext(PresenceContext)?.initial === false; // AnimatePresence initial={false}
  const skipEnter = !animateEnter || presenceSkipsEnter;
  const onSettledRef = useRef(onSettled);
  useLayoutEffect(() => {
    onSettledRef.current = onSettled;
  });

  const progress = useMotionValue(skipEnter ? 1 : 0);
  const width = useMotionValue(skipEnter ? 'auto' : 0);
  // The collapsing element cancels its flex gap with a negative LEFT margin (pulling it back onto its
  // neighbour), not a negative right margin: scrollable overflow counts border boxes, so with a right
  // margin a collapsed pill still left its gap in the strip's scrollWidth, and its final removal
  // shrank scrollWidth by the gap — the browser then clamped the scroll by 4px, a late jump.
  // Added on top of any fixed left margin passed in `style` (the tab group's row-gap offset).
  const baseMarginLeft = style?.marginLeft ?? 0;
  const marginLeft = useMotionValue(baseMarginLeft - (skipEnter ? 0 : gap));
  const settledRef = useRef(skipEnter);
  const naturalRef = useRef(0);
  const contentRef = useRef(null);

  // width/margin follow progress × live content width; once settled, hand sizing back to CSS.
  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    // Exact fractional width. offsetWidth rounds to whole pixels, so the animation aimed at e.g.
    // 115px and then switching to `auto` (115.3px) jumped at the very end.
    const naturalWidth = () => (naturalRef.current = node.getBoundingClientRect().width);
    let natural = naturalWidth();
    const update = () => {
      if (settledRef.current) {
        width.set('auto');
        marginLeft.set(baseMarginLeft);
        return;
      }
      const p = progress.get();
      width.set(p * natural);
      marginLeft.set(baseMarginLeft + (p - 1) * gap);
    };
    const measure = () => {
      natural = naturalWidth();
      update();
    };
    update();
    const unsubscribe = progress.on('change', update);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [progress, width, marginLeft, baseMarginLeft, gap]);

  // Enter: spring progress to 1, then settle to auto. Exit: spring to 0, then let AnimatePresence remove it.
  // Both finish once under half a pixel of width remains (the spring then lands exactly on its
  // target) instead of creeping through invisible fractions: on exit that creep kept shrinking the
  // strip's scroll width, and the browser clamped the scroll by one device pixel ~100ms after
  // everything had visibly stopped — a late jump of the whole strip.
  useLayoutEffect(() => {
    const restDelta = 0.5 / Math.max(naturalRef.current, 1); // progress units: half a pixel of width
    const settle = { ...PILL_SPRING, restDelta, restSpeed: restDelta * 30 };
    if (isPresent) {
      if (settledRef.current) return;
      const controls = animate(progress, 1, {
        ...settle,
        onComplete: () => {
          settledRef.current = true;
          width.set('auto');
          marginLeft.set(baseMarginLeft);
          onSettledRef.current?.();
        },
      });
      return () => controls.stop();
    }
    if (settledRef.current) {
      settledRef.current = false;
      progress.set(1); // re-derive a numeric width from auto before closing
    }
    const controls = animate(progress, 0, { ...settle, onComplete: () => safeToRemove?.() });
    return () => controls.stop();
  }, [isPresent, progress, width, marginLeft, baseMarginLeft, safeToRemove]);

  return (
    <motion.div
      initial={skipEnter ? false : { opacity: 0 }}
      animate={{ opacity: isPresent ? 1 : 0 }}
      transition={{ opacity: PILL_FADE, ...transition }}
      style={{ ...style, width, marginLeft }}
      className={`overflow-hidden ${className}`}
      {...rest}
    >
      <div ref={contentRef} className={`w-max ${contentClassName}`} style={contentStyle}>
        {children}
      </div>
    </motion.div>
  );
};

// Left separator (1px line + 2px margin each side, matching the right separator's w-[1px] mx-0.5).
// The tab group sits in the dock row with a permanent -DOCK_ROW_GAP_PX left margin, cancelling the
// extra row gap it adds; instead the separator slot carries that gap (gap + separator) and grows in
// with the first pill. Collapsed, its negative margin also cancels the gap inside the group — so the
// dock is exactly as wide as with no group at all until the separator and pill grow.
const SEPARATOR_PX = 5;
const SEPARATOR_SLOT_COLLAPSED = { width: 0, marginRight: -DOCK_ROW_GAP_PX, opacity: 0 };
const SEPARATOR_SLOT_EXPANDED = {
  width: DOCK_ROW_GAP_PX + SEPARATOR_PX, marginRight: 0, opacity: 1,
  transition: { default: PILL_SPRING, opacity: PILL_FADE },
};

// Active pill's in-flow close button: its slot (gap + button) springs open/closed on activation.
const CLOSE_BUTTON_PX = 14;
const CLOSE_SLOT_GAP_PX = 6;
const CLOSE_SLOT_OPEN   = { width: CLOSE_BUTTON_PX + CLOSE_SLOT_GAP_PX, opacity: 1, transition: { default: PILL_SPRING, opacity: PILL_FADE } };
const CLOSE_SLOT_CLOSED = { width: 0, opacity: 0, transition: { default: PILL_SPRING, opacity: PILL_FADE } };

// Tab strip scrolling feel
const MOMENTUM_SAMPLE_MS    = 80;    // drag window used to measure release velocity
const MOMENTUM_MIN_VELOCITY = 0.1;   // px/ms; slower releases just stop
const MOMENTUM_FRICTION     = 0.95;  // velocity retained per 16ms frame
const MOMENTUM_STOP         = 0.02;  // px/ms; below this the glide ends
const WHEEL_LINE_PX         = 16;    // Firefox line-mode wheel delta → px
const WHEEL_NOTCH_MIN       = 40;    // |delta| at or above this is a notched mouse wheel (eased)
const WHEEL_CHAIN_MS        = 250;   // wheel events closer than this chain onto one smooth scroll
const LONG_PRESS_RELEASE_GUARD_MS = 300; // after lifting from a long press, ignore a stray release click

// Shutter menu animation strictly mirroring NoteCard.jsx
const shutterMenuVariants = {
  closed: {
    opacity: 0,
    scaleY: 0.82,
    y: 8,
    transition: {
      duration: 0.12,
      ease: [0.4, 0, 1, 1],
    },
  },
  open: {
    opacity: 1,
    scaleY: 1,
    y: 0,
    transition: {
      duration: 0.16,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

const shutterItemVariants = {
  closed: {
    opacity: 0,
    y: 4,
    transition: {
      duration: 0.1,
      ease: [0.4, 0, 1, 1],
    },
  },
  open: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.15,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

const TabDock = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const openTabs       = useTabsStore((s) => s.openTabs);
  const activeTabId    = useTabsStore((s) => s.activeTabId);
  const setActiveTab   = useTabsStore((s) => s.setActiveTab);
  const closeTab       = useTabsStore((s) => s.closeTab);
  const createDraftTab = useTabsStore((s) => s.createDraftTab);
  const activeFolderId = useFoldersStore((s) => s.activeFolderId);

  const toast     = useToastStore((s) => s.toast);
  const hideToast = useToastStore((s) => s.hideToast);
  const [undoneToastId, setUndoneToastId] = useState(null);
  const isUndone = Boolean(toast?.id && undoneToastId === toast.id);

  const handleUndo = async () => {
    if (isUndone || !toast?.onUndo) return;
    const currentToastId = toast.id;
    if (currentToastId) setUndoneToastId(currentToastId);
    try {
      await Promise.resolve(toast.onUndo());
    } catch (err) {
      console.error('Toast undo error:', err);
    } finally {
      const s = useToastStore.getState();
      if (!s.toast || s.toast.id === currentToastId) hideToast();
    }
  };

  const isEditorActive = activeTabId !== 'home';

  const isMobile = useMediaQuery(DOCK_MOBILE_QUERY);
  const metrics  = isMobile ? DOCK_METRICS.mobile : DOCK_METRICS.desktop;

  // Single-spring master progress (0 = home/expanded, 1 = editor/compact).
  // All dimensions derive from this one spring to prevent multi-spring phase lag/twitch.
  const progressTarget = useMotionValue(isEditorActive ? 1 : 0);
  const progress       = useSpring(progressTarget, DOCK_SPRING);

  useEffect(() => {
    progressTarget.set(isEditorActive ? 1 : 0);
  }, [isEditorActive, progressTarget]);

  const dockHeight    = useDockPx(progress, metrics.height);
  const dockRadius    = useTransform(progress, [0, 1], metrics.radius);
  const circleSize    = useCenteredDockPx(progress, metrics.height, metrics.circle);
  const sepHeight     = useCenteredDockPx(progress, metrics.height, metrics.separator);
  const pillHeight    = useCenteredDockPx(progress, metrics.height, metrics.pill);
  const pillPL        = useDockPx(progress, metrics.pillPaddingLeft);
  const pillPR        = useDockPx(progress, metrics.pillPaddingRight);
  const pillMaxW      = useDockPx(progress, metrics.pillMaxWidth);
  // Title budget inside a pill: the pill's max width minus its padding and 1px borders (the close
  // slot is extra, see the title span).
  const pillTextMaxW  = useTransform(() => pillMaxW.get() - pillPL.get() - pillPR.get() - 2 * PILL_BORDER_PX);
  const undoSize      = useCenteredDockPx(progress, metrics.height, metrics.undo);
  const toastGap      = useDockPx(progress, metrics.toastGap);
  // Toast text padding follows the compaction too (it used to switch classes instantly, a 1–2px jump)
  const toastPL       = useDockPx(progress, metrics.toastPaddingLeft);
  const toastPR       = useDockPx(progress, metrics.toastPaddingRight);
  const toastPRUndo   = useDockPx(progress, metrics.toastPaddingRightUndo);
  const paddingBottom = useDockPx(progress, metrics.paddingBottom);

  // Marks the dock as resizing so CSS can swap the glass for an opaque fill during the motion (see
  // .dock-root[data-dock-moving] in index.css). "Resizing" = until the largest travel has less than
  // half a pixel left, i.e. within settleEpsilon of either end, which is where the last rounded
  // pixel step lands. A fixed 0.001–0.999 window kept the glass swapped ~130ms into the spring's
  // invisible sub-pixel tail, so the blur returned after the dock had visibly stopped. Written
  // straight to the DOM, only on flips, so no React render per frame.
  const settleEpsilon = 0.5 / Math.max(
    ...Object.values(metrics).filter(Array.isArray).map(([from, to]) => Math.abs(to - from)),
  );
  const dockRootRef = useRef(null);
  useEffect(() => {
    let moving = false;
    return progress.on('change', (v) => {
      const next = v > settleEpsilon && v < 1 - settleEpsilon;
      if (next === moving) return;
      moving = next;
      dockRootRef.current?.toggleAttribute('data-dock-moving', next);
    });
  }, [progress, settleEpsilon]);

  // Toast capsule width: springs to the current message's measured width. The first message of a
  // fresh capsule jumps straight to its width (the capsule's pop-in is the entrance animation).
  const toastWidthTarget = useMotionValue(0);
  const toastWidth       = useSpring(toastWidthTarget, TOAST_WIDTH_SPRING);

  // Called by the present ToastContent whenever its natural size changes (mount, or while showing,
  // e.g. the dock compacting changes its padding and undo button size).
  // Springs only for a NEW message (the morph). The same message resizing — every frame while the
  // dock compacts — is followed instantly: re-aiming the spring each frame restarts it each frame,
  // so the capsule lagged behind its own content.
  // (offsetWidth, not getBoundingClientRect: the toast scales while popping in, which would skew it.)
  const lastToastNodeRef = useRef(null);
  const lastToastWidthRef = useRef(0);
  const handleToastContentResize = useCallback((node) => {
    const capsule = node.parentElement;
    const width = node.offsetWidth + (capsule.offsetWidth - capsule.clientWidth); // + capsule borders
    const isNewMessage = node !== lastToastNodeRef.current;
    // A ResizeObserver also fires once right after observing, repeating the mount measurement;
    // treating that as a resize would cut the morph short.
    if (!isNewMessage && width === lastToastWidthRef.current) return;
    lastToastNodeRef.current = node;
    lastToastWidthRef.current = width;
    if (toastWidth.get() === 0 || !isNewMessage) {
      toastWidthTarget.jump(width);
      toastWidth.jump(width);
    } else {
      toastWidthTarget.set(width);
    }
  }, [toastWidth, toastWidthTarget]);

  // While the dock resizes, the toast's padding / undo button change every frame. Going through the
  // ResizeObserver above, the capsule followed one frame late (content drawn at its new width, the
  // capsule a frame later): up to 5px of mismatch, clipping the content's edges. Instead, re-measure
  // in Framer's postRender step — right after this frame's padding styles are applied — and write the
  // capsule width directly, so both are drawn together. Skipped during a morph (the spring owns it).
  useEffect(() => {
    const syncToastWidth = () => {
      const node = lastToastNodeRef.current;
      if (!node?.isConnected || toastWidth.isAnimating()) return;
      const capsule = node.parentElement;
      const width = node.offsetWidth + (capsule.offsetWidth - capsule.clientWidth);
      if (width === lastToastWidthRef.current) return;
      lastToastWidthRef.current = width;
      toastWidthTarget.jump(width);
      toastWidth.jump(width);
      capsule.style.width = `${width}px`;
    };
    return progress.on('change', () => frame.postRender(syncToastWidth));
  }, [progress, toastWidth, toastWidthTarget]);

  const resetToastWidth = useCallback(() => {
    toastWidthTarget.jump(0);
    toastWidth.jump(0);
  }, [toastWidth, toastWidthTarget]);

  const tabsContainerRef = useRef(null);

  // Programmatic strip scrolling (bringing the active pill into view, resetting on Home). Driven by
  // our own spring instead of the browser's smooth scroll, and the target is re-read from the live
  // layout every frame: pills resize while it runs (the new active pill's close slot opens, the old
  // one's closes, pills grow/collapse, the dock compacts), and a target fixed at the start went
  // stale mid-scroll — the pill moved unevenly and could land off-target.
  const scrollAnimRef = useRef(null);
  const stopStripScroll = useCallback(() => {
    scrollAnimRef.current?.stop();
    scrollAnimRef.current = null;
  }, []);
  const animateStripScroll = useCallback((getTarget) => {
    const el = tabsContainerRef.current;
    if (!el) return;
    stopStripScroll();
    const from = el.scrollLeft;
    const clampedTarget = () => Math.min(Math.max(0, el.scrollWidth - el.clientWidth), Math.max(0, getTarget(el, from)));
    const direction = Math.sign(clampedTarget() - from);
    let last = from;
    scrollAnimRef.current = animate(0, 1, {
      ...STRIP_SCROLL_SPRING,
      // Tight end tolerance: the default (1% of 0→1) stopped up to ~1.5px short, then jumped.
      restDelta: 0.001,
      restSpeed: 0.01,
      onUpdate: (p) => {
        let next = from + (clampedTarget() - from) * p;
        // Monotonic: the live target wobbles slightly as close slots open/close, and scroll
        // positions snap to whole device pixels, so without this it stepped back and forth.
        if (direction > 0) next = Math.max(next, last);
        else if (direction < 0) next = Math.min(next, last);
        el.scrollLeft = last = next;
      },
      onComplete: () => { scrollAnimRef.current = null; },
    });
  }, [stopStripScroll]);
  useEffect(() => stopStripScroll, [stopStripScroll]);

  // Post-drag glide: decays velocity each frame until it stops or hits an edge.
  const momentumRafRef = useRef(null);
  const stopMomentum = useCallback(() => {
    if (momentumRafRef.current !== null) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
  }, []);
  const startMomentum = (initialVelocity) => {
    const el = tabsContainerRef.current;
    if (!el) return;
    stopMomentum();
    let velocity = initialVelocity;
    let lastTime = performance.now();
    const step = (now) => {
      const dt = now - lastTime;
      lastTime = now;
      const maxScroll = el.scrollWidth - el.clientWidth;
      const next = Math.max(0, Math.min(maxScroll, el.scrollLeft + velocity * dt));
      el.scrollLeft = next;
      velocity *= Math.pow(MOMENTUM_FRICTION, dt / 16);
      const atEdge = next <= 0 || next >= maxScroll;
      momentumRafRef.current = Math.abs(velocity) > MOMENTUM_STOP && !atEdge
        ? requestAnimationFrame(step)
        : null;
    };
    momentumRafRef.current = requestAnimationFrame(step);
  };
  useEffect(() => stopMomentum, [stopMomentum]);

  // Mobile touch-and-hold (long-press) detection.
  // Lifting the finger after a long press must not activate what's under it. That release click is
  // prevented at its source (preventDefault on touchend stops browsers generating the click) rather
  // than "swallowing the next click": some browsers (Android Chrome after a long press) send no
  // release click at all, so a swallow flag stayed set and ate the user's FIRST real tap in the list.
  const longPressTimerRef = useRef(null);
  const touchStartPosRef = useRef({ x: 0, y: 0 });
  const isHoldingAfterLongPressRef = useRef(false); // long press fired, finger still down
  const ignoreClicksUntilRef = useRef(0);           // safety net for a stray release click
  const [isHoldMenuOpen, setIsHoldMenuOpen] = useState(false);

  const handleTouchStart = (e) => {
    stopStripScroll(); // a finger on the strip takes over from any programmatic scroll
    if (!isMobile || openTabs.length <= 1) return;
    if (e.target.closest('button')) return;

    isHoldingAfterLongPressRef.current = false;

    const touch = e.touches[0];
    if (!touch) return;
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      isHoldingAfterLongPressRef.current = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(25);
        } catch {
          // Ignore unsupported vibrate error
        }
      }
      setIsHoldMenuOpen(true);
    }, 500);
  };

  const handleTouchMove = (e) => {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (dx > 20 || dy > 20) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (isHoldMenuOpen) {
        setIsHoldMenuOpen(false);
      }
    }
  };

  // Also used for touchcancel (e.g. the browser took over the gesture).
  const handleTouchEnd = (e) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (isHoldingAfterLongPressRef.current) {
      isHoldingAfterLongPressRef.current = false;
      if (e.cancelable) e.preventDefault(); // no synthetic release click
      ignoreClicksUntilRef.current = performance.now() + LONG_PRESS_RELEASE_GUARD_MS;
    }
  };

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  const showHoldMenu = isHoldMenuOpen && isMobile && openTabs.length > 1;

  // Single capture-phase listener at root: dismisses the list on an outside click
  useEffect(() => {
    if (!showHoldMenu) return;

    const handleOutsideClick = (e) => {
      // 1. Still holding after the long press, or a stray release click just after lifting: ignore
      //    it and keep the list open. (Android can fire contextmenu during a long hold, which would
      //    otherwise count as an outside click and close the list straight away.)
      if (isHoldingAfterLongPressRef.current || performance.now() < ignoreClicksUntilRef.current) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      // 2. If click is inside the popup sheet:
      if (e.target.closest?.('.no-card-click')) return;

      // 3. Otherwise it is an outside click:
      e.stopPropagation();
      e.preventDefault();
      setIsHoldMenuOpen(false); // Cleanly closes popup. Never reaches underlying cards.
    };

    const handleScroll = (e) => {
      if (e?.target?.closest?.('.no-card-click')) return;
      setIsHoldMenuOpen(false);
    };

    document.addEventListener('click', handleOutsideClick, true);
    document.addEventListener('contextmenu', handleOutsideClick, true);
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener('click', handleOutsideClick, true);
      document.removeEventListener('contextmenu', handleOutsideClick, true);
      document.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [showHoldMenu]);

  // Edge fades scale with the distance to each end (0 → STRIP_FADE_PX), so they grow and shrink
  // with the scroll instead of switching on/off in one frame at a threshold (visible as a pop,
  // e.g. the right fade vanishing just as a scroll lands). Written straight to the element's style,
  // so scrolling triggers no React render.
  const checkScrollFade = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const left = Math.min(Math.max(0, el.scrollLeft), STRIP_FADE_PX);
    const right = Math.min(Math.max(0, maxScroll - el.scrollLeft), STRIP_FADE_PX);
    const mask = left < 0.5 && right < 0.5
      ? ''
      : `linear-gradient(to right, transparent 0, black ${left}px, black calc(100% - ${right}px), transparent 100%)`;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  }, []);


  const queryParams   = new URLSearchParams(location.search);
  const isFoldersView = queryParams.get('view') === 'folders';
  const isHomeActive  = location.pathname === '/dashboard' && !isFoldersView && !isEditorActive;

  // While the long-press list is open, the document-level capture listener above intercepts every
  // click outside it (closing the list), so click handlers here never run in that state. Only
  // handleTabClick needs its own check: it's also reached from the keyboard (Enter/Space on a pill),
  // which doesn't go through that click listener.
  const handleHomeClick = () => {
    setActiveTab('home');
    navigate('/dashboard');
  };
  const handleNewNote   = () => createDraftTab(activeFolderId);
  const handleTabClick  = (tabId, e) => {
    if (showHoldMenu) {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      setIsHoldMenuOpen(false);
      return;
    }
    setActiveTab(tabId);
  };
  const handleCloseTab  = (tabId) => closeTab(tabId);

  // Roving tabindex: only one pill is in the Tab order (the active one, else the first);
  // arrows move between pills, Enter/Space opens, Delete closes.
  const focusablePillId = openTabs.some((t) => t._id === activeTabId) ? activeTabId : openTabs[0]?._id;

  const handlePillKeyDown = (tabId, e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleTabClick(tabId, e);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      handleCloseTab(tabId);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      // Each pill sits in its own animated wrapper, so step across the wrappers
      const wrapper = e.currentTarget.closest('[data-pill-wrapper]');
      const siblingWrapper = e.key === 'ArrowRight'
        ? wrapper.nextElementSibling
        : wrapper.previousElementSibling;
      siblingWrapper?.querySelector('[role="tab"]')?.focus();
    }
  };

  const handleSelectTabFromMenu = (tabId) => {
    setIsHoldMenuOpen(false);
    setActiveTab(tabId);
  };

  // Scroll the strip so a pill is fully in view, clear of the edge fades, moving as little as
  // possible. Evaluated every frame from the live layout, so it also follows a pill that is still
  // growing in (the strip's max scroll grows with it) or resizing.
  const ensurePillVisible = useCallback((tabId) => {
    const pill = tabsContainerRef.current?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`);
    if (!pill) return;
    animateStripScroll((strip, from) => {
      if (!pill.isConnected) return strip.scrollLeft;
      const latest   = pill.offsetLeft - STRIP_FADE_PX; // scroll at most this far: pill's start visible
      const earliest = pill.offsetLeft + pill.offsetWidth + STRIP_FADE_PX - strip.clientWidth; // …and its end
      if (earliest > latest) return latest; // pill wider than the view: show its start
      return Math.min(latest, Math.max(earliest, from));
    });
  }, [animateStripScroll]);

  // Home: reset scroll so the 1st pill docks flush against the left separator.
  // Editor: bring the active pill into view.
  useEffect(() => {
    if (!tabsContainerRef.current) return;
    stopMomentum();
    if (activeTabId === 'home') {
      animateStripScroll(() => 0);
      return;
    }
    ensurePillVisible(activeTabId);
  }, [activeTabId, openTabs.length, stopMomentum, animateStripScroll, ensurePillVisible]);

  // Keep the edge fades in step with the strip's size AND its content's size. Once the strip is at
  // its max width it stops resizing, while its content can still grow or shrink without a scroll
  // (a pill growing in, a close slot opening, a title being typed) — watching only the strip left
  // the fade stale, e.g. stuck at 2px for ~250ms and then popping to 16px when a pill settled.
  // Each pill wrapper is observed too; re-subscribed when the number of tabs changes (not on every
  // tab-list update — the list is recreated on each title keystroke, and resizes of existing
  // wrappers are already observed).
  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    checkScrollFade();
    const rafId = requestAnimationFrame(checkScrollFade);
    const ro = new ResizeObserver(checkScrollFade);
    ro.observe(el);
    for (const wrapper of el.children) ro.observe(wrapper);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [openTabs.length, activeTabId, checkScrollFade]);

  // Desktop mouse drag-to-scroll with release momentum. Capture-phase click listener
  // suppresses accidental tab activation when releasing a drag gesture (> 4px).
  const handleMouseDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const el = tabsContainerRef.current;
    if (!el) return;
    stopMomentum();
    stopStripScroll();
    const startX = e.pageX;
    const startScroll = el.scrollLeft;
    let dragged = false;
    let samples = [{ x: e.pageX, t: e.timeStamp }];

    const onMove = (me) => {
      const dx = me.pageX - startX;
      if (Math.abs(dx) > 4) dragged = true;
      el.scrollLeft = startScroll - dx;
      samples.push({ x: me.pageX, t: me.timeStamp });
      samples = samples.filter((s) => me.timeStamp - s.t <= MOMENTUM_SAMPLE_MS);
    };
    const onUp = (ue) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!dragged) return;

      // The release click (if any) dispatches in the same task as mouseup; the timeout
      // removes the listener afterwards so a drag ending outside the window can't swallow a later click.
      const killClick = (ce) => { ce.stopPropagation(); };
      window.addEventListener('click', killClick, true);
      setTimeout(() => window.removeEventListener('click', killClick, true), 0);

      // Pausing before release leaves no recent samples, so the strip stays put.
      const recent = samples.filter((s) => ue.timeStamp - s.t <= MOMENTUM_SAMPLE_MS);
      if (recent.length < 2) return;
      const first = recent[0];
      const last  = recent[recent.length - 1];
      const velocity = -(last.x - first.x) / Math.max(last.t - first.t, 1); // px per ms
      if (Math.abs(velocity) > MOMENTUM_MIN_VELOCITY) startMomentum(velocity);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Vertical mouse wheel scrolls the strip horizontally, eased for notched wheels.
  // Native non-passive listener: React's onWheel is passive, so it can't stop the page scrolling too.
  const hasTabs = openTabs.length > 0;
  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    let target = 0;
    let lastWheelAt = -Infinity;

    const onWheel = (e) => {
      // Horizontal-dominant gestures (trackpads, tilt wheels) already scroll natively.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return;
      e.preventDefault();
      stopMomentum();
      stopStripScroll();

      const delta = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
      // Rapid notches accumulate onto the in-flight smooth-scroll target instead of the
      // mid-animation position, so fast wheeling covers the full distance.
      const base = e.timeStamp - lastWheelAt < WHEEL_CHAIN_MS ? target : el.scrollLeft;
      lastWheelAt = e.timeStamp;
      target = Math.max(0, Math.min(maxScroll, base + delta));
      // Small deltas are trackpad-style continuous input: apply directly so it tracks the fingers.
      el.scrollTo({ left: target, behavior: Math.abs(delta) >= WHEEL_NOTCH_MIN ? 'smooth' : 'auto' });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasTabs, stopMomentum, stopStripScroll]);

  return (
    <motion.div
      ref={dockRootRef}
      style={{ paddingBottom }}
      className="dock-root fixed bottom-0 left-0 right-0 z-50 flex flex-col justify-end items-center pointer-events-none px-3 sm:px-4"
    >
      {/* Toast — one persistent "dynamic island" capsule. It pops in once; while visible, a new
          message morphs it (width springs to the new content, old/new content crossfade in place)
          instead of stacking a second bubble. Keyed by a stable key so it isn't remounted per message. */}
      <AnimatePresence onExitComplete={resetToastWidth}>
        {toast && (
          <motion.div
            key="dock-toast"
            initial={TOAST_SHELL_HIDDEN}
            animate={TOAST_SHELL_SHOWN}
            exit={TOAST_SHELL_EXIT}
            className="pointer-events-auto shrink-0 flex justify-center"
            style={{ marginBottom: toastGap, originY: 1 /* grows up out of the dock */ }}
          >
            <motion.div
              style={{ width: toastWidth, height: dockHeight, borderRadius: dockRadius }}
              onClick={toast.onUndo ? handleUndo : hideToast}
              className="dock-glass relative overflow-hidden select-none cursor-pointer border border-white/10 shadow-2xl text-stone-100 hover:bg-[#333336]"
            >
              <AnimatePresence initial={false}>
                <ToastContent
                  key={toast.id}
                  onResize={handleToastContentResize}
                  initial={TOAST_CONTENT_HIDDEN}
                  animate={TOAST_CONTENT_SHOWN}
                  exit={TOAST_CONTENT_EXIT}
                  style={{ paddingLeft: toastPL, paddingRight: toast.onUndo ? toastPRUndo : toastPR }}
                  className="absolute left-1/2 inset-y-0 w-max max-w-[min(90vw,400px)] flex items-center justify-between whitespace-nowrap"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-1">
                    {renderToastIcon(toast.type)}
                    <span className="truncate font-semibold tracking-wide text-stone-100 text-xs sm:text-sm">
                      {getToastDisplayText(toast)}
                    </span>
                  </div>
                  {toast.onUndo && (
                    <motion.button
                      style={{ width: undoSize, height: undoSize }}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleUndo(); }}
                      title="Undo"
                      className="shrink-0 rounded-full bg-white/20 hover:bg-white/30 active:scale-90 flex items-center justify-center text-white border border-white/25 shadow-sm cursor-pointer ml-2"
                    >
                      <LuUndo2 className="text-xs" />
                    </motion.button>
                  )}
                </ToastContent>
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Touch-and-Hold Expanding Notes Sheet */}
      <AnimatePresence>
        {showHoldMenu && (
          <motion.div
            key="hold-menu-sheet"
            variants={shutterMenuVariants}
            initial="closed"
            animate="open"
            exit="closed"
            style={{ transformOrigin: 'bottom' }}
            className="relative z-50 pointer-events-auto shrink-0 flex flex-col w-[min(200px,calc(100vw-2.5rem))] overflow-hidden dock-glass border border-white/10 shadow-2xl rounded-[24px] text-stone-100 select-none no-card-click mb-2 p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Notes List. A closing row collapses its own height in place (see LIST_ROW_EXIT) rather
                than being pulled out of the list (popLayout): pulling it out shrank the list's scroll
                height by a whole row at once, so when scrolled to the bottom the browser clamped the
                scroll and every row jumped ~42px in one frame before sliding back. */}
            <div
              className="overflow-y-auto flex flex-col max-h-[min(220px,38vh)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden touch-pan-y overscroll-contain"
              style={{ gap: LIST_ROW_GAP_PX }}
            >
              <AnimatePresence>
                {openTabs.map((tab) => {
                  const isActive = activeTabId === tab._id;
                  return (
                    <motion.div
                      key={tab._id}
                      variants={shutterItemVariants}
                      exit={LIST_ROW_EXIT}
                      onClick={() => handleSelectTabFromMenu(tab._id)}
                      className={`
                        shrink-0 flex items-center justify-between pl-3.5 pr-2 h-[38px] overflow-hidden rounded-full cursor-pointer transition-colors duration-150 select-none
                        ${isActive
                          ? 'bg-[#f4eadc] text-[#222] shadow-sm font-semibold'
                          : 'bg-white/5 hover:bg-white/10 text-stone-200 font-medium'
                        }
                      `}
                    >
                      <span className="truncate flex-1 min-w-0 text-xs tracking-wide">
                        {tab.title || 'Untitled Note'}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCloseTab(tab._id);
                        }}
                        className={`
                          ml-1.5 p-1 rounded-full shrink-0 flex items-center justify-center transition-colors
                          ${isActive
                            ? 'text-stone-500 hover:text-red-500 active:bg-stone-300/60'
                            : 'text-stone-400 hover:text-red-400 active:bg-white/20'
                          }
                        `}
                        title="Close tab"
                      >
                        <MdClose className="text-sm cursor-pointer shrink-0" />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dock */}
      <motion.div
        style={{ height: dockHeight, borderRadius: dockRadius }}
        className="dock-glass relative z-40 pointer-events-auto flex items-center justify-center overflow-hidden border border-white/10 shadow-2xl px-2.5 sm:px-2 max-w-[calc(100vw-1.5rem)] sm:max-w-none"
      >
          <div className="flex items-center justify-center h-full min-w-0 max-w-full" style={{ gap: DOCK_ROW_GAP_PX }}>

            {/* Home */}
            <motion.button
              style={{ width: circleSize, height: circleSize }}
              onClick={handleHomeClick}
              title="Home"
              className={`
                shrink-0 cursor-pointer flex items-center justify-center rounded-full transition-colors duration-200
                ${isHomeActive ? 'bg-[#f4eadc] text-[#333] shadow-md' : 'text-stone-300 hover:bg-white/10'}
              `}
            >
              <MdHome className="text-xl shrink-0" />
            </motion.button>

            {/* Left separator + pills — only when tabs exist.
                Opening the first tab: the group itself doesn't animate (it tracks its content), the
                separator and the pill each grow in with the pill spring — so the first pill opens
                exactly like any other pill. Animating the whole group instead chased a width that
                kept changing as the dock compacted at the same moment: slow, clipped, end twitch.
                Closing the last tab: the group collapses as a whole, still rendering the last pill
                (AnimatePresence freezes exiting children). */}
            <AnimatePresence initial={false}>
            {openTabs.length > 0 && (
              <SpringWidth
                key="tab-group"
                gap={0}
                animateEnter={false}
                style={{ marginLeft: -DOCK_ROW_GAP_PX }}
                className="h-full min-w-0 shrink sm:shrink-0"
                contentClassName="flex items-center h-full"
                contentStyle={{ gap: DOCK_ROW_GAP_PX }}
              >
                <motion.div
                  initial={SEPARATOR_SLOT_COLLAPSED}
                  animate={SEPARATOR_SLOT_EXPANDED}
                  className="shrink-0 flex justify-end overflow-hidden"
                >
                  <div className="shrink-0 flex justify-center" style={{ width: SEPARATOR_PX }}>
                    <motion.div style={{ height: sepHeight }} className="w-[1px] bg-white/15" />
                  </div>
                </motion.div>
                <div
                  ref={tabsContainerRef}
                  role="tablist"
                  aria-label="Open notes"
                  onMouseDown={handleMouseDown}
                  onScroll={checkScrollFade}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                  className="relative flex items-center overflow-x-auto shrink sm:shrink-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] max-w-[calc(100vw-10rem)] sm:max-w-[50vw] md:max-w-[60vw] lg:max-w-[700px] min-w-0 h-full select-none md:cursor-grab md:active:cursor-grabbing [touch-action:pan-x] [-webkit-touch-callout:none]"
                  style={{
                    gap: PILL_GAP_PX,
                    WebkitOverflowScrolling: 'touch',
                    touchAction: 'pan-x',
                    // mask-image (edge fades) is written directly by checkScrollFade
                  }}
                >
              {/* Pills enter/leave by animating a wrapper's real width (0 ↔ natural), so neighbours, the
                  strip and the whole dock resize in normal layout — nothing is projected or pulled out of
                  flow, so nothing snaps at the end and no scroll space is left behind by a leaving pill.
                  Default initial (true): this list only mounts together with the group, i.e. because the
                  first tab was just opened, so that first pill grows in like any other. */}
              <AnimatePresence onExitComplete={checkScrollFade}>
                {openTabs.map((tab) => {
                  const isActive = activeTabId === tab._id;
                  return (
                    <SpringWidth
                      key={tab._id}
                      gap={PILL_GAP_PX}
                      data-pill-wrapper=""
                      // No re-scroll here: ensurePillVisible already tracks the pill while it grows,
                      // and restarting it on settle would reset the scroll mid-motion.
                      onSettled={checkScrollFade}
                      className="shrink-0"
                      contentClassName="flex items-center"
                    >
                    <motion.div
                      role="tab"
                      aria-selected={isActive}
                      tabIndex={tab._id === focusablePillId ? 0 : -1}
                      onKeyDown={(e) => handlePillKeyDown(tab._id, e)}
                      data-tab-id={tab._id}
                      style={{
                        height: pillHeight,
                        paddingLeft: pillPL,
                        paddingRight: pillPR,
                        overflow: 'hidden',
                      }}
                      onClick={(e) => handleTabClick(tab._id, e)}
                      className={`
                        shrink-0 group/tabpill relative flex items-center rounded-full cursor-pointer border transition-colors duration-200 select-none
                        outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#f4eadc]/70
                        ${isActive
                          ? 'bg-[#f4eadc] text-[#333] shadow-sm border-transparent'
                          : 'bg-white/5 text-stone-300 border-white/5 hover:bg-white/10'
                        }
                      `}
                    >
                      {/* The width cap sits on the title, not the pill: the active pill's close slot then adds
                          its 20px next to the title instead of taking it from the title — with the cap on
                          the pill, a long title re-truncated frame by frame (the "…" crawled 20px) while
                          the slot opened or closed. */}
                      <motion.span
                        style={{ maxWidth: pillTextMaxW }}
                        className={`
                          truncate font-medium leading-none text-xs whitespace-nowrap select-none pointer-events-none
                          ${isActive ? '' : 'tab-pill-label group-hover/tabpill:[--tab-pill-fade:24px]'}
                        `}
                      >
                        {tab.title || 'Untitled Note'}
                      </motion.span>

                      {/* Active: in-flow cross. Its slot springs open/closed as the pill becomes active/inactive,
                          so the pill (and everything after it) resizes smoothly instead of snapping ~20px.
                          after: pseudo-element widens the hit area without changing the look. */}
                      <motion.span
                        initial={false}
                        animate={isActive ? CLOSE_SLOT_OPEN : CLOSE_SLOT_CLOSED}
                        className="shrink-0 self-stretch flex items-center justify-end overflow-hidden"
                        aria-hidden={!isActive}
                      >
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label="Close tab"
                          onClick={(e) => { e.stopPropagation(); handleCloseTab(tab._id); }}
                          style={{ width: CLOSE_BUTTON_PX, height: CLOSE_BUTTON_PX }}
                          className={`relative flex items-center justify-center rounded-full shrink-0 text-stone-500 hover:text-red-500 hover:bg-stone-200/60 transition-colors after:absolute after:-inset-2 ${isActive ? '' : 'pointer-events-none'}`}
                          title="Close tab"
                        >
                          <MdClose className="text-xs cursor-pointer shrink-0" />
                        </button>
                      </motion.span>

                      {!isActive && (
                        /* Inactive: cross fades in on hover while the label's tail fades out (mask, so no
                           colour has to match the translucent dock); pill does not resize */
                        <div className="absolute right-0 top-0 bottom-0 flex items-center justify-end pr-1.5 opacity-0 group-hover/tabpill:opacity-100 pointer-events-none group-hover/tabpill:pointer-events-auto transition-opacity duration-150 ease-out">
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Close tab"
                            onClick={(e) => { e.stopPropagation(); handleCloseTab(tab._id); }}
                            style={{ width: CLOSE_BUTTON_PX, height: CLOSE_BUTTON_PX }}
                            className="relative flex items-center justify-center rounded-full shrink-0 text-stone-300 hover:text-red-300 hover:bg-white/20 transition-colors after:absolute after:-inset-2"
                            title="Close tab"
                          >
                            <MdClose className="text-xs cursor-pointer shrink-0" />
                          </button>
                        </div>
                      )}
                    </motion.div>
                    </SpringWidth>
                  );
                })}
              </AnimatePresence>
              </div>
              </SpringWidth>
            )}
            </AnimatePresence>

          {/* Right separator */}
          <motion.div
            style={{ height: sepHeight }}
            className="shrink-0 w-[1px] bg-white/15 mx-0.5"
          />

          {/* Add note */}
          <motion.button
            style={{ width: circleSize, height: circleSize }}
            onClick={handleNewNote}
            title="New Note"
            className="shrink-0 cursor-pointer group relative flex items-center justify-center rounded-full bg-[#dd5e57] text-white hover:bg-[#fb6d65] shadow-md transition-colors duration-200"
          >
            <MdAdd className="text-[22px] shrink-0 transition-transform duration-200 origin-center group-hover:rotate-90" />
          </motion.button>

        </div>
      </motion.div>
    </motion.div>
  );
};

export default TabDock;
