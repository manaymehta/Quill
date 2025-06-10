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

const Home = () => {

  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState(null);
  const [allNotes, setAllNotes] = useState([]);
  const [showToast, setShowToast] = useState(false);
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
  }

  const getUserInfo = async () => {
    try {
      const response = await axiosInstance.get("/get-user");
      if (response.data && response.data.user) {
        setUserInfo(response.data.user);
      }

    } catch (error) {
      if (error.response.status == 401) {
        localStorage.clear();
        navigate("/login");
      }
    }
  };

  const getAllNotes = async () => {
    try {
      const response = await axiosInstance.get("/get-all-notes")
      if (response.data && response.data.notes) {
        setAllNotes(response.data.notes);
      }
    }
    catch (error) {
      console.log("Unexpected error. Please try again");
    }
  }

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
  }

  useEffect(() => {
    getUserInfo();
    getAllNotes();
    return () => { };
  }, [])

  return (
    <>
      <Navbar onLogout={() => { }} userInfo={userInfo} />

      <div className='container mx-auto'>
        {allNotes.length > 0 ? (
          <div className='grid grid-cols-3 gap-4 mt-8 ml-4'>
            {allNotes.map((note, index) => (
              <NoteCard
                key={note._id}
                title={note.title}
                date={note.date}
                content={note.content}
                tags={note.tags}
                isPinned={note.isPinned}
                onEdit={() => { handleEdit(note) }}
                onDelete={() => { deleteNote(note) }}
                onPinned={() => { }}
              />
            ))}
          </div>
        ) : (
          <EmptyCard className="" message={"It’s quiet here… Start by adding a note."} />
        )}

      </div>

      <button className='flex justify-center w-16 h-16 items-center rounded-4xl bg-slate-400 hover:bg-primary absolute right-10 bottom-10 
                        hover:rotate-45 hover:shadow-xl transition-all ease-in-out'
        onClick={() => { setOpenAddEditModal({ isShown: true, type: "add", data: null }); }}
      >
        <MdAdd className='text-[35px] text-white' />
      </button>

      <Modal
        isOpen={openAddEditModal.isShown}
        onRequestClose={() => { }}
        style={{
          overlay: {
            backgroundColor: "rgba(0,0,0,0.2)"
          }
        }}
        className='mx-auto rounded-2xl bg-white w-[40%] max-h-3/4 mt-15 p-4'
        contentLabel=''
      >
        <AddEditNotes
          type={openAddEditModal.type}
          noteData={openAddEditModal.data}
          getAllNotes={getAllNotes}
          onClose={() => {
            setOpenAddEditModal({ isShown: false, type: "add", data: null });
          }}
          showToastMessage={showToastMessage}
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

export default Home
