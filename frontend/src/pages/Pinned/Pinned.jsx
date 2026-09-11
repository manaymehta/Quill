import React from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import { useTabsStore } from '../../store/useTabsStore';
import { useToastStore } from '../../store/useToastStore';
import { useModalStore } from '../../components/Modals/useModalStore';
import { useHomeNotesQuery } from '../../hooks/useNotesQuery';
import { useDeleteNoteMutation, useArchiveNoteMutation, useChecklistToggleMutation, useToggleHomePinMutation } from '../../hooks/useNoteMutations';

const Pinned = () => {
  const { data: homeNotes = [] } = useHomeNotesQuery();
  const allPinnedNotes = homeNotes.filter(n => Boolean(n.showInHome));

  const { openTab } = useTabsStore();
  const { openConfirmModal } = useModalStore();

  const deleteNoteMutation = useDeleteNoteMutation();
  const archiveNoteMutation = useArchiveNoteMutation();
  const checklistToggleMutation = useChecklistToggleMutation();
  const toggleHomePinMutation = useToggleHomePinMutation();

  const handleEdit = (note) => {
    openTab(note);
  };

  const handleDeleteNoteClick = (note) => {
    if (useTabsStore.getState().isTabOpen(note._id)) {
      useToastStore.getState().showToast({
        message: "Close the editor tab for this note before deleting.",
        type: "warning",
      });
      return;
    }
    openConfirmModal({
      title: "Delete note?",
      message: "This moves the note to Trash.",
      onConfirm: () => deleteNoteMutation.mutate(note._id)
    });
  };

  const handlePinToggle = (noteData) => {
    toggleHomePinMutation.mutate({ noteId: noteData._id, showInHome: false });
  };

  const handleArchiveToggle = (note) => {
    if (note.isArchived) {
      archiveNoteMutation.mutate({ noteId: note._id, isArchived: false });
    } else {
      openConfirmModal({
        title: "Archive note?",
        message: "This moves the note to Archive.",
        confirmLabel: "Archive",
        variant: "warning",
        onConfirm: () => archiveNoteMutation.mutate({ noteId: note._id, isArchived: true })
      });
    }
  };

  const handleChecklist = (note, itemIndex) => {
    if (!note || !note.checklist || !note.checklist[itemIndex]) return;
    const updatedChecklist = note.checklist.map((item, index) => {
      if (index === itemIndex) {
        return { ...item, completed: !item.completed };
      }
      return item;
    });

    checklistToggleMutation.mutate({ noteId: note._id, checklist: updatedChecklist });
  };

  return (
    <div className=''>
      <div className='max-w-[1400px] mx-auto px-4 md:px-12 pt-6 pb-28 md:pb-12'>
        <NotesGrid 
          notes={allPinnedNotes}
          emptyMessage={"No Pinned Notes..."}
          onEdit={handleEdit}
          onDelete={handleDeleteNoteClick}
          onPin={handlePinToggle}
          onArchive={handleArchiveToggle}
          onChecklistToggle={handleChecklist}
          allowDrag={false}
        />
      </div>
    </div>
  );
};

export default Pinned;
