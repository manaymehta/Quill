import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion as Motion, AnimatePresence, animate, useMotionValue, useTransform } from 'framer-motion';
import { FiMenu } from 'react-icons/fi';
import { MdClose } from 'react-icons/md';
import { useTabsStore } from '../../store/useTabsStore';
import { useUIStore } from '../../store/useUIStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { BELOW_TABLET_QUERY, PANEL_NARROW_QUERY } from '../../constants/breakpoints';
import { DOCK_METRICS, DOCK_MOBILE_QUERY, getEditorClearance } from '../TabDock/dockMetrics';
import BottomSheet from '../Modals/BottomSheet';
import { EDITOR_CARD_STYLE, EDITOR_RADIUS_PX } from './editorChrome';

// The editor loads with the app; only its text area (CodeMirror, ~600 kB) is a separate chunk,
// fetched on idle after the layout mounts (and when a note card is pressed): markdownEditorLoader
import AddEditNotes from '../../pages/Home/AddEditNotes';
import { preloadMarkdownEditor } from './markdownEditorLoader';

// Card mode: one continuous page gap (8px on phones → 16px on desktop) and one card measure. The
// gap is not switched in JS at a breakpoint: the card/panel row reflows continuously with the window.
const EDITOR_GAP_CSS = 'clamp(8px, 2vw, 16px)';
const EDITOR_MAX_W_PX = 790;
// The panel is a share of the window, not a fixed slab: 280px minimum, 350px maximum.
const EDITOR_SIDE_PANEL_W = 'clamp(280px, 28vw, 350px)';
const EDITOR_SIDE_PANEL_GAP_PX = 16;
const EDITOR_SIDE_PANEL_SPACE = `calc(${EDITOR_SIDE_PANEL_W} + ${EDITOR_SIDE_PANEL_GAP_PX}px)`;
// The panel's arrival in the floating state: full width on the first frame, only the 250ms
// fade/scale is animated on it; the 500ms progress animates the row and the editor's width. Full
// screen keeps the panel width tween. Don't make the fade match the 500ms — that is the old motion.
const PANEL_TWEEN = { duration: 0.5, ease: [0.16, 1, 0.3, 1] };
const PANEL_FADE = { duration: 0.25, ease: 'easeOut' };
// Card ↔ full screen, as a fixed-duration tween on the curve the old spring produced. framer's
// spring (visualDuration 0.32, bounce 0.12 → ζ 0.88) reached the target at ~0.32 s, then its raw
// value dipped ~0.3% and crept back for another half second; consumers clamped it, so the motion
// froze at 1 and slid below it again — a visible hitch at the landing. The same curve, sampled over
// the tween's length and normalised to arrive exactly on the target, keeps the motion identical and
// ends it there.
const FULLSCREEN_TWEEN_S = 0.32;
const FS_ZETA = 0.88; // damping / (2 * sqrt(stiffness * mass)) for bounce 0.12
const FS_W = (2 * Math.PI) / (FULLSCREEN_TWEEN_S * 1.2);
const FS_WD = FS_W * Math.sqrt(1 - FS_ZETA * FS_ZETA);
const fsSpring = (t) => 1 - Math.exp(-FS_ZETA * FS_W * t) * ((FS_ZETA * FS_W / FS_WD) * Math.sin(FS_WD * t) + Math.cos(FS_WD * t));
const FS_SETTLED = fsSpring(FULLSCREEN_TWEEN_S);
// framer hands an easing its normalised progress, so the spring is sampled over the tween's length.
const fsEase = (progress) => fsSpring(progress * FULLSCREEN_TWEEN_S) / FS_SETTLED;
const FULLSCREEN_TWEEN = { duration: FULLSCREEN_TWEEN_S, ease: fsEase };

const TabEditorSlot = memo(({ tab, isActive, onNoteSaved, onToggleMockPanel, onSummaryReceived }) => {
  const closeTab = useTabsStore((state) => state.closeTab);
  const updateTabState = useTabsStore((state) => state.updateTabState);

  const handleUpdateTabState = useCallback(
    (patch) => updateTabState(tab._id, patch),
    [tab._id, updateTabState],
  );

  const handleClose = useCallback(
    () => closeTab(tab._id),
    [tab._id, closeTab],
  );

  const handleSaveSuccess = useCallback(
    () => onNoteSaved(tab._id),
    [tab._id, onNoteSaved],
  );

  return (
    <AddEditNotes
      type={tab.isDraft ? 'add' : 'edit'}
      noteData={tab}
      isActive={isActive}
      onUpdateTabState={handleUpdateTabState}
      onClose={handleClose}
      onSaveSuccess={handleSaveSuccess}
      onToggleMockPanel={onToggleMockPanel}
      onSummaryReceived={onSummaryReceived}
    />
  );
});
TabEditorSlot.displayName = 'TabEditorSlot';

const GlobalEditorOverlay = () => {
  const openTabs = useTabsStore((state) => state.openTabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openTab = useTabsStore((state) => state.openTab);
  const closeTab = useTabsStore((state) => state.closeTab);
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const isFullscreen = useUIStore((state) => state.isEditorFullscreen);

  const isDockMobile = useMediaQuery(DOCK_MOBILE_QUERY);
  // Reactive (re-renders when the breakpoint is crossed); reading window.innerWidth during render
  // left the ghost cards / summary panel in the old layout after a resize until something else re-rendered.
  const isBelowTablet = useMediaQuery(BELOW_TABLET_QUERY);
  // Below this the side panel + editor would look cramped, so the shared bottom sheet is used. It is
  // latched when the panel opens (see isSheetMode), so a resize can't swap layouts mid-view.
  const isPanelNarrow = useMediaQuery(PANEL_NARROW_QUERY);
  const dockClearance = getEditorClearance(isDockMobile ? DOCK_METRICS.mobile : DOCK_METRICS.desktop);
  const editorGap  = EDITOR_GAP_CSS;
  const editorMaxW = EDITOR_MAX_W_PX;

  // Card ↔ full-screen progress. Starts at the remembered mode, so opening an editor that's already
  // full screen doesn't animate. Gaps are rounded to whole pixels (sub-pixel edges make the text
  // re-snap to the pixel grid each frame — the dock's jitter lesson); corners and fades needn't be.
  // The target follows the store directly (not a React effect, which runs only after the re-render
  // has painted), so the motion starts on the next frame after the click. The tween is stopped
  // before a new one starts, so a click in the middle of a transition continues from where it is.
  const fs = useMotionValue(isFullscreen ? 1 : 0);
  const fsAnimation = useRef(null);
  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state, prev) => {
      if (state.isEditorFullscreen === prev.isEditorFullscreen) return;
      fsAnimation.current?.stop();
      fsAnimation.current = animate(fs, state.isEditorFullscreen ? 1 : 0, FULLSCREEN_TWEEN);
    });
    return () => {
      unsubscribe();
      fsAnimation.current?.stop();
    };
  }, [fs]);
  const fsClamped = useTransform(fs, (v) => Math.min(1, Math.max(0, v)));

  const [isMockPanelOpen, setIsMockPanelOpen] = useState(false);
  const [panelContent, setPanelContent] = useState('');

  // panelLayoutP = 500ms "make room" progress. Floating: the panel is full width from frame 0 and
  // only fades in; this progress moves the row and the editor. Full screen: it also drives the width.
  const panelLayoutP = useMotionValue(0);
  const panelFade = useMotionValue(0);
  const panelWidth  = useTransform([panelLayoutP, fsClamped], ([p, v]) => {
    const t = Math.min(1, Math.max(0, v));
    return `calc(${EDITOR_SIDE_PANEL_W} * ${(1 - t) + t * p})`;
  });
  const panelGap    = useTransform([panelLayoutP, fsClamped], ([p, v]) => {
    const t = Math.min(1, Math.max(0, v));
    const gap = EDITOR_SIDE_PANEL_GAP_PX + (8 - EDITOR_SIDE_PANEL_GAP_PX) * t;
    return `${gap * ((1 - t) + t * p)}px`;
  });
  // Row and editor width share this progress. Keep them on motion values: moving either onto a CSS
  // transition makes the two race and the editor snap or bounce.
  const rowMax = useTransform(
    panelLayoutP,
    (v) => `calc(${EDITOR_MAX_W_PX}px + (var(--editor-row-open) - ${EDITOR_MAX_W_PX}px) * ${v})`,
  );
  const panelOpacity = useTransform(panelFade, (v) => v);
  const panelScale   = useTransform(panelFade, (v) => 0.95 + 0.05 * v);
  const panelVisibility = useTransform(panelFade, (v) => (v > 0 ? 'visible' : 'hidden'));
  // Mounted for the whole close (the row finishes after the 250ms fade) and removed at progress 0,
  // so the row doesn't keep the panel's 2px border box.
  const [isPanelRendered, setIsPanelRendered] = useState(false);

  const isEditorOpen = activeTabId !== 'home';
  const isAgentMode = useSearchStore((state) => state.searchMode === 'agent');
  const activeIndex = openTabs.findIndex((t) => t._id === activeTabId);
  const activeTab = openTabs.find((t) => t._id === activeTabId);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMockPanelOpen(false);
    setPanelContent('');
  }, [activeTabId]);

  // Sheet vs side is latched when the panel opens; deriving it live would swap modes mid-view on a
  // resize. Closed, it re-reads the window for the next open.
  const [isSheetMode, setIsSheetMode] = useState(isPanelNarrow);
  useEffect(() => {
    if (isMockPanelOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSheetMode(isPanelNarrow);
  }, [isMockPanelOpen, isPanelNarrow]);
  const desktopPanelOpen = isMockPanelOpen && !isSheetMode;
  // The close takes 500ms; reopening inside that gap must not be unmounted by the old callback.
  const panelOpenRef = useRef(desktopPanelOpen);
  useEffect(() => {
    panelOpenRef.current = desktopPanelOpen;
  }, [desktopPanelOpen]);
  useEffect(() => {
    if (desktopPanelOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsPanelRendered(true);
    }
    // 500ms layout progress; the fade stays 250ms and must not be merged with it. The panel stays
    // mounted until this finishes, so the row can return before it is removed. p ends exactly at 1/0
    // and the row and card read the same value, so the final frame is the final layout.
    const controls = animate(panelLayoutP, desktopPanelOpen ? 1 : 0, {
      ...PANEL_TWEEN,
      onComplete: () => {
        if (!panelOpenRef?.current) setIsPanelRendered(false);
      },
    });
    const fade = animate(panelFade, desktopPanelOpen ? 1 : 0, PANEL_FADE);
    return () => {
      controls.stop();
      fade.stop();
    };
  }, [desktopPanelOpen, panelLayoutP, panelFade]);

  useEffect(() => {
    const warm = preloadMarkdownEditor;
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 1500);
    return () => clearTimeout(id);
  }, []);

  const handleNoteSaved = useCallback((tabId) => {
    closeTab(tabId, true);
  }, [closeTab]);

  const handleSummaryReceived = useCallback((summary) => {
    setPanelContent(summary);
    setIsMockPanelOpen(true);
  }, []);

  const handleToggleMockPanel = useCallback(() => {
    setIsMockPanelOpen((prev) => !prev);
  }, []);

  // The side panel's contents, beside the editor or in the phone sheet (where the title is the place
  // to drag the sheet from)
  const renderPanelBody = ({ onTitlePointerDown, onClose } = {}) => (
    <>
      <button
        type="button"
        onClick={onClose}
        title="Close panel"
        aria-label="Close panel"
        className="absolute right-3 top-3 z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
      >
        <MdClose className="text-lg" />
      </button>
      <h3
        onPointerDown={onTitlePointerDown}
        className={`text-2xl font-medium mb-4 pr-10 pt-2 md:pt-0 ${onTitlePointerDown ? 'touch-none' : ''} ${panelContent ? 'text-[#e85d56]' : 'text-white'}`}
        style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
      >
        {panelContent ? 'Summary' : 'Mock Panel'}
      </h3>

      {panelContent ? (
        <div className="flex-grow bg-[#2a2a2a] rounded-xl border border-[#444] p-5 overflow-y-auto agent-scrollbar break-words text-sm text-stone-300 leading-relaxed font-serif whitespace-pre-wrap">
          {panelContent}
        </div>
      ) : (
        <>
          <p className="text-sm text-stone-400 leading-relaxed mb-6">
            This is a temporary side panel with a dark color scheme.
          </p>
          <div className="flex-grow bg-[#2a2a2a] rounded-xl border border-[#444] p-4 flex items-center justify-center">
            <span className="text-stone-500 text-xs tracking-widest uppercase">Content Area</span>
          </div>
        </>
      )}
    </>
  );

  // (kept while the agent chat is open: the floating ☰ below stands in for the hidden navbar)
  if (!isEditorOpen && openTabs.length === 0 && !isAgentMode) {
    return null;
  }

  return (
    <>
      {/* Persistent Sidebar Hamburger Toggle in Editor Mode, and with the agent chat open (both hide the
          navbar; aligned to exact Home Navbar coordinates) */}
      {(isEditorOpen || isAgentMode) && (
        <div className="fixed top-2.5 sm:top-3.5 left-3 z-[90] flex items-center">
          <button
            onClick={toggleSidebar}
            className="sidebar-toggle-btn w-10 h-10 rounded-full bg-(--page-bg)/85 hover:bg-(--page-bg) backdrop-blur-md text-[#e85d56] hover:text-white border border-white/10 shadow-lg cursor-pointer transition-all duration-150 flex items-center justify-center"
            title={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <FiMenu className="text-2xl" />
          </button>
        </div>
      )}


      {/* Ghost cards — tucked behind active card edges, scaled down for depth */}
      {openTabs.map((tab, index) => {
        const offset = isEditorOpen ? index - activeIndex : Infinity;
        const isAdjacent = Math.abs(offset) === 1;

        if (!isAdjacent || !isEditorOpen || isMockPanelOpen || isFullscreen) return null;

        return (
          <div
            key={`ghost-${tab._id}`}
            className="fixed z-10 animate-ghost-in cursor-pointer group"
            onClick={() => openTab(tab)}
            style={{
              top: isBelowTablet ? '1rem' : '2rem',
              bottom: dockClearance,
              width: isBelowTablet ? '90vw' : '350px',
              ...(offset < 0
                ? { right: isBelowTablet ? 'calc(50% + 15vw)' : 'calc(50% + 401px)', transformOrigin: 'right center' }
                : { left: isBelowTablet ? 'calc(50% + 15vw)' : 'calc(50% + 401px)', transformOrigin: 'left center' }),
              transform: isBelowTablet ? 'scale(0.85)' : 'scale(0.65)',
            }}
          >
            <div className="h-full bg-[#f4eadc] opacity-15 md:opacity-30 group-hover:opacity-100 transition-all duration-150 ease-out rounded-[32px] border border-[#e8dcc8] overflow-hidden p-6 md:p-10 shadow-sm group-hover:shadow-2xl group-active:scale-[0.98]">
              <div className="text-sm font-semibold tracking-widest text-[#999] mb-4 uppercase">
                {/* a draft has no createdAt yet: today, as the editor's own header shows */}
                {(tab.createdAt ? new Date(tab.createdAt) : new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
              <h2
                className="text-3xl font-medium text-[#333] leading-tight mb-4"
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                {tab.title || 'Untitled Note'}
              </h2>

              {tab.tags && tab.tags.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-6 opacity-70">
                  {tab.tags.slice(0, 3).map((tag, i) => (
                    <span key={i} className="text-sm font-medium text-[#777]">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              <p
                className="text-lg text-[#666] leading-relaxed line-clamp-[10]"
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                {(tab.content || '').slice(0, 400)}
              </p>
            </div>
          </div>
        );
      })}

      {/* Active editor — centered (only the active tab is mounted).
          Card ↔ full screen is one spring (--fs) that interpolates the gaps, the widths and the
          chrome. The floating width is interpolated between the closed and open measures (see the
          --editor-card-* vars below), so it only changes by the room that is actually missing.
          The outer layer is a size container with no padding, so 100cqw is the window width. */}
      {activeTab && isEditorOpen && (
        <Motion.div
          className="fixed inset-0 z-20 animate-scale-up pointer-events-none @container"
          style={{
            '--editor-gap': editorGap,
            '--editor-max-w': `${editorMaxW}px`,
            '--editor-card-w': 'min(var(--editor-max-w), 100cqw - 2 * var(--editor-gap))',
            // Closed/open editor measures and the open row. Plain continuous formulas: only the rail
            // and the sheet are discrete switches.
            '--editor-panel-space': EDITOR_SIDE_PANEL_SPACE,
            '--editor-card-closed': 'min(var(--editor-max-w), 100cqw - 2 * var(--editor-gap))',
            '--editor-card-open': 'min(var(--editor-max-w), 100cqw - 2 * max(var(--editor-gap), var(--editor-rail-clear)) - var(--editor-panel-space))',
            '--editor-row-open': `min(calc(${EDITOR_MAX_W_PX}px + ${EDITOR_SIDE_PANEL_SPACE}), calc(100vw - 2 * var(--editor-rail-clear)))`,
            '--panel-p': panelLayoutP,
            '--fs': fsClamped,
            // Both the page gap and the space above the dock ease to the same 8px frame in full screen;
            // the card keeps its rounded corners and shadow (no square, edge-to-edge state).
            '--editor-gap-now': `calc(${editorGap} + (8px - ${editorGap}) * var(--fs))`,
            '--editor-bottom-now': `calc(${dockClearance}px + (8px - ${dockClearance}px) * var(--fs))`,
            '--editor-radius': `${EDITOR_RADIUS_PX}px`,
            '--editor-chrome': 1,
          }}
        >
          {/* Grows from 100% to 100vw: the page reserves a scrollbar gutter (scrollbar-gutter: stable
              on html) that fixed layers are laid out inside of, so filling only the layer would leave
              a strip of page down the right edge on desktop. Phones have overlay scrollbars. */}
          <div
            className="flex justify-center h-full"
            style={{
              width: 'calc(100% + (100vw - 100%) * var(--fs))',
              padding: 'var(--editor-gap-now) var(--editor-gap-now) var(--editor-bottom-now)',
            }}
          >
          {/* Row (editor + panel). Grows from the closed editor width to the open width over the same
              500ms progress; the full-screen spring interpolates that number to the window width. */}
          <Motion.div
            className="editor-row flex flex-col md:flex-row gap-4 md:gap-0 h-full pointer-events-auto w-full"
            style={{ '--editor-row-max': rowMax }}
          >
            {/* Main Editor. Width is interpolated with the same progress as the row: at wide widths
                both ends are 790 so it only slides; narrower, it slides to the rail and gives up the
                rest. */}
            <div
              className="h-full w-full min-w-0"
              style={{
                maxWidth: 'calc(var(--editor-max-w) + (100vw - var(--editor-max-w)) * var(--fs))',
                // Must use the same --panel-p as the row; without it the editor snaps to its smaller
                // measure in one frame.
                minWidth: 'calc((var(--editor-card-closed) + (var(--editor-card-open) - var(--editor-card-closed)) * var(--panel-p)) * (1 - var(--fs)))',
              }}
            >
              {/* externalRev in the key: an outside change (agent edit, revert)
                  remounts the editor so it picks up the new contents. */}
              <TabEditorSlot
                key={`${activeTab._id}:${activeTab.externalRev || 0}`}
                tab={activeTab}
                isActive={true}
                onNoteSaved={handleNoteSaved}
                onToggleMockPanel={handleToggleMockPanel}
                onSummaryReceived={handleSummaryReceived}
              />
            </div>

            {/* Side panel. Floating: full width from mount, so the row slides it in; only the 250ms
                fade/scale is animated on it. Full screen: the width tween. Stays mounted until the
                close progress ends; `inert` keeps it out of the tab order. */}
            {!isSheetMode && isPanelRendered && (
              <Motion.div
                className="shrink-0 h-full bg-[#1e1e1e] rounded-[24px] shadow-xl border border-[#333] overflow-hidden origin-left z-30"
                style={{
                  width: panelWidth,
                  marginLeft: panelGap,
                  opacity: panelOpacity,
                  scale: panelScale,
                  visibility: panelVisibility,
                  pointerEvents: isMockPanelOpen ? 'auto' : 'none',
                }}
                aria-hidden={!isMockPanelOpen}
                inert={!isMockPanelOpen}
              >
                <div className="h-full p-8 flex flex-col text-stone-200 relative" style={{ width: EDITOR_SIDE_PANEL_W }}>
                  {renderPanelBody({ onClose: () => setIsMockPanelOpen(false) })}
                </div>
              </Motion.div>
            )}
            <AnimatePresence>
              {isMockPanelOpen && isSheetMode && (
                <BottomSheet key="editor-panel-sheet" onClose={() => setIsMockPanelOpen(false)} heightShare={0.6} className="text-stone-200">
                  {(startDrag) => (
                    <div className="flex-1 min-h-0 flex flex-col px-6 pb-6 relative">{renderPanelBody({ onTitlePointerDown: startDrag, onClose: () => setIsMockPanelOpen(false) })}</div>
                  )}
                </BottomSheet>
              )}
            </AnimatePresence>
          </Motion.div>
          </div>
        </Motion.div>
      )}
    </>
  );
};

export default GlobalEditorOverlay;
