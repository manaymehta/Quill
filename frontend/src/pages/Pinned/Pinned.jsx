import React, { useEffect, useState } from 'react';
import NoteCard from '../../components/Cards/NoteCard';
import EmptyCard from '../../components/Cards/EmptyCard';
import axiosInstance from '../../utils/axiosInstance';
import { useAuthStore } from '../../store/useAuthStore';
import { useNotesStore } from '../../store/useNotesStore'; // Import if needed for global state, but Pinned seems local? Actually standardizing is good.
import Toast from '../../components/ToastMessage/Toast';
import AddEditNotes from '../Home/AddEditNotes';
import Modal from 'react-modal';
import '../Home/Modal.css';

const Pinned = () => {
  const [allPinnedNotes, setAllPinnedNotes] = useState([]);
  const [showToast, setShowToast] = useState(false);
  const [shouldCloseModal, setShouldCloseModal] = useState(false);

  const { getUser } = useAuthStore();
  const { getAllNotes } = useNotesStore(); // We might need this to refresh if we stick to store, but Pinned fetch is local.

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
    setTimeout(() => {
      setShowToast(false);
    }, 400);
  };

  useEffect(() => {
    if (toastMessageVisibility.isShown) {
      setTimeout(() => {
        handleCloseToast();
      }, 3000);
    }
  }, [toastMessageVisibility.isShown]);

  const getAllPinnedNotes = async () => {
    try {
      const response = await axiosInstance.get("/get-all-pinned-notes");
      if (response.data && response.data.notes) {
        setAllPinnedNotes(response.data.notes);
      }
    }
    catch (error) {
      console.log("Unexpected error. Please try again");
    }
  }

  const handleEdit = (note) => {
    setOpenAddEditModal({ isShown: true, type: "edit", data: note })
  };

  const deleteNote = async (note) => {
    const noteId = note._id;
    try {
      const response = await axiosInstance.delete("/delete-note/" + noteId);

      if (response.data && !response.data.error) {
        showToastMessage("Note deleted successfully", "delete");
        getAllPinnedNotes(); // Refresh list
      }
    } catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        console.log("Unexpected error. Please try again");
      }
    }
  };

  const updateIsPinned = async (noteData) => {
    const noteId = noteData._id;
    try {
      const response = await axiosInstance.put("/update-note-pinned/" + noteId, { isPinned: !noteData.isPinned });

      if (response.data && response.data.note) {
        showToastMessage(`Note ${!noteData.isPinned ? "pinned" : "unpinned"}`);
        getAllPinnedNotes(); // Refresh list
      }
    } catch (error) {
      console.log(error);
    }
  };

  const updateNoteArchive = async (noteData) => {
    const noteId = noteData._id;
    try {
      const response = await axiosInstance.put("/update-note-archive/" + noteId, { isArchived: !noteData.isArchived });

      if (response.data && response.data.note) {
        showToastMessage(`Note ${!noteData.isArchived ? "archived" : "unarchived"}`);
        getAllPinnedNotes(); // Refresh list
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleChecklistToggle = async (note, index) => {
    const noteId = note._id;
    const newChecklist = [...note.checklist];
    newChecklist[index].completed = !newChecklist[index].completed;

    try {
      const response = await axiosInstance.put(`/edit-note/${noteId}`, {
        checklist: newChecklist,
      });

      if (response.data && response.data.note) {
        getAllPinnedNotes();
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleModalClose = () => {
    if (openAddEditModal.type === "edit") {
      setShouldCloseModal(true);
    } else {
      setOpenAddEditModal({ isShown: false, type: "add", data: null });
    }
  };

  useEffect(() => {
    getAllPinnedNotes();
    getUser();
  }, [getUser])

  return (
    <>
      <div className="p-2">
        {/* Removed min-h-screen wrapper to match Home.jsx structure and fix layout inconsistency */}
        {allPinnedNotes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:pr-10">
            {allPinnedNotes.map((note) => (
              <NoteCard
                key={note._id}
                title={note.title}
                date={note.createdOn}
                content={note.content}
                tags={note.tags}
                isPinned={note.isPinned}
                isChecklist={note.isChecklist}
                checklist={note.checklist}
                onEdit={() => handleEdit(note)}
                onDelete={() => deleteNote(note)}
                onPinned={() => updateIsPinned(note)}
                isArchived={note.isArchived}
                onArchive={() => updateNoteArchive(note)}
                onChecklistToggle={(index) => handleChecklistToggle(note, index)}
              />
            ))}
          </div>
        ) : (
          <EmptyCard message={"No Pinned Notes..."} />
        )}
      </div>

      <Modal
        isOpen={openAddEditModal.isShown}
        onRequestClose={handleModalClose}
        closeTimeoutMS={200}
        style={{
          overlay: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
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
          getAllNotes={() => {
            getAllPinnedNotes();
            getAllNotes(); // Update global store too if needed
          }}
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
  )
}

export default Pinned
