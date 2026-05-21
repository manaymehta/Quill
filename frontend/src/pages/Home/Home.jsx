import { useState, useEffect, useCallback, memo } from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import AiSearchPanel from '../../components/Cards/AiSearchPanel';
import useNoteOperations from '../../hooks/useNoteOperations';
import AddEditNotes from './AddEditNotes';
import Toast from '../../components/ToastMessage/Toast';
import { useNotesStore } from '../../store/useNotesStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useTabsStore } from '../../store/useTabsStore';
import './Modal.css';

// ── TabEditorSlot ─────────────────────────────────────────────────────────────
// Problem 2 fix: a dedicated wrapper component for each open tab.
//
// The problem it solves:
//   openTabs.map() in Home creates a new arrow function on EVERY render of Home
//   (e.g. onUpdateTabState={(patch) => updateTabState(tab._id, patch)}).
//   These unstable references defeat React.memo on AddEditNotes — even inactive
//   tabs re-render on every keypress.
//
// The fix:
//   By isolating each tab into its own component, useCallback can create
//   per-tab stable function references that only change if tab._id changes
//   (it never does for the lifetime of a tab).  AddEditNotes.memo then works
//   correctly: inactive tabs are completely skipped.
const TabEditorSlot = memo(({ tab, isActive, onNoteSaved, showToastMessage }) => {
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
    />
  );
});
TabEditorSlot.displayName = 'TabEditorSlot';


const Home = () => {
  const { allNotes, getAllNotes } = useNotesStore();
  const { searchMode, semanticResult, isSearchingAI } = useSearchStore();
  const { openTabs, activeTabId, openTab, closeTab } = useTabsStore();

  const [showToast, setShowToast] = useState(false);
  const [toastMessageVisibility, setToastMessageVisibility] = useState({
    isShown: false,
    message: '',
    type: 'add',
  });

  // ── Stable callback refs ───────────────────────────────────────────────────
  // useCallback deps: only state-setter functions (stable by React guarantee)
  // so these never change reference across renders — TabEditorSlot.memo holds.
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

  const { deleteNote, updateIsPinned, updateNoteArchive, handleChecklistToggle } =
    useNoteOperations(getAllNotes, showToastMessage);

  const isEditorOpen = activeTabId !== 'home';
  const isAIMode    = searchMode === 'semantic' && (isSearchingAI || semanticResult);

  return (
    <div className={`relative ${isEditorOpen ? 'h-screen' : 'min-h-[calc(100vh-80px)]'}`}>

      {/* ── Notes grid ─────────────────────────────────────────────────────── */}
      {/* Hidden (CSS), not unmounted — grid doesn't re-fetch on editor open.  */}
      <div className={isEditorOpen ? 'hidden' : 'pb-24 pt-2 px-2 md:px-4'}>
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

      {/* ── Editor tabs ────────────────────────────────────────────────────── */}
      {/* One TabEditorSlot per open tab.  Inactive tabs are CSS-hidden (not   */}
      {/* unmounted), so CodeMirror keeps cursor/scroll/undo alive across      */}
      {/* tab switches.  React.memo + stable callbacks ensure only the ACTIVE  */}
      {/* tab's component re-renders during typing.                            */}
      {openTabs.map((tab) => (
        <div
          key={tab._id}
          className={`w-full h-full pl-2 pr-4 pt-6 pb-12 md:pl-4 md:pr-8 md:pt-10 md:pb-14 ${
            activeTabId === tab._id ? 'block animate-scale-up' : 'hidden'
          }`}
        >
          <TabEditorSlot
            tab={tab}
            isActive={activeTabId === tab._id}
            onNoteSaved={handleNoteSaved}
            showToastMessage={showToastMessage}
          />
        </div>
      ))}

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
