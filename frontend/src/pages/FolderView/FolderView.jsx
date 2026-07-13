import React, { useState, useEffect, useCallback, useMemo, memo, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import NotesGrid from '../../components/Cards/NotesGrid';
import AiSearchPanel from '../../components/Cards/AiSearchPanel';
import useNoteOperations from '../../hooks/useNoteOperations';
import AddEditNotes from '../Home/AddEditNotes';
import Toast from '../../components/ToastMessage/Toast';
import { useNotesStore } from '../../store/useNotesStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import FolderCard from '../../components/Cards/FolderCard';
import Breadcrumb from '../../components/Cards/Breadcrumb';
import { useModalStore } from '../../components/Modals/useModalStore';
import { MdFolderOpen, MdOutlineFolder, MdOutlineStickyNote2, MdAdd, MdFolder } from 'react-icons/md';

const TabEditorSlot = memo(({ tab, isActive, onNoteSaved, showToastMessage, onToggleMockPanel, onSummaryReceived }) => {
  const { closeTab, updateTabState } = useTabsStore();

  const handleUpdateTabState = useCallback(
    (patchedFields) => {
      updateTabState(tab._id, patchedFields);
    },
    [tab._id, updateTabState]
  );

  const handleClose = useCallback(() => {
    closeTab(tab._id);
  }, [tab._id, closeTab]);

  const handleSaveSuccess = useCallback(() => {
    onNoteSaved(tab._id);
  }, [tab._id, onNoteSaved]);

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

const FolderView = () => {
  const { folderId } = useParams();
  const navigate = useNavigate();

  const { getViewNotes, isViewLoading, refreshActiveView } = useNotesStore();
  // Read notes directly from the per-folder cache — no stale cross-view data
  const folderNotes = getViewNotes(folderId);
  const isLoading = isViewLoading(folderId);
  const { searchMode, semanticResult, isSearchingAI, setSearchScope, setScopeFolderIds } = useSearchStore();
  const { openTabs, activeTabId, openTab, closeTab } = useTabsStore();
  const { folders, editFolder, getSubtreeIds, setActiveFolderId, createFolder } = useFoldersStore();

  const [showToast, setShowToast] = useState(false);
  const [isMockPanelOpen, setIsMockPanelOpen] = useState(false);
  const [panelContent, setPanelContent] = useState("");
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderNameInline, setNewFolderNameInline] = useState('');
  const { openFolderDeleteModal, openConfirmModal } = useModalStore();
  const [toastMessageVisibility, setToastMessageVisibility] = useState({
    isShown: false,
    message: '',
    type: 'add',
  });

  const subtreeIds = useMemo(() => getSubtreeIds(folderId), [folderId, getSubtreeIds]);

  // Redirect if folder doesn't exist
  useEffect(() => {
    if (folders.length > 0 && !folders.some(f => f._id === folderId)) {
      navigate("/dashboard");
    }
  }, [folderId, folders, navigate]);

  // Set active folder & search scope context
  useEffect(() => {
    setActiveFolderId(folderId);
    setSearchScope("folder");
    setScopeFolderIds(subtreeIds);
    return () => {
      setActiveFolderId(null);
      setSearchScope("home");
      setScopeFolderIds([]);
    };
  }, [folderId, subtreeIds, setSearchScope, setScopeFolderIds, setActiveFolderId]);

  // Fetch this folder's notes; cache means re-visiting shows old data instantly
  const loadNotes = useCallback(() => {
    refreshActiveView();
  }, [refreshActiveView]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

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

  const handleNoteSaved = useCallback((tabId) => {
    closeTab(tabId);
    loadNotes();
  }, [closeTab, loadNotes]);

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

  // Use hook note operations
  const { deleteNote, updateNoteArchive, handleChecklistToggle } = useNoteOperations(loadNotes, showToastMessage);

  const isEditorOpen = activeTabId !== 'home';
  const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);
  const activeIndex = openTabs.findIndex(t => t._id === activeTabId);

  // Subfolders list (direct children only)
  const subfolders = folders.filter(f => f.parentId === folderId && !f.isDeleted)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  
  // folderNotes is already the subtree for this folder from the cache
  // For explorer mode: direct notes only; for flat mode: the full subtree
  const directNotes = folderNotes.filter(n => n.folderId === folderId);

  const handleRenameFolder = async (id, newName) => {
    await editFolder(id, { name: newName });
  };

  const handleColorChangeFolder = async (id, color) => {
    await editFolder(id, { color });
  };

  const handleDeleteFolder = (folderObj) => {
    openFolderDeleteModal(folderObj, () => showToastMessage("Folder moved to Trash", "delete"));
  };

  const handleDeleteNoteClick = (note) => {
    openConfirmModal({
      title: "Delete note?",
      message: "This moves the note to Trash.",
      onConfirm: () => deleteNote(note)
    });
  };

  return (
    <div className={`relative ${isEditorOpen ? 'h-screen overflow-hidden' : 'min-h-0'}`}>
      {/* Main Content Area */}
      <div className={isEditorOpen ? 'hidden' : 'pb-24 px-2 md:px-4'}>
        <div className="mb-4">
          <Breadcrumb folderId={folderId} />
        </div>
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
                  loading={isLoading}
                  emptyMessage="No matching notes found."
                  onEdit={handleEdit}
                  onDelete={handleDeleteNoteClick}
                  onArchive={updateNoteArchive}
                  onChecklistToggle={handleChecklistToggle}
                />
              )}
            </div>
            <div className="w-full md:w-1/3 shrink-0">
              <AiSearchPanel />
            </div>
          </div>
        ) : (
          <div>
            <div className="space-y-8">
              <div>
                <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-4 flex items-center">
                  <MdOutlineFolder className="mr-2" size={16} />
                  Folders
                </h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4">
                  {subfolders.map(folder => (
                    <FolderCard
                      key={folder._id}
                      folder={folder}
                      onRename={handleRenameFolder}
                      onColorChange={handleColorChangeFolder}
                      onDelete={handleDeleteFolder}
                    />
                  ))}
                  {isAddingFolder ? (
                    <div 
                      key="inline-add-folder-card"
                      className="group relative physical-folder-card p-5 select-none flex flex-col h-[150px] justify-between"
                    >
                      <div 
                        className="p-3 rounded-xl inline-flex items-center justify-center shadow-sm self-start"
                        style={{ backgroundColor: '#e85d5620', color: '#e85d56' }}
                      >
                        <MdFolder size={26} />
                      </div>
                      <div className="mt-auto relative z-10">
                        <input
                          autoFocus
                          type="text"
                          placeholder="Folder name..."
                          value={newFolderNameInline}
                          onChange={(e) => setNewFolderNameInline(e.target.value)}
                          onBlur={async () => {
                            if (newFolderNameInline.trim()) {
                              await createFolder(newFolderNameInline.trim(), folderId);
                            }
                            setIsAddingFolder(false);
                            setNewFolderNameInline('');
                          }}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              if (newFolderNameInline.trim()) {
                                  await createFolder(newFolderNameInline.trim(), folderId);
                              }
                              setIsAddingFolder(false);
                              setNewFolderNameInline('');
                            } else if (e.key === 'Escape') {
                              setIsAddingFolder(false);
                              setNewFolderNameInline('');
                            }
                          }}
                          className="bg-[#2a2b2e] text-white text-md outline-none border border-[#e85d56] px-3 py-1.5 rounded-lg w-full font-medium shadow-inner"
                        />
                      </div>
                    </div>
                  ) : (
                    <div 
                        key="new-folder-placeholder-card"
                        onClick={() => setIsAddingFolder(true)}
                        className="group relative cursor-pointer transition-transform duration-300 select-none flex flex-col h-[150px] items-center justify-center hover:-translate-y-1 mt-6"
                    >
                        {/* SVG draws a single continuous dashed folder tab outline */}
                        <svg
                            className="absolute w-full pointer-events-none"
                            style={{ height: '174px', top: '-24px', left: 0, overflow: 'visible' }}
                            viewBox="0 0 320 174"
                            preserveAspectRatio="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                className="transition-colors duration-300 group-hover:stroke-[#5a5f63]"
                                d="M 0,158 L 0,16 A 16,16 0 0 1 16,0 L 136,0 C 152,0 160,24 176,24 L 304,24 A 16,16 0 0 1 320,40 L 320,158 A 16,16 0 0 1 304,174 L 16,174 A 16,16 0 0 1 0,158 Z"
                                fill="none"
                                stroke="#3c4043"
                                strokeWidth="2"
                                strokeDasharray="6 4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                            />
                        </svg>
                        <div className="relative z-10 p-4 rounded-full bg-[#3c4043]/30 text-gray-400 group-hover:text-[#e85d56] group-hover:bg-[#e85d56]/10 transition-colors duration-300">
                            <MdAdd size={32} />
                        </div>
                        <span className="relative z-10 mt-3 text-sm font-medium text-gray-500 group-hover:text-gray-300 transition-colors">New Folder</span>
                    </div>
                  )}
                </div>
              </div>

              {directNotes.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-4 flex items-center">
                    <MdOutlineStickyNote2 className="mr-2" size={16} />
                    Notes
                  </h3>
                  <NotesGrid
                    notes={directNotes}
                    loading={isLoading}
                    emptyMessage="No notes in this folder."
                    onEdit={handleEdit}
                    onDelete={handleDeleteNoteClick}
                    onArchive={updateNoteArchive}
                    onChecklistToggle={handleChecklistToggle}
                    hideFolderBadge={true}
                  />
                </div>
              )}

              {!isLoading && subfolders.length === 0 && directNotes.length === 0 && (
                <div className="flex flex-col items-center justify-center mt-20 opacity-50">
                  <p className="text-sm font-medium text-slate-400 text-center">
                    This folder is empty.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {openTabs.map((tab, index) => {
        const offset = isEditorOpen ? index - activeIndex : Infinity;
        const isActive = offset === 0;
        const isAdjacent = Math.abs(offset) === 1;

        return (
          <Fragment key={tab._id}>
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

            {isActive && (
              <div className="fixed inset-0 flex justify-center px-2 md:px-4 pt-2 md:pt-4 pb-16 md:pb-14 z-10 animate-scale-up pointer-events-none">
                <div className={`flex flex-col md:flex-row gap-4 h-full pointer-events-auto transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] w-full ${isMockPanelOpen ? 'md:max-w-[1150px] max-w-3xl' : 'max-w-3xl'}`}>
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

                  <AnimatePresence>
                    {isMockPanelOpen && (
                      <>
                        <Motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] md:hidden"
                          onClick={() => setIsMockPanelOpen(false)}
                        />

                        <Motion.div
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
                          <h3 className={`text-2xl font-medium mb-4 ${panelContent ? 'text-[#d97757]' : 'text-white'}`} style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>{panelContent ? 'Summary' : 'Mock Panel'}</h3>
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
                        </Motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}

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
                <div className="h-full bg-[#f4eadc] opacity-15 md:opacity-30 group-hover:opacity-100 transition-all duration-150 ease-out rounded-[32px] border border-[#e8dcc8] overflow-hidden p-6 md:p-10 shadow-sm group-hover:shadow-2xl">
                  <h2 className="text-3xl font-medium text-[#333] leading-tight mb-4" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                    {tab.title || 'Untitled Note'}
                  </h2>
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

export default FolderView;
