import React from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import { useTabsStore } from '../../store/useTabsStore';
import { useArchivedNotesQuery } from '../../hooks/useNotesQuery';
import { useDeleteNoteMutation, useArchiveNoteMutation, useChecklistToggleMutation } from '../../hooks/useNoteMutations';

const Archive = () => {
    const { data: archivedNotes = [] } = useArchivedNotesQuery();

    const { openTab } = useTabsStore();

    const { promptDelete } = useDeleteNoteMutation();
    const { promptToggleArchive } = useArchiveNoteMutation();
    const checklistToggleMutation = useChecklistToggleMutation();

    const handleEdit = (note) => {
        openTab(note);
    };

    const handleArchiveToggle = (note) => {
        promptToggleArchive(note, { confirmUnarchive: true });
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
                    onDelete={promptDelete}
                    onArchive={handleArchiveToggle}
                    onChecklistToggle={handleChecklist}
                    allowDrag={false}
                />
            </div>
        </div>
    );
};

export default Archive;
