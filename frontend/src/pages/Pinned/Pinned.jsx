import { useEffect, useState } from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import useNoteOperations from '../../hooks/useNoteOperations';
import axiosInstance from '../../utils/axiosInstance';
import { useAuthStore } from '../../store/useAuthStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useNavigate } from 'react-router-dom';
import Toast from '../../components/ToastMessage/Toast';

const Pinned = () => {
  const [allPinnedNotes, setAllPinnedNotes] = useState([]);
  const [showToast, setShowToast] = useState(false);

  const { getUser } = useAuthStore();
  const { openTab } = useTabsStore();
  const navigate = useNavigate();

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
      console.log("Unexpected error. Please try again", error);
    }
  }

  const handleEdit = (note) => {
    openTab(note);
    navigate('/dashboard');
  };

  const {
    deleteNote,
    updateIsPinned,
    updateNoteArchive,
    handleChecklistToggle
  } = useNoteOperations(getAllPinnedNotes, showToastMessage);

  useEffect(() => {
    getAllPinnedNotes();
    getUser();
  }, [getUser])

  return (
    <>
      <div className="p-2">
        <NotesGrid
          notes={allPinnedNotes}
          emptyMessage={"No Pinned Notes..."}
          onEdit={handleEdit}
          onDelete={deleteNote}
          onPin={updateIsPinned}
          onArchive={updateNoteArchive}
          onChecklistToggle={handleChecklistToggle}
        />
      </div>



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
