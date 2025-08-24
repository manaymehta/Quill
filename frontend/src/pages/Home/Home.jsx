import React, { useEffect, useState } from 'react'
import Navbar from '../../components/Navbar/Navbar'
import NoteCard from '../../components/Cards/NoteCard'
import { MdAdd } from 'react-icons/md'
import AddEditNotes from './AddEditNotes'
import Modal from 'react-modal';
import axiosInstance from '../../utils/axiosInstance'
import { useNavigate } from 'react-router-dom'
import Toast from '../../components/ToastMessage/Toast'
import EmptyCard from '../../components/Cards/EmptyCard'
import Sidebar from '../../components/Sidebar/Sidebar'
import { useOutletContext } from 'react-router-dom';
import { useUser } from '../../context/UserContext'


const Home = () => {
  const userInfo = useUser();
  const { allNotes, setAllNotes, getAllNotes, getUserInfo } = useOutletContext();
  const [showToast, setShowToast] = useState(false);
  const [shouldCloseModal, setShouldCloseModal] = useState(false);

  const [openAddEditModal, setOpenAddEditModal] = useState({  //passes values to modal  
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
    setShowToast(true); // Show Toast
  };

  const handleCloseToast = () => {
    setToastMessageVisibility((prev) => ({ ...prev, isShown: false }));

    setTimeout(() => {  // Hide Toast after animation
      setShowToast(false);
    }, 400); // match this with Toast's CSS fade duration (400ms)
  };

  const handleEdit = (note) => {  //Modal in edit mode
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
    }

    catch (error) {
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
        getAllNotes();
        showToastMessage(`Note ${!noteData.isPinned ? "pinned" : "unpinned"}`);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleModalClose = () => {
    if (openAddEditModal.type === "edit") {
      setShouldCloseModal(true); // tell child to handle save first
    } else {
      setOpenAddEditModal({ isShown: false, type: "add", data: null });
    }
  };

  useEffect(() => {
    getUserInfo();
    getAllNotes();
    return () => { };
  }, []);

  return (
    <div className="h-screen bg-neutral-200 overflow-y-auto">
      <div className="p-4">
        {allNotes.length > 0 ? (
          <div className="grid grid-cols-4 gap-4">
            {allNotes.map((note) => (
              <NoteCard
                key={note._id}
                title={note.title}
                date={note.createdOn}
                content={note.content}
                tags={note.tags}
                isPinned={note.isPinned}
                onEdit={() => handleEdit(note)}
                onDelete={() => deleteNote(note)}
                onPinned={() => updateIsPinned(note)}
              />
            ))}
          </div>
        ) : (
          <EmptyCard message={"It’s quiet here… Start by adding a note."} />
        )}
      </div>

      <button
        className="flex justify-center w-16 h-16 items-center rounded-4xl bg-neutral-400 hover:bg-neutral-500 absolute right-10 bottom-10 hover:rotate-45 hover:shadow-xl transition-all ease-in-out"
        onClick={() => {
          setOpenAddEditModal({ isShown: true, type: "add", data: null });
        }}
      >
        <MdAdd className="text-[35px] text-white" />
      </button>

      <Modal
        isOpen={openAddEditModal.isShown}
        onRequestClose={handleModalClose}
        style={{
          overlay: {
            backgroundColor: "rgba(0,0,0,0.2)",
          },
        }}
        className="mx-auto rounded-2xl bg-stone-100 w-150 mt-20 p-4"
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
    </div>
  );
};


export default Home
