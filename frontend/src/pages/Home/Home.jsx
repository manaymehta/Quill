import React, { useState, useEffect } from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import AiSearchPanel from '../../components/Cards/AiSearchPanel';
import useNoteOperations from '../../hooks/useNoteOperations';
import { MdAdd } from 'react-icons/md';
import AddEditNotes from './AddEditNotes';
import Modal from 'react-modal';
import Toast from '../../components/ToastMessage/Toast';
import { useNotesStore } from '../../store/useNotesStore';
import { useSearchStore } from '../../store/useSearchStore';
import './Modal.css';


const Home = () => {
  const { allNotes, getAllNotes } = useNotesStore();
  const { searchMode, semanticResult, isSearchingAI } = useSearchStore();
  const [showToast, setShowToast] = useState(false);
  const [shouldCloseModal, setShouldCloseModal] = useState(false);

  const [openAddEditModal, setOpenAddEditModal] = useState({
    isShown: false,
    type: "add",
    data: null,
  });

  const [toastMessageVisibility, setToastMessageVisibility] = useState({
    isShown: false,
    message: "",
    type: "add"
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

  const handleEdit = (note) => {
    setOpenAddEditModal({ isShown: true, type: "edit", data: note });
  };

  const {
    deleteNote,
    updateIsPinned,
    updateNoteArchive,
    handleChecklistToggle
  } = useNoteOperations(getAllNotes, showToastMessage);

  const handleModalClose = () => {
    if (openAddEditModal.type === "edit") {
      setShouldCloseModal(true);
    } else {
      setOpenAddEditModal({ isShown: false, type: "add", data: null });
    }
  };

  // in AI mode: show source notes + answer panel side by side
  const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);
  const notesToShow = isAIMode && semanticResult ? semanticResult.sourceNotes : allNotes;

  return (
    <>
      {isAIMode ? (
        // split layout: source notes left, AI answer right
        <div className="flex gap-4 p-2 pr-4">
          {/* source notes via standard NoteCard grid */}
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

          {/* AI answer panel — sticky on the right */}
          <div className="w-72 shrink-0">
            <AiSearchPanel />
          </div>
        </div>
      ) : (
        // normal notes grid
        <div className="p-2">
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

      <button
        className="flex justify-center w-16 h-16 items-center rounded-4xl bg-[#dd5e57] hover:bg-[#fb6d65] fixed right-8 bottom-8 hover:rotate-45 hover:shadow-xl transition-all ease-in-out"
        onClick={() => setOpenAddEditModal({ isShown: true, type: "add", data: null })}
      >
        <MdAdd className="text-[35px] text-white" />
      </button>

      <Modal
        isOpen={openAddEditModal.isShown}
        onRequestClose={handleModalClose}
        closeTimeoutMS={200}
        style={{
          overlay: {
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(0,0,0,0.2)",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflowY: 'auto',
            zIndex: 50,
          },
        }}
        className="mx-auto rounded-2xl bg-[#f8ecdc] w-full max-w-lg p-4 max-h-[90vh] flex flex-col"
        overlayClassName="ReactModal__Overlay"
      >
        <AddEditNotes
          type={openAddEditModal.type}
          noteData={openAddEditModal.data}
          getAllNotes={getAllNotes}
          onClose={() => {
            setOpenAddEditModal({ isShown: false, type: "add", data: null });
            setShouldCloseModal(false);
          }}
          showToastMessage={showToastMessage}
          shouldCloseModal={shouldCloseModal}
        />
      </Modal>

      {showToast && (
        <Toast
          isShown={toastMessageVisibility.isShown}
          message={toastMessageVisibility.message}
          type={toastMessageVisibility.type}
          onClose={handleCloseToast}
        />
      )}
    </>
  );
};

export default Home;
