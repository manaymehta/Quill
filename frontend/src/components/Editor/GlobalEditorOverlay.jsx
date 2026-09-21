import React, { useState, useEffect, useCallback, memo } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { FiMenu } from 'react-icons/fi';
import AddEditNotes from '../../pages/Home/AddEditNotes';
import { useTabsStore } from '../../store/useTabsStore';
import { useUIStore } from '../../store/useUIStore';

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
            className="sidebar-toggle-btn w-10 h-10 rounded-full bg-[#202124]/85 hover:bg-[#202124] backdrop-blur-md text-[#dd5e57] hover:text-white border border-white/10 shadow-lg cursor-pointer transition-all duration-150 flex items-center justify-center"
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

        if (!isAdjacent || !isEditorOpen || isMockPanelOpen) return null;

        return (
          <div
            key={`ghost-${tab._id}`}
            className="fixed z-10 animate-ghost-in cursor-pointer group"
            onClick={() => openTab(tab)}
            style={{
              top: window.innerWidth < 768 ? '1rem' : '2rem',
              bottom: window.innerWidth < 768 ? '54px' : '52px',
              width: window.innerWidth < 768 ? '90vw' : '350px',
              ...(offset < 0
                ? { right: window.innerWidth < 768 ? 'calc(50% + 15vw)' : 'calc(50% + 411px)', transformOrigin: 'right center' }
                : { left: window.innerWidth < 768 ? 'calc(50% + 15vw)' : 'calc(50% + 411px)', transformOrigin: 'left center' }),
              transform: window.innerWidth < 768 ? 'scale(0.85)' : 'scale(0.65)',
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

      {/* Active editor — centered (only active tab is mounted in the DOM) */}
      {activeTab && isEditorOpen && (
        <div className="fixed inset-0 flex justify-center px-2 md:px-4 pt-2 md:pt-4 pb-[54px] md:pb-[52px] z-20 animate-scale-up pointer-events-none">
          <div
            className={`flex flex-col md:flex-row gap-4 h-full pointer-events-auto transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] w-full ${
              isMockPanelOpen ? 'md:max-w-[1190px] max-w-3xl md:max-w-[810px]' : 'max-w-3xl md:max-w-[810px]'
            }`}
          >
            {/* Main Editor */}
            <div className="w-full h-full max-w-3xl md:max-w-[810px] shrink-0">
              <TabEditorSlot
                key={activeTab._id}
                tab={activeTab}
                isActive={true}
                onNoteSaved={handleNoteSaved}
                onToggleMockPanel={handleToggleMockPanel}
                onSummaryReceived={handleSummaryReceived}
              />
            </div>

            {/* Mock Side Panel (Becomes Bottom Sheet on Mobile) */}
            <AnimatePresence>
              {isMockPanelOpen && (
                <>
                  {/* Mobile Backdrop for Bottom Sheet */}
                  <Motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[25] md:hidden"
                    onClick={() => setIsMockPanelOpen(false)}
                  />

                  <Motion.div
                    initial={{
                      y: window.innerWidth < 768 ? '100%' : 0,
                      scale: window.innerWidth < 768 ? 1 : 0.95,
                      opacity: window.innerWidth < 768 ? 1 : 0,
                    }}
                    animate={{ y: 0, scale: 1, opacity: 1 }}
                    exit={{
                      y: window.innerWidth < 768 ? '100%' : 0,
                      scale: window.innerWidth < 768 ? 1 : 0.95,
                      opacity: window.innerWidth < 768 ? 1 : 0,
                    }}
                    transition={{ type: 'tween', ease: 'easeOut', duration: 0.25 }}
                    drag={window.innerWidth < 768 ? 'y' : false}
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={0.2}
                    onDragEnd={(e, info) => {
                      if (info.offset.y > 100 || info.velocity.y > 500) {
                        setIsMockPanelOpen(false);
                      }
                    }}
                    className="fixed md:static inset-x-0 bottom-0 md:bottom-auto md:w-[350px] shrink-0 h-[60vh] md:h-full bg-[#1e1e1e] rounded-t-[32px] md:rounded-[24px] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] md:shadow-xl border-t md:border border-[#333] p-6 md:p-8 flex flex-col text-stone-200 origin-bottom md:origin-left z-30"
                  >
                    <div
                      className="w-12 h-1.5 bg-[#444] rounded-full mx-auto mb-6 md:hidden cursor-grab active:cursor-grabbing"
                      onClick={() => setIsMockPanelOpen(false)}
                    />

                    <h3
                      className={`text-2xl font-medium mb-4 ${panelContent ? 'text-[#d97757]' : 'text-white'}`}
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
                  </Motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </>
  );
};

export default GlobalEditorOverlay;
