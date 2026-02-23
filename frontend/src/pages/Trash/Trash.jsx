import React, { useEffect, useState } from 'react'
import { useNotesStore } from '../../store/useNotesStore';
import NotesGrid from '../../components/Cards/NotesGrid';
import useNoteOperations from '../../hooks/useNoteOperations';
import Toast from '../../components/ToastMessage/Toast';

const Trash = () => {
  const { trashNotes, getTrashNotes } = useNotesStore();
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ message: '', type: '' });

  const showToastMsg = (message, type) => {
    setShowToast(true);
    setToastMessage({ message, type });
  };

  const handleCloseToast = () => {
    setShowToast(false);
  };

  useEffect(() => {
    getTrashNotes();
  }, [getTrashNotes]);

  const {
    restoreNote,
    deleteNotePermanently
  } = useNoteOperations(getTrashNotes, showToastMsg);

  return (
    <>
      <div className="p-2">
        <NotesGrid
          notes={trashNotes}
          emptyMessage={"Trash is empty! Good job keeping things tidy."}
          onRestore={restoreNote}
          onDelete={deleteNotePermanently}
          isTrash={true}
        />
      </div>

      <Toast
        isShown={showToast}
        message={toastMessage.message}
        type={toastMessage.type}
        onClose={handleCloseToast}
      />
    </>
  )
}

export default Trash
