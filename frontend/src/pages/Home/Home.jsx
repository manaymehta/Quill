import React, { useState, useEffect } from 'react';
import NoteCard from '../../components/Cards/NoteCard';
import { MdAdd } from 'react-icons/md';
import AddEditNotes from './AddEditNotes';
import Modal from 'react-modal';
import axiosInstance from '../../utils/axiosInstance';
import Toast from '../../components/ToastMessage/Toast';
import EmptyCard from '../../components/Cards/EmptyCard';
import { useNotesStore } from '../../store/useNotesStore';
import './Modal.css';


const Home = () => {
  const { allNotes, getAllNotes } = useNotesStore();
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

  const handleEdit = (note) => {
    setOpenAddEditModal({ isShown: true, type: "edit", data: note })
  };

  const deleteNote = async (note) => {
    const noteId = note._id;
    try {
      const response = await axiosInstance.delete("/delete-note/" + noteId);
      
      if (response.data && !response.data.error) {
        getAllNotes();
        showToastMessage("Note deleted successfully", "delete");
      }
    } catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        console.log("Unexpected error. Please try again");
      }
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
        getAllNotes();
      }
    } catch (error) {
      console.log(error);
    }
  };

  const updateIsPinned = async (noteData) => {
    const noteId = noteData._id;
    try {
      const response = await axiosInstance.put("/update-note-pinned/" + noteId, { isPinned: !noteData.isPinned });

      if (response.data && response.data.note) {
        getAllNotes();
        showToastMessage(`Note ${!noteData.isPinned ? "pinned" : "unpinned"}`);
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

  return (
    <>
        <div className=" p-2">
          <div className=''>
          {allNotes.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:pr-10">
              {allNotes.map((note) => (
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
                  onChecklistToggle={(index) => handleChecklistToggle(note, index)}
                />
              ))}
            </div>
          ) : (
            <EmptyCard message={"It’s quiet here… Start by adding a note."} />
          )}
          </div>
        </div>

        <button
          className="flex justify-center w-16 h-16 items-center rounded-4xl bg-[#dd5e57] hover:bg-[#fb6d65] fixed right-8 bottom-8 hover:rotate-45 hover:shadow-xl transition-all ease-in-out"
          onClick={() => {
            setOpenAddEditModal({ isShown: true, type: "add", data: null });
          }}
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
