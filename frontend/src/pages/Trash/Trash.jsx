import React, { useEffect, useState } from 'react'
import { useNotesStore } from '../../store/useNotesStore';
import NoteCard from '../../components/Cards/NoteCard';
import EmptyCard from '../../components/Cards/EmptyCard';
import Toast from '../../components/ToastMessage/Toast';

const Trash = () => {
  const { trashNotes, getTrashNotes, restoreNote, deleteTrashNote } = useNotesStore();
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ message: '', type: '' });

  useEffect(() => {
    getTrashNotes();
  }, []);

  const handleRestore = async (note) => {
    await restoreNote(note._id);
    showToastMsg("Note restored successfully", "success");
  };

  const handleDeleteForever = async (note) => {
    await deleteTrashNote(note._id);
    showToastMsg("Note deleted permanently", "delete");
  };

  const showToastMsg = (message, type) => {
    setToastMessage({ message, type });
    setShowToast(true);
  };

  const handleCloseToast = () => {
    setShowToast(false);
  };

  return (
    <>
      <div className="p-2">
        {trashNotes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:pr-10">
            {trashNotes.map((note) => (
              <NoteCard
                key={note._id}
                title={note.title}
                date={note.createdOn}
                content={note.content}
                tags={note.tags}
                isPinned={note.isPinned} // Will be hidden by isTrash logic but kept for prop structure
                isChecklist={note.isChecklist}
                checklist={note.checklist}
                isTrash={true}
                onRestore={() => handleRestore(note)}
                onDelete={() => handleDeleteForever(note)}
                onEdit={() => { }} // No edit in trash
                onPinned={() => { }} // No pin in trash
                onChecklistToggle={() => { }} // Read only
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center mt-20">
            <EmptyCard message={"Trash is empty! Good job keeping things tidy."} />
          </div>
        )}
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
