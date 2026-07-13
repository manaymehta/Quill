import React, { useEffect, useState } from 'react'
import { useNotesStore } from '../../store/useNotesStore';
import NotesGrid from '../../components/Cards/NotesGrid';
import FolderCard from '../../components/Cards/FolderCard';
import useNoteOperations from '../../hooks/useNoteOperations';
import Toast from '../../components/ToastMessage/Toast';
import { useModalStore } from '../../components/Modals/useModalStore';
import { useFoldersStore } from '../../store/useFoldersStore';

const Trash = () => {
  const { trashNotes, getTrashNotes } = useNotesStore();
  const { folders, getFolders, trashFolders, getTrashFolders, restoreFolder, deleteFolderPermanent } = useFoldersStore();
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ message: '', type: '' });
  const { openConfirmModal } = useModalStore();

  const showToastMsg = (message, type) => {
    setShowToast(true);
    setToastMessage({ message, type });
  };

  const handleCloseToast = () => {
    setShowToast(false);
  };

  useEffect(() => {
    getTrashNotes();
    getTrashFolders();
    getFolders();
  }, [getTrashNotes, getTrashFolders, getFolders]);

  const {
    restoreNote,
    deleteNotePermanently
  } = useNoteOperations(getTrashNotes, showToastMsg);

  const handleDeleteNoteClick = (note) => {
    openConfirmModal({
      title: "Delete permanently?",
      message: "This cannot be undone. Are you sure you want to permanently delete this note?",
      confirmLabel: "Delete forever",
      variant: "danger",
      onConfirm: () => deleteNotePermanently(note)
    });
  };

  const handleRestoreFolder = async (folder) => {
    await restoreFolder(folder._id);
    showToastMsg("Folder restored successfully", "success");
  };

  const handleDeleteFolderPermanentClick = (folder) => {
    openConfirmModal({
      title: "Delete folder permanently?",
      message: `Are you sure you want to permanently delete "${folder.name}"? This action cannot be undone.`,
      confirmLabel: "Delete forever",
      variant: "danger",
      onConfirm: async () => {
        await deleteFolderPermanent(folder._id);
        showToastMsg("Folder permanently deleted", "delete");
      }
    });
  };

  // Filter notes so we only show notes that were deleted individually (i.e. parent folder is not deleted)
  const activeFolderIds = folders.map(f => f._id);
  const individualTrashNotes = trashNotes.filter(note => {
    if (!note.folderId) return true;
    return activeFolderIds.includes(note.folderId);
  });

  const isEmpty = individualTrashNotes.length === 0 && trashFolders.length === 0;

  return (
    <>
      <div className="p-4 md:p-6">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
            <p className="text-stone-400 text-sm">
              Trash is empty! Good job keeping things tidy.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {trashFolders.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-stone-500 tracking-wider uppercase mb-3">
                  Folders
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4 animate-fade-in">
                  {trashFolders.map(folder => (
                    <FolderCard
                      key={folder._id}
                      folder={folder}
                      isTrash={true}
                      onRestore={handleRestoreFolder}
                      onDeletePermanent={handleDeleteFolderPermanentClick}
                    />
                  ))}
                </div>
              </div>
            )}

            {individualTrashNotes.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-stone-500 tracking-wider uppercase mb-3">
                  Notes
                </h2>
                <NotesGrid
                  notes={individualTrashNotes}
                  emptyMessage=""
                  onRestore={restoreNote}
                  onDelete={handleDeleteNoteClick}
                  isTrash={true}
                  allowDrag={false}
                />
              </div>
            )}
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
