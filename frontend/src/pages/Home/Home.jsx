import React, { useState } from 'react'
import Navbar from '../../components/Navbar/Navbar'
import NoteCard from '../../components/Cards/NoteCard'
import { MdAdd } from 'react-icons/md'
import AddEditNotes from './AddEditNotes'
import Modal from 'react-modal';


const Home = () => {

  const isPinned = () => { }
  const onEdit = () => { }
  const onDelete = () => { }
  const onPinned = () => { }

  const [openAddEditModal, setOpenAddEditModal] = useState({
    isShown: false,
    type: "add",
    data: null,
  });



  return (
    <>
      <Navbar />

      <div className='container  mx-auto'>
        <NoteCard
          title="This is the Title"
          date="1/06/2025"
          content="This is where the content of the note is"
          tags="#test"
          isPinned={isPinned}
          onEdit={onEdit}
          onDelete={onDelete}
          onPinned={onPinned}
        />
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
          onClose={() => {
            setOpenAddEditModal({ isShown: false, type: "add", data: null });
          }} />
      </Modal>
    </>
  )
}

export default Home
