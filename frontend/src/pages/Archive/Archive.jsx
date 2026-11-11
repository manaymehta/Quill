import React from 'react';
import NotesGrid from '../../components/Cards/NotesGrid';
import { useTabsStore } from '../../store/useTabsStore';
import { useArchivedNotesQuery } from '../../hooks/useNotesQuery';
import { useDeleteNoteMutation, useArchiveNoteMutation, useTaskToggleMutation } from '../../hooks/useNoteMutations';

// A drag here changes Archive's own order
const ARCHIVE_ORDER = { list: 'archive' };

const Archive = () => {
    const { data: archivedNotes = [] } = useArchivedNotesQuery();

    const openTab = useTabsStore((s) => s.openTab);

    const { promptDelete } = useDeleteNoteMutation();
    const { promptToggleArchive } = useArchiveNoteMutation();
    const taskToggleMutation = useTaskToggleMutation();

    const handleEdit = (note) => {
        openTab(note);
    };

    const handleArchiveToggle = (note) => {
        promptToggleArchive(note, { confirmUnarchive: true });
    };

    const handleTaskToggle = (note, index, line) => taskToggleMutation.toggle(note, index, line);

    return (
        <div className="relative min-h-0">
            <div className="pb-24 pl-2 pr-2 sm:pr-6">
                <NotesGrid
                    notes={archivedNotes}
                    emptyMessage={"No Archived Notes..."}
                    onEdit={handleEdit}
                    onDelete={promptDelete}
                    onArchive={handleArchiveToggle}
                    onTaskToggle={handleTaskToggle}
                    orderList={ARCHIVE_ORDER}
                />
            </div>
        </div>
    );
};

export default Archive;
