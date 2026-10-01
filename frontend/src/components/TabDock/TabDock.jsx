import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MdAdd, MdHome, MdClose } from 'react-icons/md';
import { motion, animate, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useTabsStore } from '../../store/useTabsStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DOCK_METRICS, DOCK_MOBILE_QUERY } from './dockMetrics';
import { PILL_FADE, PILL_SPRING, useCenteredDockPx, useDockPx } from './dockMotion';
import SpringWidth from './SpringWidth';
import DockToast from './DockToast';
import HoldMenu from './HoldMenu';
import { useEdgeFade } from './useEdgeFade';

// Home ↔ editor compaction. All dock sizes are rounded to whole pixels, so how the spring *ends*
// decides whether it looks clean: an overdamped spring crawls through its last pixels, the final 1px
// steps arriving frames apart (a visible tick at rest). A slight bounce carries the motion through
// them at speed, and its overshoot stays under half a pixel on every dock size, so rounding hides it
// (simulated on the real metrics; bounce ≥ 0.25 starts to overshoot visibly).
const DOCK_SPRING = { type: 'spring', visualDuration: 0.2, bounce: 0.2 };
const PILL_BORDER_PX = 1; // Tailwind `border`

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

  // Single capture-phase listener at root: dismisses the list on an outside click
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
      style={{ paddingBottom }}
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
                          beside the title instead of taking it from it (a long title would re-truncate
                          every frame while the slot opens: the "…" crawls). */}
                      <motion.span
                        style={{ maxWidth: pillTextMaxW }}
                        className={`
                          truncate font-medium leading-none text-xs whitespace-nowrap select-none pointer-events-none
                          ${isActive ? '' : 'tab-pill-label group-hover/tabpill:[--tab-pill-fade:24px]'}
                        `}
                      >
                        {tab.title || 'Untitled Note'}
                      </motion.span>

                      {/* Active: in-flow cross. Its slot springs open/closed as the pill becomes
                          active/inactive, so the pill resizes smoothly instead of snapping.
                          The after: pseudo-element widens the hit area without changing the look. */}
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