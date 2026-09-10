import React from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import { useTabsStore } from '../../store/useTabsStore';
import { useToastStore } from '../../store/useToastStore';
import { useModalStore } from '../../components/Modals/useModalStore';
import { useArchivedNotesQuery } from '../../hooks/useNotesQuery';
import { useDeleteNoteMutation, useArchiveNoteMutation, useChecklistToggleMutation } from '../../hooks/useNoteMutations';

const Archive = () => {
    const { data: archivedNotes = [] } = useArchivedNotesQuery();

    const { openTab } = useTabsStore();
    const { openConfirmModal } = useModalStore();

    const deleteNoteMutation = useDeleteNoteMutation();
    const archiveNoteMutation = useArchiveNoteMutation();
    const checklistToggleMutation = useChecklistToggleMutation();

    const handleEdit = (note) => {
        openTab(note);
    };

    const handleDeleteNoteClick = (note) => {
        if (useTabsStore.getState().openTabs.some((t) => t._id === note._id)) {
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

    const handleArchiveToggle = (note) => {
        if (note.isArchived) {
            openConfirmModal({
                title: "Unarchive note?",
                message: "This moves the note back to Home.",
                confirmLabel: "Unarchive",
                variant: "warning",
                onConfirm: () => archiveNoteMutation.mutate({ noteId: note._id, isArchived: false })
            });
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

    const handleChecklist = (note, index) => {
        const newChecklist = [...(note.checklist || [])];
        if (newChecklist[index]) {
            newChecklist[index] = { ...newChecklist[index], completed: !newChecklist[index].completed };
        }
        checklistToggleMutation.mutate({ noteId: note._id, checklist: newChecklist });
    };

    return (
        <div className="relative min-h-0">
            <div className="pb-24 px-2 md:px-4">
                <NotesGrid
                    notes={archivedNotes}
                    emptyMessage={"No Archived Notes..."}
                    onEdit={handleEdit}
                    onDelete={handleDeleteNoteClick}
                    onArchive={handleArchiveToggle}
                    onChecklistToggle={handleChecklist}
                    allowDrag={false}
                />
            </div>
        </div>
    );
};

export default Archive;
