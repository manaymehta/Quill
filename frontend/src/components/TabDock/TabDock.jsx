import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MdAdd, MdHome, MdClose } from 'react-icons/md';
import { motion, animate, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useTabsStore } from '../../store/useTabsStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useUIStore } from '../../store/useUIStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DOCK_METRICS, DOCK_MOBILE_QUERY } from './dockMetrics';
import { PILL_FADE, PILL_SPRING, useCenteredDockPx, useDockPx } from './dockMotion';
import SpringWidth from './SpringWidth';
import FadeTitle from './FadeTitle';
import DockToast from './DockToast';
import HoldMenu from './HoldMenu';
import { useEdgeFade } from './useEdgeFade';
import { useOutsidePress } from './useOutsidePress';

// Home ↔ editor compaction. All dock sizes are rounded to whole pixels, so how the spring *ends*
// decides whether it looks clean: an overdamped spring crawls through its last pixels, the final 1px
// steps arriving frames apart (a visible tick at rest). A slight bounce carries the motion through
// them at speed, and its overshoot stays under half a pixel on every dock size, so rounding hides it
// (simulated on the real metrics; bounce ≥ 0.25 starts to overshoot visibly).
const DOCK_SPRING = { type: 'spring', visualDuration: 0.2, bounce: 0.2 };
const PILL_BORDER_PX = 1; // Tailwind `border`

// Full-screen dot (see the dot progress in TabDock). Sizes use the progress clamped to 0–1, so they
// land exactly on whole pixels and stop; the spring's bounce is carried by a scale instead, which
// moves smoothly at any fraction (bouncing the rounded sizes stepped 1px at a time — a jitter).
// Past the dot (progress > 1) the dot dips smaller and springs back; past the dock (< 0) the dock
// swells slightly and settles — the same kind of pop as the toast's.
const DOT_SPRING = { type: 'spring', visualDuration: 0.26, bounce: 0.3, restDelta: 0.0005 };
const DOT_POP_SCALE  = 1.6; // scale dip per unit of overshoot past the dot (≈7% at this bounce)
const DOCK_POP_SCALE = 0.6; // scale swell per unit of overshoot past the dock (≈3%)
// Treated as fully back to the dock: the spring's last small wobble can come to rest just above 0,
// which left the dock at a fixed width with its contents still ignoring taps
const DOT_AT_DOCK = 0.002;
const DOT_ROW_FADE_END = 0.4;     // closing: the dock's contents are gone by 40% of the way to the dot
// Opening: they're back by 25% of the way out. They start stacked under the + (same-size circles, the
// + on top), so they visibly slide out from behind it; with the closing timing they stayed invisible
// until 60% of the way out, so they appeared far from the dot, as if the dock filled in from the left.
const DOT_ROW_FADE_IN_END = 0.25;
const DOT_ICON_FADE_END = 0.6;   // the + button's icon is gone by 60% of the way (leaving its circle)
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Tab strip: edge fade width, and the spring for programmatic scrolling (bringing the active pill
// into view, resetting to the start on Home)
const STRIP_FADE_PX = 16;
const STRIP_SCROLL_SPRING = { type: 'spring', visualDuration: 0.3, bounce: 0 };

// Pills and the separator + strip group enter/leave by springing their width (see SpringWidth)
const PILL_GAP_PX     = 4; // between pills in the strip
const DOCK_ROW_GAP_PX = 4; // between items in the dock row

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
const CLOSE_SLOT_OPEN_PX = CLOSE_BUTTON_PX + CLOSE_SLOT_GAP_PX;

// The active pill's close slot. Normally it springs open/closed on its own (PILL_SPRING) as the
// pill becomes active/inactive. But when that happens together with the dock resizing (home ↔
// editor: tapping a pill at home, or going home), it follows the resize progress instead. On its own
// spring it opened slower than the pill's title cap shrank (the dock's spring), so the pill got
// narrower than its final size, then wider again — and, the dock being centred, the pill slid right
// and back (simulated: 2.6px on desktop; 8 reversals on a phone). Following the progress, the slot's
// width is whatever makes the pill's TOTAL width one smoothly rounded value, so every edge moves
// one way only. `natural` is the title's full width (its scrollWidth).
const compactionSlotPx = (v, metrics, natural) => {
  const plRaw = lerp(...metrics.pillPaddingLeft, v);
  const prRaw = lerp(...metrics.pillPaddingRight, v);
  const capRaw = lerp(...metrics.pillMaxWidth, v);
  // The pill's other parts, as rendered (rounded like useDockPx)
  const pl = Math.round(plRaw), pr = Math.round(prRaw), cap = Math.round(capRaw);
  const borders = 2 * PILL_BORDER_PX;
  const textW = Math.min(natural, cap - pl - pr - borders);
  const truncated = natural > capRaw - plRaw - prRaw - borders;
  const totalRaw = (truncated ? capRaw : plRaw + prRaw + borders + natural) + CLOSE_SLOT_OPEN_PX * v;
  return Math.max(0, Math.round(totalRaw) - (pl + textW + pr + borders));
};

const CloseSlot = ({ isActive, followsCompaction, progress, metrics, className, children, ...rest }) => {
  const ref = useRef(null);
  const width = useMotionValue(isActive ? CLOSE_SLOT_OPEN_PX : 0);
  const opacity = useMotionValue(isActive ? 1 : 0);
  useEffect(() => {
    if (followsCompaction) {
      const natural = ref.current?.previousElementSibling?.scrollWidth ?? 0; // the title span
      const update = (v) => {
        width.set(compactionSlotPx(v, metrics, natural));
        opacity.set(clamp01(v * 2));
      };
      update(progress.get());
      return progress.on('change', update);
    }
    const w = animate(width, isActive ? CLOSE_SLOT_OPEN_PX : 0, PILL_SPRING);
    const o = animate(opacity, isActive ? 1 : 0, PILL_FADE);
    return () => { w.stop(); o.stop(); };
  }, [followsCompaction, isActive, progress, metrics, width, opacity]);
  return <motion.span ref={ref} style={{ width, opacity }} className={className} {...rest}>{children}</motion.span>;
};

// Tab strip scrolling feel
const MOMENTUM_SAMPLE_MS    = 80;    // drag window used to measure release velocity
const MOMENTUM_MIN_VELOCITY = 0.1;   // px/ms; slower releases just stop
const MOMENTUM_FRICTION     = 0.95;  // velocity retained per 16ms frame
const MOMENTUM_STOP         = 0.02;  // px/ms; below this the glide ends
const WHEEL_LINE_PX         = 16;    // Firefox line-mode wheel delta → px
const WHEEL_NOTCH_MIN       = 40;    // |delta| at or above this is a notched mouse wheel (eased)
const WHEEL_CHAIN_MS        = 250;   // wheel events closer than this chain onto one smooth scroll
const LONG_PRESS_RELEASE_GUARD_MS = 300; // after lifting from a long press, ignore a stray release click

const TabDock = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const openTabs       = useTabsStore((s) => s.openTabs);
  const activeTabId    = useTabsStore((s) => s.activeTabId);
  const setActiveTab   = useTabsStore((s) => s.setActiveTab);
  const closeTab       = useTabsStore((s) => s.closeTab);
  const createDraftTab = useTabsStore((s) => s.createDraftTab);
  const activeFolderId = useFoldersStore((s) => s.activeFolderId);

  const isEditorActive = activeTabId !== 'home';

  // The pill whose activation coincides with the dock resizing (see CloseSlot): the one tapped at
  // home, or the one that was active when going home. Worked out while rendering from the previous
  // active tab (React's pattern for reacting to a changed value), and cleared once the resize settles.
  const [prevActiveTabId, setPrevActiveTabId] = useState(activeTabId);
  const [compactionPillId, setCompactionPillId] = useState(null);
  // Full-screen editor: whether the dock has been expanded from its dot (see the dot below)
  const [isDockExpanded, setIsDockExpanded] = useState(false);
  if (prevActiveTabId !== activeTabId) {
    setPrevActiveTabId(activeTabId);
    const wasEditor = prevActiveTabId !== 'home';
    // Switching notes within the editor is no resize: those slots use their own spring
    setCompactionPillId(wasEditor === isEditorActive ? null : (isEditorActive ? activeTabId : prevActiveTabId));
    // Leaving the editor: the next note opens with the dock as a dot again
    if (!isEditorActive) setIsDockExpanded(false);
  }

  const isMobile = useMediaQuery(DOCK_MOBILE_QUERY);
  const metrics  = isMobile ? DOCK_METRICS.mobile : DOCK_METRICS.desktop;

  // One master progress (0 = home/expanded, 1 = editor/compact). Every dock dimension derives from
  // it: separate springs per dimension drift out of phase and twitch.
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
  const paddingBottom = useDockPx(progress, metrics.paddingBottom);

  // Full-screen editor: the dock shrinks into a dot — the compact dock reduced to one button: its
  // own height, rounding and bottom position (so only the width changes), with a coral circle the
  // size of its + button inside, at the same inset. The editor's toolbar is sized around it
  // (fullscreenToolbarHeight in editorChrome.js), so it sits centred in the toolbar. A second
  // progress (0 = dock, 1 = dot) drives it, on top of the compaction above.
  const isEditorFullscreen = useUIStore((s) => s.isEditorFullscreen);
  // Tapping the dot expands the dock back to normal, and it stays expanded until a tap outside it
  // (picking a note or + in it doesn't shrink it). Leaving or re-entering full screen, or leaving
  // the editor, starts from the dot again.
  useEffect(() => useUIStore.subscribe((state, prev) => {
    if (state.isEditorFullscreen !== prev.isEditorFullscreen) setIsDockExpanded(false);
  }), []);
  const isDotted = isEditorFullscreen && isEditorActive && !isDockExpanded;
  const expandDock = () => setIsDockExpanded(true);
  const dotTarget = useMotionValue(isDotted ? 1 : 0);
  const dot       = useSpring(dotTarget, DOT_SPRING);
  // Layout effect: the target is set before this render paints, so the motion starts next frame
  useLayoutEffect(() => {
    dotTarget.set(isDotted ? 1 : 0);
  }, [isDotted, dotTarget]);
  const dot01 = useTransform(dot, clamp01);
  // The page reserves a scrollbar gutter on desktop (see GlobalEditorOverlay); the full-screen editor
  // spans it, so the dot does too, to sit at the editor's true centre. Whole pixels, so the dock's
  // centre doesn't drift through fractions as it shrinks.
  // (The gutter's width: html's layout box excludes it, while clientWidth does not.)
  const rootRight = useTransform(dot01, (v) =>
    -Math.round((window.innerWidth - document.documentElement.getBoundingClientRect().width) * v));
  // The dot's centre IS the dock's + button: as the dock shrinks, the row slides so the + travels to
  // the middle (see the width effect below), everything else fades out early, and the + loses its
  // icon — one shape changing, instead of the + being clipped away and a second circle fading in.
  // Its downward shadow levels out too: offset, it darkened the ring below the circle and made the
  // dot look off-centre. Set as CSS variables on the glass, read by the elements below.
  const othersOpacity   = useTransform(() => {
    const v = dot.get();
    return dotTarget.get() === 1
      ? clamp01(1 - v / DOT_ROW_FADE_END)          // closing into the dot
      : clamp01((1 - v) / DOT_ROW_FADE_IN_END);    // opening out of it
  });
  const plusIconOpacity = useTransform(dot, (v) => clamp01(1 - v / DOT_ICON_FADE_END));
  const rowPointer  = useTransform(dot, (v) => (v > DOT_AT_DOCK ? 'none' : 'auto'));
  const dotMarkRadius = useTransform(circleSize, (px) => `${px / 2}px`); // the + button's radius
  const glassScale  = useTransform(dot, (v) => (v > 1 ? 1 - (v - 1) * DOT_POP_SCALE : v < 0 ? 1 - v * DOCK_POP_SCALE : 1));

  // Width: the dock is normally `auto` (sized by its contents). While it morphs, its contents are
  // held at their natural width (so nothing inside squashes or re-flows — they're clipped by the
  // glass) and the glass width goes from that natural width to the dot's, unrounded so it moves
  // smoothly (whole-pixel steps showed as stair-steps in the slow end of the spring).
  // The buttons gather into the dot and spread out of it: each one slides by its distance from the
  // + button (which becomes the dot's centre) times the progress, so as the dot they're all stacked
  // on the + and, opening, Home and the pills travel out from it to their places. (Sliding the row
  // as a whole kept their spacing, so opening they swept in from the left edge instead.) The row
  // also slides so the + sits exactly centred.
  // All measured every frame, with the slides taken off first: the contents can change mid-morph —
  // Discard on the last note closes its pill while the dock both grows back and resizes to the home
  // state — and a measurement taken once at the start went stale. Back at 0 it's all `auto` again.
  const dockGlassRef = useRef(null);
  const dockRowRef = useRef(null);
  const dockPlusRef = useRef(null);
  // Once the morph reaches its end, later wobbles of the spring back across that end are ignored:
  // the scale carries the bounce on the far side, but swinging back it would nudge the width (a
  // half-pixel dip after the dock had settled).
  const arrivedRef = useRef(false);
  useLayoutEffect(() => {
    arrivedRef.current = false; // direction changed
  }, [isDotted]);
  useEffect(() => {
    const render = (v) => {
      const glass = dockGlassRef.current;
      const row = dockRowRef.current;
      if (!glass || !row) return;
      const toDot = dotTarget.get() === 1;
      if (toDot ? v >= 1 : v <= DOT_AT_DOCK) arrivedRef.current = true;
      // Landed as the dot: its coral centre is painted by the glass itself (exactly concentric, see
      // .dock-glass[data-dot-mark] in index.css) in place of the + button, which did the travelling.
      // Same size and colour, so the handover doesn't show; reversed as soon as it starts opening.
      const markPainted = toDot && arrivedRef.current;
      glass.toggleAttribute('data-dot-mark', markPainted);
      if (dockPlusRef.current) dockPlusRef.current.style.visibility = markPainted ? 'hidden' : '';
      const plusEl = dockPlusRef.current;
      if (!toDot && arrivedRef.current) {
        glass.style.width = '';
        row.style.width = '';
        row.style.maxWidth = '';
        row.style.flexShrink = '';
        row.style.transform = '';
        for (const child of row.children) child.style.transform = '';
        return;
      }
      // Natural layout, slides off. max-width too: the row's max-w-full would cap it at the
      // (dot-sized) glass.
      row.style.width = 'max-content';
      row.style.maxWidth = 'none';
      row.style.flexShrink = '0';
      row.style.transform = '';
      for (const child of row.children) child.style.transform = '';
      const scale = glassScale.get(); // measure unscaled
      const rowRect = row.getBoundingClientRect();
      const centreInRow = (el) => {
        const r = el.getBoundingClientRect();
        return (r.left + r.width / 2 - rowRect.left) / scale;
      };
      const rowWidth = rowRect.width / scale;
      const plusX = centreInRow(plusEl);
      const cs = getComputedStyle(glass);
      const naturalWidth = rowWidth
        + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
        + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);

      const p = toDot && arrivedRef.current ? 1 : clamp01(v);
      const dotPx = dockHeight.get(); // the dot is as wide as the dock is tall
      glass.style.width = `${lerp(naturalWidth, dotPx, p)}px`;
      for (const child of row.children) {
        if (child !== plusEl) child.style.transform = `translateX(${(plusX - centreInRow(child)) * p}px)`;
      }
      row.style.transform = `translateX(${(rowWidth / 2 - plusX) * p}px)`;
    };
    render(dot.get());
    return dot.on('change', render);
  }, [dot, dotTarget, dockHeight, glassScale]);

  // Marks the dock as resizing so CSS can swap the glass for an opaque fill while it moves (see
  // .dock-root[data-dock-moving] in index.css): until the largest travel has under half a pixel left,
  // where the last rounded step lands, so the blur returns exactly as the dock visibly stops.
  // Written to the DOM only when it flips, so no React render per frame.
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
      if (!next) setCompactionPillId(null); // resize done: the slot is back on its own spring
    });
  }, [progress, settleEpsilon]);

  const tabsContainerRef = useRef(null);

  // Programmatic strip scrolling (bringing the active pill into view, resetting on Home). Our own
  // spring rather than the browser's smooth scroll, so the target can be re-read from the live layout
  // every frame: pills resize while it runs (close slots, pills growing in, the dock compacting).
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
      // Tight end tolerance: the default (1% of 0→1) stops up to ~1.5px short, then jumps.
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

  // Mobile touch-and-hold (long-press) opens the notes list. Lifting the finger must not activate
  // what's under it, so the release click is prevented at its source (preventDefault on touchend),
  // not by swallowing "the next click": Android Chrome sends no release click after a long press, so
  // such a flag stayed set and ate the first real tap in the list.
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

  // Expanded from the dot: a tap outside the dock shrinks it back, and only does that (see
  // useOutsidePress: it can't focus the editor, open the keyboard or press anything under it).
  // While the long-press list is open, the list's own outside-tap handling (below) applies instead.
  const isDockOverEditor = isEditorFullscreen && isEditorActive && isDockExpanded;
  useOutsidePress(isDockOverEditor && !showHoldMenu, {
    isInside: (target) => dockRootRef.current?.contains(target),
    onPress: () => setIsDockExpanded(false),
  });

  // A tap outside the list closes it and only that: stopped at the start of the touch, so tapping
  // the editor's text to close the list doesn't also focus it and open the keyboard (see
  // useOutsidePress). The finger still down from the long press that opened it doesn't count.
  useOutsidePress(showHoldMenu, {
    isInside: (target) => Boolean(target.closest?.('.no-card-click')),
    onPress: () => setIsHoldMenuOpen(false),
    ignore: () => isHoldingAfterLongPressRef.current,
  });

  // Single capture-phase listener at root: dismisses the list on an outside click (and swallows the
  // stray release click / contextmenu of the long press that opened it)
  useEffect(() => {
    if (!showHoldMenu) return;

    const handleOutsideClick = (e) => {
      // Still holding after the long press, or a stray release click just after lifting: ignore it
      // and keep the list open. (Android can fire contextmenu during a long hold, which would
      // otherwise count as an outside click and close the list straight away.)
      if (isHoldingAfterLongPressRef.current || performance.now() < ignoreClicksUntilRef.current) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (e.target.closest?.('.no-card-click')) return;
      e.stopPropagation();
      e.preventDefault();
      setIsHoldMenuOpen(false);
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
  // Opening a note from the dock (+, a pill, the long-press list) keeps the dock expanded in the
  // full-screen editor — you're using it — until a tap outside it. A note opened from its card on the
  // page opens with the dock as a dot. (Outside full screen this has no effect, and turning full
  // screen on starts from the dot again.)
  const handleNewNote   = () => {
    setIsDockExpanded(true);
    createDraftTab(activeFolderId);
  };
  const handleTabClick  = (tabId, e) => {
    if (showHoldMenu) {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      setIsHoldMenuOpen(false);
      return;
    }
    setIsDockExpanded(true);
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
    setIsDockExpanded(true);
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

  // Strip edge fades. Keyed on the tab count (re-observing the pill wrappers), not the tab list,
  // which is recreated on every title keystroke.
  const checkScrollFade = useEdgeFade(tabsContainerRef, 'x', STRIP_FADE_PX, openTabs.length);

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
      data-over-editor={isEditorFullscreen && isEditorActive ? '' : undefined}
      style={{ paddingBottom, right: rootRight }}
      className="dock-root fixed bottom-0 left-0 right-0 z-50 flex flex-col justify-end items-center pointer-events-none px-3 sm:px-4"
    >
      <DockToast progress={progress} metrics={metrics} height={dockHeight} radius={dockRadius} />

      <AnimatePresence>
        {showHoldMenu && (
          <HoldMenu
            key="hold-menu"
            openTabs={openTabs}
            activeTabId={activeTabId}
            onSelect={handleSelectTabFromMenu}
            onClose={handleCloseTab}
          />
        )}
      </AnimatePresence>

      {/* Dock */}
      <motion.div
        ref={dockGlassRef}
        style={{
          height: dockHeight, borderRadius: dockRadius, scale: glassScale,
          '--dock-others': othersOpacity, '--dock-plus-icon': plusIconOpacity, '--dock-dot': dot01,
          '--dot-mark-r': dotMarkRadius,
        }}
        // As the dot it's a button that expands the dock (its contents ignore pointers meanwhile)
        role={isDotted ? 'button' : undefined}
        tabIndex={isDotted ? 0 : undefined}
        aria-label={isDotted ? `Show dock — ${openTabs.length} open ${openTabs.length === 1 ? 'note' : 'notes'}` : undefined}
        onClick={isDotted ? expandDock : undefined}
        onKeyDown={isDotted ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expandDock(); }
        } : undefined}
        className={`group/dot dock-glass relative z-40 pointer-events-auto flex items-center justify-center overflow-hidden border border-white/10 shadow-2xl px-2.5 sm:px-2 max-w-[calc(100vw-1.5rem)] sm:max-w-none outline-none focus-visible:outline-2 focus-visible:outline-[#f4eadc]/70 ${isDotted ? 'cursor-pointer' : ''}`}
      >
          <motion.div
            ref={dockRowRef}
            className="flex items-center justify-center h-full min-w-0 max-w-full"
            style={{ gap: DOCK_ROW_GAP_PX, pointerEvents: rowPointer }}
            // As the dot, nothing inside is reachable (the + stays visible, so keyboard focus could
            // otherwise land on it and create a note)
            inert={isDotted}
          >

            {/* Home */}
            <motion.button
              style={{ width: circleSize, height: circleSize, opacity: 'var(--dock-others, 1)' }}
              onClick={handleHomeClick}
              title="Home"
              className={`
                shrink-0 cursor-pointer flex items-center justify-center rounded-full transition-colors duration-200
                ${isHomeActive ? 'bg-[#f4eadc] text-[#333] shadow-md' : 'text-stone-300 hover:bg-white/10'}
              `}
            >
              <MdHome className="text-xl shrink-0" />
            </motion.button>

            {/* Left separator + pills, only when tabs exist. Opening the first tab: the group doesn't
                animate itself (it tracks its content); the separator and the pill each grow in, so the
                first pill opens like any other (the group chasing a width that changes as the dock
                compacts was slow and twitched). Closing the last tab: the group collapses as a whole,
                still rendering the last pill (AnimatePresence freezes exiting children). */}
            <AnimatePresence initial={false}>
            {openTabs.length > 0 && (
              <SpringWidth
                key="tab-group"
                gap={0}
                animateEnter={false}
                style={{ marginLeft: -DOCK_ROW_GAP_PX }}
                // filter, not opacity: SpringWidth animates its own opacity (entering/leaving)
                className="h-full min-w-0 shrink sm:shrink-0 [filter:opacity(var(--dock-others,1))]"
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
                  // Phones: holding a finger also triggers the browser's own long-press (its context
                  // menu, with a haptic buzz of its own) at about the moment our hold opens the list —
                  // felt as a double vibration. Cancelling it here, from the start, leaves only ours.
                  onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
                  className="relative flex items-center overflow-x-auto shrink sm:shrink-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] max-w-[calc(100vw-10rem)] sm:max-w-[50vw] md:max-w-[60vw] lg:max-w-[700px] min-w-0 h-full select-none md:cursor-grab md:active:cursor-grabbing [touch-action:pan-x] [-webkit-touch-callout:none]"
                  // mask-image (edge fades) is written directly by checkScrollFade
                  style={{ gap: PILL_GAP_PX }}
                >
              {/* Pills enter/leave by animating a wrapper's real width, so neighbours, the strip and the
                  dock resize in normal layout: nothing is projected or pulled out of flow, so nothing
                  snaps at the end. Default initial (true): this list only mounts with the group, i.e.
                  when the first tab opens, so that pill grows in like any other. */}
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
                      {/* The width cap sits on the title, not the pill, so the close slot adds its width
                          beside the title instead of taking it from it. */}
                      <FadeTitle
                        style={{ maxWidth: pillTextMaxW }}
                        className={`font-medium leading-none text-xs select-none pointer-events-none ${isActive ? '' : 'group-hover/tabpill:[--tab-pill-fade:24px]'}`}
                      >
                        {tab.title || 'Untitled Note'}
                      </FadeTitle>

                      {/* Active: in-flow cross. Its slot opens/closes as the pill becomes active/inactive
                          (see CloseSlot), so the pill resizes smoothly instead of snapping.
                          The after: pseudo-element widens the hit area without changing the look. */}
                      <CloseSlot
                        isActive={isActive}
                        followsCompaction={tab._id === compactionPillId}
                        progress={progress}
                        metrics={metrics}
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
                      </CloseSlot>

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
            style={{ height: sepHeight, opacity: 'var(--dock-others, 1)' }}
            className="shrink-0 w-[1px] bg-white/15 mx-0.5"
          />

          {/* Add note. Also the dot's centre in full screen: there its icon fades (--dock-plus-icon),
              its shadow levels out (--dock-dot) and it lightens with the dot's hover. */}
          <motion.button
            ref={dockPlusRef}
            style={{
              width: circleSize, height: circleSize,
              // Tailwind's shadow-md, its downward offset easing to 0 as the dot forms
              boxShadow: '0 calc(4px * (1 - var(--dock-dot, 0))) 6px -1px rgb(0 0 0 / 0.1), 0 calc(2px * (1 - var(--dock-dot, 0))) 4px -2px rgb(0 0 0 / 0.1)',
            }}
            onClick={handleNewNote}
            title="New Note"
            className="shrink-0 cursor-pointer group relative flex items-center justify-center rounded-full bg-[#dd5e57] text-white hover:bg-[#fb6d65] group-hover/dot:bg-[#fb6d65] transition-colors duration-200"
          >
            <MdAdd style={{ opacity: 'var(--dock-plus-icon, 1)' }} className="text-[22px] shrink-0 transition-transform duration-200 origin-center group-hover:rotate-90" />
          </motion.button>

        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default TabDock;