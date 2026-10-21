import React, { useState, useEffect, useCallback, memo } from 'react';
import { motion as Motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { FiMenu } from 'react-icons/fi';
import { useTabsStore } from '../../store/useTabsStore';
import { useUIStore } from '../../store/useUIStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { BELOW_TABLET_QUERY } from '../../constants/breakpoints';
import { DOCK_METRICS, DOCK_MOBILE_QUERY, getEditorClearance } from '../TabDock/dockMetrics';
import BottomSheet from '../Modals/BottomSheet';
import { EDITOR_CARD_STYLE, EDITOR_RADIUS_PX } from './editorChrome';

// The editor loads with the app; only its text area (CodeMirror, ~600 kB) is a separate chunk,
// fetched on idle after the layout mounts (and when a note card is pressed): markdownEditorLoader
import AddEditNotes from '../../pages/Home/AddEditNotes';
import { preloadMarkdownEditor } from './markdownEditorLoader';

// Card mode: the gap around the card, and its max width (phone = below the tablet breakpoint)
const EDITOR_GAP_PX   = { phone: 8, desktop: 16 };
const EDITOR_MAX_W_PX = { phone: 768, desktop: 790 };
const EDITOR_ROW_MAX_WITH_PANEL_PX = 1170; // card + side panel (desktop)
// Card ↔ full screen. A large surface: a touch of bounce so it lands rather than crawls in.
const FULLSCREEN_SPRING = { type: 'spring', visualDuration: 0.32, bounce: 0.12 };

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
  const dockClearance = getEditorClearance(isDockMobile ? DOCK_METRICS.mobile : DOCK_METRICS.desktop);
  const editorGap  = isBelowTablet ? EDITOR_GAP_PX.phone : EDITOR_GAP_PX.desktop;
  const editorMaxW = isBelowTablet ? EDITOR_MAX_W_PX.phone : EDITOR_MAX_W_PX.desktop;

  // Card ↔ full-screen progress. Starts at the remembered mode, so opening an editor that's already
  // full screen doesn't animate. Gaps are rounded to whole pixels (sub-pixel edges make the text
  // re-snap to the pixel grid each frame — the dock's jitter lesson); corners and fades needn't be.
  // The target follows the store directly (not a React effect, which runs only after the re-render
  // has painted), so the motion starts on the next frame after the click.
  const fsTarget = useMotionValue(isFullscreen ? 1 : 0);
  const fs       = useSpring(fsTarget, FULLSCREEN_SPRING);
  useEffect(() => useUIStore.subscribe((state, prev) => {
    if (state.isEditorFullscreen !== prev.isEditorFullscreen) fsTarget.set(state.isEditorFullscreen ? 1 : 0);
  }), [fsTarget]);
  const fsClamped = useTransform(fs, (v) => Math.min(1, Math.max(0, v)));
  const gapNow    = useTransform(fs, (v) => `${Math.max(0, Math.round(editorGap * (1 - v)))}px`);
  const bottomNow = useTransform(fs, (v) => `${Math.max(0, Math.round(dockClearance * (1 - v)))}px`);
  const radiusNow = useTransform(fs, (v) => `${Math.max(0, EDITOR_RADIUS_PX * (1 - v))}px`);
  const chromeNow = useTransform(fsClamped, (v) => 1 - v);

  const [isMockPanelOpen, setIsMockPanelOpen] = useState(false);
  const [panelContent, setPanelContent] = useState('');

  const isEditorOpen = activeTabId !== 'home';
  const activeIndex = openTabs.findIndex((t) => t._id === activeTabId);
  const activeTab = openTabs.find((t) => t._id === activeTabId);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMockPanelOpen(false);
    setPanelContent('');
  }, [activeTabId]);

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
  const renderPanelBody = (onTitlePointerDown) => (
    <>
      <h3
        onPointerDown={onTitlePointerDown}
        className={`text-2xl font-medium mb-4 pt-2 md:pt-0 ${onTitlePointerDown ? 'touch-none' : ''} ${panelContent ? 'text-[#d97757]' : 'text-white'}`}
        style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
      >
        {panelContent ? 'Summary' : 'Mock Panel'}
      </h3>

      {panelContent ? (
        <div className="flex-grow bg-[#2a2a2a] rounded-xl border border-[#444] p-5 overflow-y-auto editor-scrollbar text-sm text-stone-300 leading-relaxed font-serif whitespace-pre-wrap">
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

  if (!isEditorOpen && openTabs.length === 0) {
    return null;
  }

  return (
    <>
      {/* Persistent Sidebar Hamburger Toggle in Editor Mode (aligned to exact Home Navbar coordinates) */}
      {isEditorOpen && (
        <div className="fixed top-2.5 md:top-4 left-3 z-[90] flex items-center">
          <button
            onClick={toggleSidebar}
            className="sidebar-toggle-btn w-10 h-10 rounded-full bg-(--page-bg)/85 hover:bg-(--page-bg) backdrop-blur-md text-[#dd5e57] hover:text-white border border-white/10 shadow-lg cursor-pointer transition-all duration-150 flex items-center justify-center"
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
                {tab.createdAt
                  ? new Date(tab.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : '17 MAY'}
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

              {tab.isChecklist && tab.checklist?.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {tab.checklist.slice(0, 6).map((item, i) => (
                    <div key={i} className="flex items-center gap-3 text-lg text-[#555]">
                      <div
                        className={`w-4 h-4 rounded-sm border-2 border-[#aaa] flex-shrink-0 ${
                          item.completed ? 'bg-[#aaa]' : ''
                        }`}
                      />
                      <span className={`truncate ${item.completed ? 'line-through opacity-50' : ''}`}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p
                  className="text-lg text-[#666] leading-relaxed line-clamp-[10]"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                >
                  {(tab.content || '').slice(0, 400)}
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* Active editor — centered (only active tab is mounted in the DOM).
          Card ↔ full screen is one spring (--fs: 0 = card, 1 = full screen) that every size here
          is interpolated along: the gap around the card, the space above the dock, the widths, and
          the card's corners/border/shadow (editorChrome.js). The card-mode width is defined once,
          as --editor-card-w; the editor's text column (.editor-column in index.css) is always that
          card's inner width, centred — so the text never changes width or re-wraps.
          The outer layer is a size container with no padding, so 100cqw is the window width. */}
      {activeTab && isEditorOpen && (
        <Motion.div
          className="fixed inset-0 z-20 animate-scale-up pointer-events-none @container"
          style={{
            '--editor-gap': `${editorGap}px`,
            '--editor-max-w': `${editorMaxW}px`,
            '--editor-card-w': 'min(var(--editor-max-w), 100cqw - 2 * var(--editor-gap))',
            '--fs': fsClamped,
            '--editor-gap-now': gapNow,
            '--editor-bottom-now': bottomNow,
            '--editor-radius': radiusNow,
            '--editor-chrome': chromeNow,
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
          {/* Row (editor + panel). Its card-mode max width widens when the panel opens; that's a CSS
              transition on --editor-row-max (index.css), separate from the full-screen spring. */}
          <div
            className="editor-row flex flex-col md:flex-row gap-4 h-full pointer-events-auto w-full"
            style={{ '--editor-row-max': isMockPanelOpen && !isBelowTablet ? `${EDITOR_ROW_MAX_WITH_PANEL_PX}px` : 'var(--editor-max-w)' }}
          >
            {/* Main Editor */}
            <div
              className="h-full w-full min-w-0"
              style={{ maxWidth: 'calc(var(--editor-max-w) + (100vw - var(--editor-max-w)) * var(--fs))' }}
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

            {/* Side panel: beside the editor on wider screens, a bottom sheet on phones (the shared
                BottomSheet — pulled down to close, its title the place to drag from) */}
            <AnimatePresence>
              {isMockPanelOpen && !isBelowTablet && (
                <Motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  transition={{ type: 'tween', ease: 'easeOut', duration: 0.25 }}
                  className="md:w-[350px] shrink-0 h-full bg-[#1e1e1e] rounded-[24px] shadow-xl border border-[#333] p-8 flex flex-col text-stone-200 origin-left z-30"
                >
                  {renderPanelBody()}
                </Motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {isMockPanelOpen && isBelowTablet && (
                <BottomSheet key="editor-panel-sheet" onClose={() => setIsMockPanelOpen(false)} heightShare={0.6} className="text-stone-200">
                  {(startDrag) => (
                    <div className="flex-1 min-h-0 flex flex-col px-6 pb-6">{renderPanelBody(startDrag)}</div>
                  )}
                </BottomSheet>
              )}
            </AnimatePresence>
          </div>
          </div>
        </Motion.div>
      )}
    </>
  );
};

export default GlobalEditorOverlay;
