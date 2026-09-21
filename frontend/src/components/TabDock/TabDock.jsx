import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MdAdd, MdHome, MdClose, MdDeleteOutline, MdErrorOutline, MdOutlineArchive } from 'react-icons/md';
import { LuCheck, LuUndo2 } from 'react-icons/lu';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useTabsStore } from '../../store/useTabsStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useToastStore } from '../../store/useToastStore';

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

const DOCK_SPRING = { type: 'spring', stiffness: 440, damping: 32, mass: 0.5 };

const TabDock = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { openTabs, activeTabId, setActiveTab, closeTab, createDraftTab } = useTabsStore();
  const { activeFolderId } = useFoldersStore();

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

  // Single-spring master progress (0 = home/expanded, 1 = editor/compact).
  // All dimensions derive from this one spring to prevent multi-spring phase lag/twitch.
  const progressTarget = useMotionValue(isEditorActive ? 1 : 0);
  const progress       = useSpring(progressTarget, DOCK_SPRING);

  useEffect(() => {
    progressTarget.set(isEditorActive ? 1 : 0);
  }, [isEditorActive, progressTarget]);

  const dockHeight = useTransform(progress, [0, 1], [54, 44]);
  const dockRadius = useTransform(progress, [0, 1], [28, 24]);
  const circleSize = useTransform(progress, [0, 1], [40, 32]);
  const sepHeight  = useTransform(progress, [0, 1], [20, 16]);
  const pillHeight = useTransform(progress, [0, 1], [40, 32]);
  const pillPL     = useTransform(progress, [0, 1], [16, 14]);
  const pillPR     = useTransform(progress, [0, 1], [12, 10]);
  const pillMaxW   = useTransform(progress, [0, 1], [160, 130]);
  const toastH     = useTransform(progress, [0, 1], [58, 50]);
  const toastR     = useTransform(progress, [0, 1], [28, 24]);
  const undoSize   = useTransform(progress, [0, 1], [32, 28]);
  const toastGap   = useTransform(progress, [0, 1], [8, 6]);

  const tabsContainerRef = useRef(null);
  const [fadeState, setFadeState] = useState({ left: false, right: false });

  const checkScrollFade = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const isScrollable = maxScroll > 4;
    const left = isScrollable && el.scrollLeft > 4;
    const right = isScrollable && el.scrollLeft < maxScroll - 4;
    setFadeState((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const homePaddingBottom = windowWidth < 640 ? 8 : 16;
  const paddingBottom     = useTransform(progress, [0, 1], [homePaddingBottom, 4]);

  const queryParams   = new URLSearchParams(location.search);
  const isFoldersView = queryParams.get('view') === 'folders';
  const isHomeActive  = location.pathname === '/dashboard' && !isFoldersView && !isEditorActive;

  const handleHomeClick = () => { setActiveTab('home'); navigate('/dashboard'); };
  const handleNewNote   = () => { createDraftTab(activeFolderId); };
  const handleTabClick  = (tabId) => setActiveTab(tabId);
  const handleCloseTab  = (tabId) => closeTab(tabId);

  // Reset scroll on Home so the 1st pill docks flush against the left separator
  useEffect(() => {
    if (activeTabId === 'home' && tabsContainerRef.current) {
      tabsContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [activeTabId]);

  // Keep edge fade updated on resize, active tab change, or tab count changes
  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    checkScrollFade();

    const rafId = requestAnimationFrame(checkScrollFade);

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(checkScrollFade);
      ro.observe(el);
    }
    return () => {
      cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
    };
  }, [openTabs.length, activeTabId, checkScrollFade]);

  const maskImage = (!fadeState.left && !fadeState.right)
    ? undefined
    : `linear-gradient(to right, ${
        fadeState.left ? 'transparent, black 1rem' : 'black 0px'
      }, ${
        fadeState.right ? 'black calc(100% - 1rem), transparent' : 'black 100%'
      })`;

  // Desktop mouse drag-to-scroll. Capture-phase click listener suppresses
  // accidental tab activation when releasing a drag gesture (> 4px).
  const handleMouseDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const el = tabsContainerRef.current;
    if (!el) return;
    const startX = e.pageX;
    const startScroll = el.scrollLeft;
    let dragged = false;

    const onMove = (me) => {
      const dx = me.pageX - startX;
      if (Math.abs(dx) > 4) dragged = true;
      el.scrollLeft = startScroll - dx;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragged) {
        const killClick = (ce) => { ce.stopPropagation(); window.removeEventListener('click', killClick, true); };
        window.addEventListener('click', killClick, true);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Maps vertical wheel to horizontal scroll for desktop mice without horizontal tilt
  const handleWheel = (e) => {
    if (tabsContainerRef.current && e.deltaY) {
      tabsContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <motion.div
      style={{ paddingBottom }}
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col justify-end items-center pointer-events-none px-3 sm:px-4"
    >
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, scale: 0.85, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 6 }}
            transition={DOCK_SPRING}
            className="pointer-events-auto shrink-0 flex justify-center"
            style={{ marginBottom: toastGap }}
          >
            <motion.div
              style={{ height: toastH, borderRadius: toastR }}
              onClick={toast.onUndo ? handleUndo : hideToast}
              className={`
                flex items-center justify-between select-none cursor-pointer whitespace-nowrap
                max-w-[90vw] sm:max-w-[400px]
                bg-[#2a2a2a]/85 backdrop-blur-md border border-white/10 shadow-2xl text-stone-100 hover:bg-[#333336]
                ${isEditorActive ? 'px-3.5' : 'px-4'}
                ${toast.onUndo ? (isEditorActive ? 'pr-2' : 'pr-2.5') : ''}
              `}
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dock */}
      <motion.div
        style={{ height: dockHeight, borderRadius: dockRadius }}
        className="relative pointer-events-auto flex items-center justify-center overflow-hidden bg-[#2a2a2a]/85 backdrop-blur-md border border-white/10 shadow-2xl px-2 max-w-[calc(100vw-1.5rem)] sm:max-w-none"
      >
        <div className="flex items-center gap-1 justify-center h-full min-w-0 max-w-full">

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

          {/* Left separator + pills — only when tabs exist */}
          {openTabs.length > 0 && (
            <>
              <motion.div
                style={{ height: sepHeight }}
                className="shrink-0 w-[1px] bg-white/15 mx-0.5"
              />
              <div
                ref={tabsContainerRef}
                onMouseDown={handleMouseDown}
                onWheel={handleWheel}
                onScroll={checkScrollFade}
                className="flex items-center gap-1 overflow-x-auto shrink-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] max-w-[calc(100vw-8rem)] sm:max-w-[50vw] md:max-w-[60vw] lg:max-w-[700px] min-w-0 h-full select-none md:cursor-grab md:active:cursor-grabbing"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-x',
                  WebkitMaskImage: maskImage,
                  maskImage,
                }}
              >
              {/* mode="popLayout" removes exiting pill from flex flow so siblings FLIP immediately, mirroring enter spring */}
              <AnimatePresence mode="popLayout">
                {openTabs.map((tab) => {
                  const isActive = activeTabId === tab._id;
                  return (
                    <motion.div
                      key={tab._id}
                      layout="position"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={DOCK_SPRING}
                      style={{
                        height: pillHeight,
                        paddingLeft: pillPL,
                        paddingRight: pillPR,
                        maxWidth: pillMaxW,
                        overflow: 'hidden',
                      }}
                      onClick={() => handleTabClick(tab._id)}
                      className={`
                        shrink-0 group/tabpill relative flex items-center rounded-full cursor-pointer border transition-colors duration-200 select-none
                        ${isActive
                          ? 'bg-[#f4eadc] text-[#333] shadow-sm border-transparent'
                          : 'bg-white/5 text-stone-300 border-white/5 hover:bg-white/10'
                        }
                      `}
                    >
                      <span className="truncate font-medium leading-none text-xs whitespace-nowrap select-none pointer-events-none">
                        {tab.title || 'Untitled Note'}
                      </span>

                      {/* Active: in-flow cross, always visible */}
                      {isActive ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleCloseTab(tab._id); }}
                          className="relative ml-1.5 flex items-center justify-center rounded-full shrink-0 w-3.5 h-3.5 text-stone-500 hover:text-red-500 hover:bg-stone-200/60 transition-colors"
                          title="Close tab"
                        >
                          <MdClose className="text-xs cursor-pointer shrink-0" />
                        </button>
                      ) : (
                        /* Inactive: gradient overlay fades in on hover, pill does not resize */
                        <div className="absolute right-0 top-0 bottom-0 flex items-center justify-end pr-1.5 pl-6 bg-gradient-to-r from-transparent via-[#333336]/90 to-[#333336] rounded-r-full opacity-0 group-hover/tabpill:opacity-100 pointer-events-none group-hover/tabpill:pointer-events-auto transition-opacity duration-150 ease-out">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleCloseTab(tab._id); }}
                            className="flex items-center justify-center rounded-full shrink-0 w-3.5 h-3.5 text-stone-300 hover:text-red-300 hover:bg-white/20 transition-colors"
                            title="Close tab"
                          >
                            <MdClose className="text-xs cursor-pointer shrink-0" />
                          </button>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              </div>
            </>
          )}

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
