import React from 'react';
import NoteCard from './NoteCard';
import EmptyCard from './EmptyCard';

const NotesGrid = ({
    notes,
    loading,
    emptyMessage,
    onEdit,
    onDelete,
    onPin,
    onArchive,
    onChecklistToggle,
    onRestore,
    isTrash
}) => {
    if (loading) {
        return <div className="p-4">Loading...</div>; // Simple loading state
    }

    if (!notes || notes.length === 0) {
        return (
            <div className={`flex items-center justify-center ${isTrash ? 'mt-20' : ''}`}> {/* Keep Trash styling consistent */}
                <EmptyCard message={emptyMessage} />
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:pr-10">
            {notes.map((note) => (
                <NoteCard
                    key={note._id}
                    title={note.title}
                    date={note.createdOn}
                    content={note.content}
                    tags={note.tags}
                    isPinned={note.isPinned}
                    isChecklist={note.isChecklist}
                    checklist={note.checklist}
                    isArchived={note.isArchived}
                    isTrash={isTrash}
                    onEdit={() => onEdit && onEdit(note)}
                    onDelete={() => onDelete && onDelete(note)}
                    onPinned={() => onPin && onPin(note)}
                    onArchive={() => onArchive && onArchive(note)}
                    onChecklistToggle={(index) => onChecklistToggle && onChecklistToggle(note, index)}
                    onRestore={() => onRestore && onRestore(note)}
                />
            ))}
        </div>
    );
};

export default NotesGrid;
