import React, { useEffect, useState } from 'react'
import Navbar from '../../components/Navbar/Navbar'
import NoteCard from '../../components/Cards/NoteCard'
import { MdAdd } from 'react-icons/md'
import AddEditNotes from './AddEditNotes'
import Modal from 'react-modal';
import axiosInstance from '../../utils/axiosInstance'
import { useNavigate } from 'react-router-dom'


const Home = () => {
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState(null);
  const [allNotes, setAllNotes] = useState([]);
  const [openAddEditModal, setOpenAddEditModal] = useState({
    isShown: false,
    type: "add",
    data: null,
  });

  const handleEdit = (note) => {
    setOpenAddEditModal({ isShown: true, type: "edit", data: note  })
  }

  const getUserInfo = async () => {
    try {
      const response = await axiosInstance.get("/get-user");
      if (response.data && response.data.user) {
        setUserInfo(response.data.user);
      }
    }
    catch (error) {
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

  useEffect(() => {
    getUserInfo();
    getAllNotes();
    return () => { };
  }, [])

  return (
    <>
      <Navbar onLogout={() => { }} userInfo={userInfo} />

      <div className='container mx-auto'>
        <div className='grid grid-cols-4 gap-4 mt-8 ml-4'>

          {allNotes.map((note, index) => (
            <NoteCard
              key={note._id}
              title={note.title}
              date={note.date}
              content={note.content}
              tags={note.tags}
              isPinned={note.isPinned}
              onEdit={() => {handleEdit(note)}}
              onDelete={() => { }}
              onPinned={() => { }}
            />
          ))}

        </div>

      </div>

      <button className='flex justify-center w-16 h-16 items-center rounded-4xl bg-slate-400 
                        hover:bg-primary absolute right-10 bottom-10 hover:rotate-45
                          hover:shadow-xl transition-all ease-in-out'
        onClick={() => {
          setOpenAddEditModal({ isShown: true, type: "add", data: null });
        }}
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
          }} />
      </Modal>
    </>
  )
}

export default Home
