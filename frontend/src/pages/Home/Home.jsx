import React, { useState, useEffect, useRef } from 'react';
import Navbar from '../../components/Navbar/Navbar';
import NoteCard from '../../components/Cards/NoteCard';
import { MdAdd } from 'react-icons/md';
import AddEditNotes from './AddEditNotes';
import Modal from 'react-modal';
import axiosInstance from '../../utils/axiosInstance';
import Toast from '../../components/ToastMessage/Toast';
import EmptyCard from '../../components/Cards/EmptyCard';
import { useOutletContext } from 'react-router-dom';
import './Modal.css';


const Home = () => {
  // --- Your Existing State and Logic (Unchanged) --- //
  const { allNotes, getAllNotes } = useOutletContext();
  const [showToast, setShowToast] = useState(false);
  const [shouldCloseModal, setShouldCloseModal] = useState(false);
  const canvasRef = useRef(null); // Ref for the canvas background

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

  // --- Canvas Background Animation Logic --- //
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const DENSITY = 80; // Adjusted for a larger area
    const MAX_DISTANCE = 120;
    const SPEED = 0.5;

    let nodes = [];

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      // Set height to the full scrollable height of the document
      canvas.height = document.body.scrollHeight; 
      nodes = [];
      initNodes();
    };

    const initNodes = () => {
      for (let i = 0; i < DENSITY; i++) {
        nodes.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
          radius: Math.random() * 2 + 1,
        });
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (const node of nodes) {
        if (node.x + node.radius > canvas.width || node.x - node.radius < 0) {
          node.vx *= -1;
        }
        if (node.y + node.radius > canvas.height || node.y - node.radius < 0) {
          node.vy *= -1;
        }
        node.x += node.vx;
        node.y += node.vy;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; // More subtle nodes
        ctx.fill();
      }
      
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const dist = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
          if (dist < MAX_DISTANCE) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 - (dist / MAX_DISTANCE) * 0.2})`; // More subtle lines
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    // Use a timeout to ensure layout is stable before sizing canvas
    setTimeout(resizeCanvas, 0); 
    animate();

    window.addEventListener('resize', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    // Added relative positioning to contain the absolute canvas
    <div className="relative min-h-screen">
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full z-[-1]"></canvas>
      
      {/* Your existing JSX content, wrapped to ensure it's above the canvas */}
      <div className="relative z-10">
        <div className="p-2">
          {allNotes.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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

        <button
          className="flex justify-center w-16 h-16 items-center rounded-4xl bg-[#dd5e57] hover:bg-[#fb6d65] fixed right-10 bottom-10 hover:rotate-45 hover:shadow-xl transition-all ease-in-out"
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
      </div>
    </div>
  );
};

export default Home;
