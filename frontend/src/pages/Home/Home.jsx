import { useState, useEffect } from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import AiSearchPanel from '../../components/Cards/AiSearchPanel';
import useNoteOperations from '../../hooks/useNoteOperations';
import AddEditNotes from './AddEditNotes';
import Toast from '../../components/ToastMessage/Toast';
import { useNotesStore } from '../../store/useNotesStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useTabsStore } from '../../store/useTabsStore';
import './Modal.css';

const Home = () => {
  const { allNotes, getAllNotes } = useNotesStore();
  const { searchMode, semanticResult, isSearchingAI } = useSearchStore();
  const { openTabs, activeTabId, openTab, closeTab, updateTabState } = useTabsStore();

  const [showToast, setShowToast] = useState(false);
  const [toastMessageVisibility, setToastMessageVisibility] = useState({
    isShown: false,
    message: '',
    type: 'add'
  });

  const showToastMessage = (message, type) => {
    setToastMessageVisibility({ isShown: true, message, type });
    setShowToast(true);
  };

  const handleCloseToast = () => {
    setToastMessageVisibility((prev) => ({ ...prev, isShown: false }));
    setTimeout(() => setShowToast(false), 400);
  };

  useEffect(() => {
    if (toastMessageVisibility.isShown) {
      setTimeout(handleCloseToast, 3000);
    }
  }, [toastMessageVisibility.isShown]);

  const handleEdit = (note) => openTab(note);

  const { deleteNote, updateIsPinned, updateNoteArchive, handleChecklistToggle } =
    useNoteOperations(getAllNotes, showToastMessage);

  const handleNoteSaved = (tabId) => {
    closeTab(tabId);
    getAllNotes();
  };

  const activeTabNote = activeTabId !== 'home' ? openTabs.find(t => t._id === activeTabId) : null;
  const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);

  return (
    <div className="relative min-h-[calc(100vh-80px)] overflow-hidden">
      {/* Editor */}
      {activeTabId !== 'home' && activeTabNote ? (
        <div key={activeTabId} className="w-full h-[calc(100vh-80px)] pl-2 pr-4 pt-4 pb-12 md:pl-4 md:pr-8 md:pt-6 md:pb-14 animate-scale-up">
          <AddEditNotes
            type={activeTabNote.isDraft ? 'add' : 'edit'}
            noteData={activeTabNote}
            onUpdateTabState={(patch) => updateTabState(activeTabId, patch)}
            onClose={() => closeTab(activeTabId)}
            onSaveSuccess={() => handleNoteSaved(activeTabId)}
            showToastMessage={showToastMessage}
          />
        </div>
      ) : (
        // notes grid
        <div className="pb-24 pt-2 px-2 md:px-4">
          {isAIMode ? (
            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <NotesGrid
                  notes={semanticResult?.sourceNotes || []}
                  emptyMessage="No matching notes found."
                  onEdit={handleEdit}
                  onDelete={deleteNote}
                  onPin={updateIsPinned}
                  onArchive={updateNoteArchive}
                  onChecklistToggle={handleChecklistToggle}
                />
              </div>
              <div className="w-72 shrink-0">
                <AiSearchPanel />
              </div>
            </div>
          ) : (
            <div>
              <NotesGrid
                notes={allNotes}
                emptyMessage={"It's quiet here… Start by adding a note."}
                onEdit={handleEdit}
                onDelete={deleteNote}
                onPin={updateIsPinned}
                onArchive={updateNoteArchive}
                onChecklistToggle={handleChecklistToggle}
              />
            </div>
          )}
        </div>
      )}

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
