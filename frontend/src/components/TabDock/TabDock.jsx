import React, { useState, useRef, useLayoutEffect, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MdAdd, MdHome, MdClose, MdDeleteOutline, MdErrorOutline, MdOutlineArchive } from 'react-icons/md';
import { LuCheck, LuUndo2 } from 'react-icons/lu';
import { motion, AnimatePresence } from 'framer-motion';
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

const renderToastIcon = (type, isEditorActive) => {
  const iconClass = isEditorActive ? 'text-sm shrink-0' : 'text-base shrink-0';
  if (type === 'warning') {
    return <MdErrorOutline className={`${iconClass} text-amber-400`} />;
  }
  if (type === 'error') {
    return <MdErrorOutline className={`${iconClass} text-red-400`} />;
  }
  if (type === 'archive') {
    return <MdOutlineArchive className={`${iconClass} text-stone-300`} />;
  }
  if (type === 'delete') {
    return <MdDeleteOutline className={`${iconClass} text-red-400`} />;
  }
  return <LuCheck className={`${iconClass} text-stone-300`} />;
};

const TabDock = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { openTabs, activeTabId, setActiveTab, closeTab, createDraftTab } = useTabsStore();
  const { activeFolderId } = useFoldersStore();

  const toast = useToastStore((state) => state.toast);
  const hideToast = useToastStore((state) => state.hideToast);
  const [undoneToastId, setUndoneToastId] = useState(null);

  const isUndone = Boolean(toast?.id && undoneToastId === toast.id);

  const handleUndo = async () => {
    if (isUndone || !toast?.onUndo) return;
    const currentToastId = toast.id;
    if (currentToastId) {
      setUndoneToastId(currentToastId);
    }
    try {
      await Promise.resolve(toast.onUndo());
    } catch (err) {
      console.error("Toast undo error:", err);
    } finally {
      const currentState = useToastStore.getState();
      if (!currentState.toast || currentState.toast.id === currentToastId) {
        hideToast();
      }
    }
  };

  // dock is compact when any editor tab is active
  const isEditorActive = activeTabId !== 'home';

  const queryParams = new URLSearchParams(location.search);
  const isFoldersView = queryParams.get('view') === 'folders';
  const isHomeActive = location.pathname === '/dashboard' && !isFoldersView && !isEditorActive;

  const handleHomeClick = () => {
    setActiveTab('home');
    navigate('/dashboard');
  };

  const handleNewNote = () => {
    createDraftTab(activeFolderId);
  };

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
  };

  const controlsRef = useRef(null);
  const toastRef = useRef(null);
  const [dimensions, setDimensions] = useState(null);

  // Unified spring physics for dock and toast
  const DOCK_SPRING = { type: 'spring', stiffness: 440, damping: 32, mass: 0.5 };

  // Determine whether split mode should be active:
  // When controls width exceeds toast pill width and tabs are open, split into floating satellite island.
  // Defaults to 150px baseline before toastRef is attached.
  const currentControlsW = controlsRef.current?.offsetWidth || 0;
  const currentToastW = toastRef.current?.offsetWidth || 150;
  const isSplit = Boolean(toast && openTabs.length > 0 && currentControlsW > currentToastW);

  const updateDimensions = useCallback(() => {
    const controlsEl = controlsRef.current;
    if (!controlsEl) return;

    const controlsW = controlsEl.offsetWidth;
    const controlsH = controlsEl.offsetHeight;
    const padX = 16; // px-2: 8px left + 8px right
    const padY = 16; // py-2: 8px top + 8px bottom
    const border = 2; // 1px border each side

    if (toast && toastRef.current) {
      const toastW = toastRef.current.offsetWidth;
      const toastH = toastRef.current.offsetHeight;
      const gap = isEditorActive ? 6 : 8;

      const shouldSplit = openTabs.length > 0 && controlsW > toastW;

      if (shouldSplit) {
        // Wide dock: dock stays at resting height, toast floats independently above
        setDimensions({
          width: controlsW + padX + border,
          height: controlsH + padY + border,
        });
      } else {
        // Compact dock: dock expands vertically into unified cohesive squircle
        setDimensions({
          width: Math.max(controlsW, toastW) + padX + border,
          height: controlsH + toastH + gap + padY + border,
        });
      }
    } else {
      setDimensions({
        width: controlsW + padX + border,
        height: controlsH + padY + border,
      });
    }
  }, [toast, isEditorActive, openTabs.length]);

  useLayoutEffect(() => {
    updateDimensions();
  }, [updateDimensions, openTabs, activeTabId]);

  useEffect(() => {
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [updateDimensions]);

  const renderToastPill = (mode) => {
    if (mode === 'split') {
      return (
        <div
          ref={toastRef}
          onClick={toast.onUndo ? handleUndo : hideToast}
          style={dimensions?.height ? { height: dimensions.height } : undefined}
          className={`
            flex items-center justify-between select-none cursor-pointer whitespace-nowrap
            max-w-[90vw] sm:max-w-[400px]
            bg-[#2a2a2a]/85 backdrop-blur-md border border-white/10 shadow-2xl text-stone-100 hover:bg-[#333336]
            transition-[border-radius,background-color] duration-300
            ${isEditorActive ? 'h-[50px] rounded-[24px] px-3.5' : 'h-[58px] rounded-[28px] px-4'}
            ${toast.onUndo ? (isEditorActive ? 'pr-2' : 'pr-2.5') : ''}
          `}
        >
          {/* Status Icon & Message */}
          <div className="flex items-center gap-2 min-w-0 pr-1">
            {renderToastIcon(toast.type, isEditorActive)}
            <span className={`truncate font-semibold tracking-wide text-stone-100 ${isEditorActive ? 'text-xs' : 'text-sm'}`}>
              {getToastDisplayText(toast)}
            </span>
          </div>

          {/* Circular Undo Button */}
          {toast.onUndo && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleUndo(); }}
              title="Undo"
              className={`
                shrink-0 ${isEditorActive ? 'w-7 h-7' : 'w-8 h-8'}
                rounded-full bg-white/20 hover:bg-white/30 active:scale-90
                flex items-center justify-center text-white
                border border-white/25 shadow-sm transition-all cursor-pointer ml-2
              `}
            >
              <LuUndo2 className={isEditorActive ? 'text-[11px]' : 'text-xs'} />
            </button>
          )}
        </div>
      );
    }

    // Unified mode (compact dock, 0 tabs open): frosted inner pill inside dock container
    return (
      <div
        ref={toastRef}
        onClick={toast.onUndo ? handleUndo : hideToast}
        className={`
          flex items-center justify-between rounded-full select-none cursor-pointer whitespace-nowrap
          max-w-[90vw] sm:max-w-[400px]
          pl-3.5 ${toast.onUndo ? (isEditorActive ? 'pr-1.5' : 'pr-2') : 'pr-3.5'}
          bg-white/10 hover:bg-white/15 backdrop-blur-md border border-white/20 text-stone-100 shadow-lg shadow-black/20
          transition-colors
          ${isEditorActive ? 'h-8 min-h-[32px] text-xs' : 'h-10 min-h-[40px] text-xs'}
        `}
      >
        {/* Status Icon & Message */}
        <div className="flex items-center gap-2 min-w-0 pr-1">
          {renderToastIcon(toast.type, isEditorActive)}
          <span className="truncate font-semibold tracking-wide text-stone-100">
            {getToastDisplayText(toast)}
          </span>
        </div>

        {/* Circular Undo Button */}
        {toast.onUndo && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleUndo(); }}
            title="Undo"
            className={`
              shrink-0 ${isEditorActive ? 'w-6 h-6' : 'w-7 h-7'}
              rounded-full bg-white/20 hover:bg-white/30 active:scale-90
              flex items-center justify-center text-white
              border border-white/25 shadow-sm transition-all cursor-pointer ml-2
            `}
          >
            <LuUndo2 className={isEditorActive ? 'text-[11px]' : 'text-xs'} />
          </button>
        )}
      </div>
    );
  };

  return (
    /*
     * Outer wrapper: full-width fixed bar with vertical column layout, centered horizontally.
     * Pinned at the bottom of the viewport with responsive padding.
     */
    <div
      className={`
        fixed bottom-0 left-0 right-0 z-50 flex flex-col justify-end items-center pointer-events-none
        transition-[padding-bottom] duration-300 ease-in-out
        ${isEditorActive ? 'pb-1 sm:pb-1' : 'pb-2 sm:pb-4'}
      `}
    >
      {/*
       * Floating Satellite Toast Capsule (Split Mode)
       * Rendered when dock controls width exceeds the toast pill width.
       */}
      <AnimatePresence>
        {isSplit && toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, scale: 0.85, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: isEditorActive ? -4 : -6 }}
            exit={{ opacity: 0, scale: 0.85, y: 6 }}
            transition={DOCK_SPRING}
            className={`pointer-events-auto shrink-0 flex justify-center ${isEditorActive ? 'mb-1.5' : 'mb-2'}`}
          >
            {renderToastPill('split')}
          </motion.div>
        )}
      </AnimatePresence>

      {/*
       * Dock container: spring-animates width & height simultaneously based on
       * dynamically measured DOM components (100% relative, 0% hardcoded).
       * Never uses CSS transform: scale, so the bottom controls row remains
       * rock-solid and round buttons never squish into ovals.
       */}
      <motion.div
        initial={false}
        animate={
          dimensions
            ? {
                width: dimensions.width,
                height: dimensions.height,
                y: toast ? (isEditorActive ? -4 : -6) : 0,
              }
            : undefined
        }
        transition={DOCK_SPRING}
        className={`
          relative pointer-events-auto flex flex-col items-center justify-end overflow-hidden
          bg-[#2a2a2a]/85 backdrop-blur-md border border-white/10 shadow-2xl px-2 py-2
          transition-[border-radius] duration-300
          ${isEditorActive ? 'rounded-[24px]' : 'rounded-[28px]'}
        `}
      >
        {/*
         * Upper Tier: Toast Notification Pill (Unified Mode only)
         * Fades and scales in with physical spring inside unified dock squircle.
         */}
        <AnimatePresence>
          {!isSplit && toast && (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, scale: 0.85, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: -4 }}
              transition={{ ...DOCK_SPRING, opacity: { duration: 0.12 } }}
              className={`w-full flex justify-center shrink-0 ${isEditorActive ? 'mb-1.5' : 'mb-2'}`}
            >
              {renderToastPill('unified')}
            </motion.div>
          )}
        </AnimatePresence>

        {/*
         * Lower Tier: Dock Controls Row
         * Measured dynamically via controlsRef. Completely static: zero transforms.
         */}
        <div
          ref={controlsRef}
          className="flex items-center gap-1 shrink-0 justify-center"
        >
          {/* home button */}
          <motion.button
            layout="position"
            transition={DOCK_SPRING}
            onClick={handleHomeClick}
            title="Home"
            className={`
              shrink-0 cursor-pointer
              flex items-center justify-center rounded-full transition-colors duration-200
              ${isHomeActive ? 'bg-[#f4eadc] text-[#333] shadow-md' : 'text-stone-300 hover:bg-white/10'}
              ${isEditorActive ? 'w-8 h-8' : 'w-10 h-10'}
            `}
          >
            <MdHome className={isEditorActive ? 'text-lg' : 'text-xl'} />
          </motion.button>

          {/* separator only when tabs exist */}
          {openTabs.length > 0 && (
            <motion.div
              layout="position"
              transition={DOCK_SPRING}
              className={`shrink-0 w-[1px] bg-white/15 mx-0.5 ${isEditorActive ? 'h-4' : 'h-5'}`}
            />
          )}

          {/* note tabs container */}
          {openTabs.length > 0 && (
            <motion.div
              layout="position"
              transition={DOCK_SPRING}
              className="flex items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden max-w-[45vw] sm:max-w-[50vw] md:max-w-[60vw] lg:max-w-[700px] min-w-0 px-1 py-0.5"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {openTabs.map((tab) => {
                const isActive = activeTabId === tab._id;
                return (
                  <motion.div
                    key={tab._id}
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={DOCK_SPRING}
                    onClick={() => handleTabClick(tab._id)}
                    className={`
                      shrink-0 group flex items-center rounded-full cursor-pointer transition-colors duration-200 border
                      ${isEditorActive ? 'pl-3.5 pr-2.5 py-1.5 max-w-[130px]' : 'pl-4 pr-3 py-2 max-w-[160px]'}
                      ${isActive
                        ? 'bg-[#f4eadc] text-[#333] shadow-sm border-transparent'
                        : 'bg-white/5 text-stone-300 border-white/5 hover:bg-white/10'
                      }
                    `}
                  >
                    <span className={`truncate font-medium mr-1.5 ${isEditorActive ? 'text-xs' : 'text-sm'}`}>
                      {tab.title || 'Untitled Note'}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tab._id); }}
                      className={`
                        flex-shrink-0 p-0.5 rounded-full transition-colors
                        ${isActive
                          ? 'text-stone-500 hover:text-red-500 hover:bg-stone-100'
                          : 'text-stone-400 opacity-0 group-hover:opacity-100 hover:text-red-300 hover:bg-white/10'
                        }
                      `}
                    >
                      <MdClose className={isEditorActive ? 'text-[10px] cursor-pointer' : 'text-xs cursor-pointer'} />
                    </button>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {/* separator before + */}
          <motion.div
            layout="position"
            transition={DOCK_SPRING}
            className={`shrink-0 w-[1px] bg-white/15 mx-0.5 ${isEditorActive ? 'h-4' : 'h-5'}`}
          />

          {/* add note */}
          <motion.button
            layout="position"
            transition={DOCK_SPRING}
            onClick={handleNewNote}
            title="New Note"
            className={`
              shrink-0 cursor-pointer group relative
              flex items-center justify-center rounded-full
              bg-[#dd5e57] text-white hover:bg-[#fb6d65]
              shadow-md transition-colors duration-200
              ${isEditorActive ? 'w-8 h-8' : 'w-10 h-10'}
            `}
          >
            {/* Absolutely center the icon mathematically and only rotate the icon, to prevent button wobble */}
            <MdAdd className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform duration-200 origin-center group-hover:rotate-90 ${isEditorActive ? 'text-[20px]' : 'text-[24px]'}`} />
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
};

export default TabDock;
