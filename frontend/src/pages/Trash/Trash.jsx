import React from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import FoldersGrid from '../../components/Cards/FoldersGrid';
import { useModalStore } from '../../components/Modals/useModalStore';
import { useTrashNotesQuery, useTrashFoldersQuery } from '../../hooks/useNotesQuery';
import { useRestoreNoteMutation, useDeleteTrashNotePermanentMutation } from '../../hooks/useNoteMutations';
import { useRestoreFolderMutation, useDeleteFolderPermanentMutation } from '../../hooks/useFolderMutations';
import { MdOutlineFolder, MdOutlineStickyNote2 } from 'react-icons/md';

const Trash = () => {
  const { data: trashNotes = [] } = useTrashNotesQuery();
  const { data: trashFolders = [] } = useTrashFoldersQuery();

  const { openConfirmModal } = useModalStore();

  const restoreNoteMutation = useRestoreNoteMutation();
  const deleteTrashNotePermanentMutation = useDeleteTrashNotePermanentMutation();
  const restoreFolderMutation = useRestoreFolderMutation();
  const deleteFolderPermanentMutation = useDeleteFolderPermanentMutation();

  const handleRestoreNote = (note) => {
    restoreNoteMutation.mutate(note._id);
  };

  const handleDeleteNotePermanentClick = (note) => {
    openConfirmModal({
      title: "Delete permanently?",
      message: "This cannot be undone. Are you sure you want to permanently delete this note?",
      confirmLabel: "Delete forever",
      variant: "danger",
      onConfirm: () => deleteTrashNotePermanentMutation.mutate(note._id)
    });
  };

  const handleRestoreFolder = (folder) => {
    restoreFolderMutation.mutate(folder._id);
  };

  const handleDeleteFolderPermanentClick = (folder) => {
    openConfirmModal({
      title: "Delete folder permanently?",
      message: `Are you sure you want to permanently delete "${folder.name}"? This action cannot be undone.`,
      confirmLabel: "Delete forever",
      variant: "danger",
      onConfirm: () => deleteFolderPermanentMutation.mutate(folder._id)
    });
  };

  // The API excludes notes belonging to folder deletion batches. Notes returned
  // here were deleted individually and remain visible after folder restoration.
  const individualTrashNotes = trashNotes;

  const isEmpty = individualTrashNotes.length === 0 && trashFolders.length === 0;

  return (
    <div className="pb-24 px-2 md:px-4">
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <p className="text-stone-400 text-sm">
            Trash is empty! Good job keeping things tidy.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {trashFolders.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-3 flex items-center">
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
              <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-3 flex items-center">
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
  );
};

export default Trash;
