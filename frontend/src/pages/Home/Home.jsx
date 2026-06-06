import { useState, useEffect, useCallback, memo, Fragment } from 'react';
import { AnimatePresence } from 'framer-motion';
import NotesGrid from '../../components/Cards/NotesGrid';
import AiSearchPanel from '../../components/Cards/AiSearchPanel';
import useNoteOperations from '../../hooks/useNoteOperations';
import AddEditNotes from './AddEditNotes';
import Toast from '../../components/ToastMessage/Toast';
import { useNotesStore } from '../../store/useNotesStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useTabsStore } from '../../store/useTabsStore';
import './Modal.css';


const TabEditorSlot = memo(({ tab, isActive, onNoteSaved, showToastMessage, onToggleMockPanel, onSummaryReceived }) => {
  const { closeTab, updateTabState } = useTabsStore();

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
      showToastMessage={showToastMessage}
      onToggleMockPanel={onToggleMockPanel}
      onSummaryReceived={onSummaryReceived}
    />
  );
});
TabEditorSlot.displayName = 'TabEditorSlot';


const Home = () => {
  const { allNotes, getAllNotes } = useNotesStore();
  const { searchMode, semanticResult, isSearchingAI } = useSearchStore();
  const { openTabs, activeTabId, openTab, closeTab } = useTabsStore();

  const [showToast, setShowToast] = useState(false);
  const [isMockPanelOpen, setIsMockPanelOpen] = useState(false);
  const [panelContent, setPanelContent] = useState("");
  const [toastMessageVisibility, setToastMessageVisibility] = useState({
    isShown: false,
    message: '',
    type: 'add',
  });

  // Reset side panel when switching between tabs
  useEffect(() => {
    setIsMockPanelOpen(false);
    setPanelContent("");
  }, [activeTabId]);


  const showToastMessage = useCallback((message, type) => {
    setToastMessageVisibility({ isShown: true, message, type });
    setShowToast(true);
  }, []);

  const handleCloseToast = useCallback(() => {
    setToastMessageVisibility((prev) => ({ ...prev, isShown: false }));
    setTimeout(() => setShowToast(false), 400);
  }, []);

  // Zustand actions are stable references — safe as useCallback deps
  const handleNoteSaved = useCallback((tabId) => {
    closeTab(tabId);
    getAllNotes();
  }, [closeTab, getAllNotes]);

  useEffect(() => {
    if (toastMessageVisibility.isShown) {
      const t = setTimeout(handleCloseToast, 3000);
      return () => clearTimeout(t);
    }
  }, [toastMessageVisibility.isShown, handleCloseToast]);

  const handleEdit = useCallback((note) => openTab(note), [openTab]);

  const handleSummaryReceived = useCallback((summary) => {
    setPanelContent(summary);
    setIsMockPanelOpen(true);
  }, []);

  const { deleteNote, updateIsPinned, updateNoteArchive, handleChecklistToggle } =
    useNoteOperations(getAllNotes, showToastMessage);

  const isEditorOpen = activeTabId !== 'home';
  const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);
  const activeIndex = openTabs.findIndex(t => t._id === activeTabId);

  return (
    <div className={`relative ${isEditorOpen ? 'h-screen overflow-hidden' : 'min-h-[calc(100vh-80px)]'}`}>

      {/* Notes grid */}
      <div className={isEditorOpen ? 'hidden' : 'pb-24 px-2 md:px-4'}>
        {isAIMode ? (
          <div className="flex flex-col-reverse md:flex-row gap-4">
            <div className="flex-1 min-w-0">
              {isSearchingAI ? (
                <div className="flex flex-col items-center justify-center mt-20 opacity-50 animate-pulse">
                   <p className="text-sm font-medium text-slate-400 text-center">
                     Analyzing context across your notes...
                   </p>
                </div>
              ) : (
                <NotesGrid
                  notes={semanticResult?.sourceNotes || []}
                  emptyMessage="No matching notes found."
                  onEdit={handleEdit}
                  onDelete={deleteNote}
                  onPin={updateIsPinned}
                  onArchive={updateNoteArchive}
                  onChecklistToggle={handleChecklistToggle}
                />
              )}
            </div>
            <div className="w-full md:w-72 shrink-0">
              <AiSearchPanel />
            </div>
          </div>
        ) : (
          <NotesGrid
            notes={allNotes}
            emptyMessage={"It's quiet here… Start by adding a note."}
            onEdit={handleEdit}
            onDelete={deleteNote}
            onPin={updateIsPinned}
            onArchive={updateNoteArchive}
            onChecklistToggle={handleChecklistToggle}
          />
        )}
      </div>

      {/* Editor tabs */}
      {openTabs.map((tab, index) => {
        const offset = isEditorOpen ? index - activeIndex : Infinity;
        const isActive = offset === 0;
        const isAdjacent = Math.abs(offset) === 1;

        return (
          <Fragment key={tab._id}>

            {/* Hidden editor instance */}
            {!isActive && (
              <div className="hidden">
                <TabEditorSlot
                  tab={tab}
                  isActive={false}
                  onNoteSaved={handleNoteSaved}
                  showToastMessage={showToastMessage}
                />
              </div>
            )}

            {/* Active editor — centered */}
            {isActive && (
              <div className="fixed inset-0 flex justify-center px-2 md:px-4 pt-2 md:pt-4 pb-16 md:pb-14 z-10 animate-scale-up pointer-events-none">
                <div className={`flex flex-col md:flex-row gap-4 h-full pointer-events-auto transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] w-full ${isMockPanelOpen ? 'md:max-w-[1150px] max-w-3xl' : 'max-w-3xl'}`}>

                  {/* Main Editor */}
                  <div className="w-full h-full md:max-w-3xl shrink-0">
                    <TabEditorSlot
                      tab={tab}
                      isActive={true}
                      onNoteSaved={handleNoteSaved}
                      showToastMessage={showToastMessage}
                      onToggleMockPanel={() => setIsMockPanelOpen(prev => !prev)}
                      onSummaryReceived={handleSummaryReceived}
                    />
                  </div>

                  {/* Mock Side Panel (Becomes Bottom Sheet on Mobile) */}
                  <AnimatePresence>
                    {isMockPanelOpen && (
                      <>
                        {/* Mobile Backdrop for Bottom Sheet */}
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] md:hidden"
                          onClick={() => setIsMockPanelOpen(false)}
                        />

                        <motion.div
                          initial={{ y: window.innerWidth < 768 ? '100%' : 0, scale: window.innerWidth < 768 ? 1 : 0.95, opacity: window.innerWidth < 768 ? 1 : 0 }}
                          animate={{ y: 0, scale: 1, opacity: 1 }}
                          exit={{ y: window.innerWidth < 768 ? '100%' : 0, scale: window.innerWidth < 768 ? 1 : 0.95, opacity: window.innerWidth < 768 ? 1 : 0 }}
                          transition={{ type: 'tween', ease: 'easeOut', duration: 0.25 }}
                          drag={window.innerWidth < 768 ? "y" : false}
                          dragConstraints={{ top: 0, bottom: 0 }}
                          dragElastic={0.2}
                          onDragEnd={(e, info) => {
                            if (info.offset.y > 100 || info.velocity.y > 500) {
                              setIsMockPanelOpen(false);
                            }
                          }}
                          className="fixed md:static inset-x-0 bottom-0 md:bottom-auto md:w-[350px] shrink-0 h-[60vh] md:h-full bg-[#1e1e1e] rounded-t-[32px] md:rounded-[24px] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] md:shadow-xl border-t md:border border-[#333] p-6 md:p-8 flex flex-col text-stone-200 origin-bottom md:origin-left z-[70]"
                        >

                          <div className="w-12 h-1.5 bg-[#444] rounded-full mx-auto mb-6 md:hidden cursor-grab active:cursor-grabbing" onClick={() => setIsMockPanelOpen(false)}></div>

                          <h3 className={`text-2xl font-medium mb-4 ${panelContent ? 'text-[#d97757]' : 'text-white'}`} style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>{panelContent ? 'AI Summary' : 'Mock Panel'}</h3>

                          {panelContent ? (
                            <div className="flex-grow bg-[#2a2a2a] rounded-xl border border-[#444] p-5 overflow-y-auto editor-scrollbar text-sm text-stone-300 leading-relaxed font-serif whitespace-pre-wrap">
                              {panelContent}
                            </div>
                          ) : (
                            <>
                              <p className="text-sm text-stone-400 leading-relaxed mb-6">This is a temporary side panel with a dark color scheme.</p>
                              <div className="flex-grow bg-[#2a2a2a] rounded-xl border border-[#444] p-4 flex items-center justify-center">
                                <span className="text-stone-500 text-xs tracking-widest uppercase">Content Area</span>
                              </div>
                            </>
                          )}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>

                </div>
              </div>
            )}

            {/* Ghost card — tucked behind active card edges, scaled down for depth */}
            {isAdjacent && isEditorOpen && !isMockPanelOpen && (
              <div
                className="fixed z-0 animate-ghost-in cursor-pointer group"
                onClick={() => openTab(tab)}
                style={{
                  top: window.innerWidth < 768 ? '1rem' : '2rem',
                  bottom: window.innerWidth < 768 ? '5.5rem' : '4.5rem',
                  width: window.innerWidth < 768 ? '90vw' : '350px',
                  ...(offset < 0
                    ? { right: window.innerWidth < 768 ? 'calc(50% + 15vw)' : 'calc(50% + 390px)', transformOrigin: 'right center' }
                    : { left: window.innerWidth < 768 ? 'calc(50% + 15vw)' : 'calc(50% + 390px)', transformOrigin: 'left center' }
                  ),
                  transform: window.innerWidth < 768 ? 'scale(0.85)' : 'scale(0.65)',
                }}
              >
                <div className="h-full bg-[#f4eadc] opacity-15 md:opacity-30 group-hover:opacity-100 transition-all duration-150 ease-out rounded-[32px] border border-[#e8dcc8] overflow-hidden p-6 md:p-10 shadow-sm group-hover:shadow-2xl group-active:scale-[0.98]">
                  <div className="text-sm font-semibold tracking-widest text-[#999] mb-4 uppercase">
                    {tab.createdAt ? new Date(tab.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '17 MAY'}
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
                        <span key={i} className="text-sm font-medium text-[#777]">#{tag}</span>
                      ))}
                    </div>
                  )}

                  {tab.isChecklist && tab.checklist?.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {tab.checklist.slice(0, 6).map((item, i) => (
                        <div key={i} className="flex items-center gap-3 text-lg text-[#555]">
                          <div className={`w-4 h-4 rounded-sm border-2 border-[#aaa] flex-shrink-0 ${item.completed ? 'bg-[#aaa]' : ''}`} />
                          <span className={`truncate ${item.completed ? 'line-through opacity-50' : ''}`}>{item.text}</span>
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
            )}

          </Fragment>
        );
      })}

      {showToast && (
        <Toast
          isShown={toastMessageVisibility.isShown}
          message={toastMessageVisibility.message}
          type={toastMessageVisibility.type}
          onClose={handleCloseToast}
        />
      )}
    </div>
  );
};

export default Home;
