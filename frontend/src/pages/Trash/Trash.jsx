import React, { useEffect, useState } from 'react'
import { useNotesStore } from '../../store/useNotesStore';
import NotesGrid from '../../components/Cards/NotesGrid';
import FoldersGrid from '../../components/Cards/FoldersGrid';
import Toast from '../../components/ToastMessage/Toast';
import { useModalStore } from '../../components/Modals/useModalStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { MdOutlineFolder, MdOutlineStickyNote2 } from 'react-icons/md';

const Trash = () => {
  const { trashNotes, getTrashNotes, restoreNote, deleteNotePermanent } = useNotesStore();
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

  const handleRestoreNote = async (note) => {
    await restoreNote(note._id);
    showToastMsg("Note restored successfully", "success");
  };

  const handleDeleteNotePermanentClick = (note) => {
    openConfirmModal({
      title: "Delete permanently?",
      message: "This cannot be undone. Are you sure you want to permanently delete this note?",
      confirmLabel: "Delete forever",
      variant: "danger",
      onConfirm: async () => {
        await deleteNotePermanent(note._id);
        showToastMsg("Note permanently deleted", "delete");
      }
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
      <div className="pb-24 px-2 md:px-4">
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
                <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-4 flex items-center">
                  <MdOutlineFolder className="mr-2" size={16} />
                  Folders
                </h3>
                <FoldersGrid
                  folders={trashFolders}
                  isTrash={true}
                  onRestore={handleRestoreFolder}
                  onDeletePermanent={handleDeleteFolderPermanentClick}
                />
              </div>
            )}

            {individualTrashNotes.length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-4 flex items-center">
                  <MdOutlineStickyNote2 className="mr-2" size={16} />
                  Notes
                </h3>
                <NotesGrid
                  notes={individualTrashNotes}
                  emptyMessage=""
                  onRestore={handleRestoreNote}
                  onDelete={handleDeleteNotePermanentClick}
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
