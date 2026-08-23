import React, { useEffect, useState } from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import { useAuthStore } from '../../store/useAuthStore';
import { useTabsStore } from '../../store/useTabsStore';
import Toast from '../../components/ToastMessage/Toast';
import { useModalStore } from '../../components/Modals/useModalStore';
import { useArchivedNotesQuery } from '../../hooks/useNotesQuery';
import { useDeleteNoteMutation, useArchiveNoteMutation, useChecklistToggleMutation } from '../../hooks/useNoteMutations';

const Archive = () => {
    const { data: archivedNotes = [] } = useArchivedNotesQuery();
    const [showToast, setShowToast] = useState(false);

    const { getUser } = useAuthStore();
    const { openTab } = useTabsStore();
    const { openConfirmModal } = useModalStore();

    const [toastMessageVisibility, setToastMessageVisibility] = useState({
        isShown: false,
        message: "",
        type: "add"
    });

    const showToastMessage = (message, type) => {
        setToastMessageVisibility({ isShown: true, message, type });
        setShowToast(true);
    };

    const deleteNoteMutation = useDeleteNoteMutation(showToastMessage);
    const archiveNoteMutation = useArchiveNoteMutation(showToastMessage);
    const checklistToggleMutation = useChecklistToggleMutation();

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
        openTab(note);
    };

    const handleDeleteNoteClick = (note) => {
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

    useEffect(() => {
        getUser();
    }, [getUser]);

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



            {showToast && (
                <Toast
                    isShown={toastMessageVisibility.isShown}
                    message={toastMessageVisibility.message}
                    type={toastMessageVisibility.type}
                    onClose={handleCloseToast}
                />
            )}
        </div>
    )
}

export default Archive
