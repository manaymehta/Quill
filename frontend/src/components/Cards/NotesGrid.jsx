import React, { useState, useEffect } from 'react';
import NoteCard from './NoteCard';
import EmptyCard from './EmptyCard';
import { useNotesStore } from '../../store/useNotesStore';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy, } from '@dnd-kit/sortable';

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
    const { reorderNotes } = useNotesStore();
    const [activeId, setActiveId] = useState(null);

    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 8, // Require 8px movement before drag starts so clicks don't drag
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 250,
                tolerance: 5,
            },
        })
    );

    // Dynamic columns for left-to-right masonry flow
    const getColumnCount = () => {
        if (typeof window === 'undefined') return 1;
        if (window.innerWidth >= 1280) return 4; // xl
        if (window.innerWidth >= 1024) return 3; // lg
        if (window.innerWidth >= 640) return 2;  // sm
        return 1;
    };

    const [cols, setCols] = useState(getColumnCount());

    useEffect(() => {
        const handleResize = () => setCols(getColumnCount());
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

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

    // Distribute notes left-to-right into columns
    const columns = Array.from({ length: cols }, () => []);
    notes.forEach((note) => {
        // Distribute based strictly on the current array order index so layout reflects state 1:1
        const index = notes.findIndex(n => n._id === note._id);
        columns[index % cols].push(note);
    });

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = (event) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over) return;

        if (active.id !== over.id) {
            const oldIndex = notes.findIndex((n) => n._id === active.id);
            const newIndex = notes.findIndex((n) => n._id === over.id);

            const newOrder = arrayMove(notes, oldIndex, newIndex);
            reorderNotes(newOrder); // Optimistic UI update & API save
        }
    };

    const handleDragCancel = () => {
        setActiveId(null);
    };

    const activeNote = activeId ? notes.find(n => n._id === activeId) : null;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <SortableContext items={notes.map(n => n._id)} strategy={rectSortingStrategy}>
                <div className="flex flex-row gap-5 sm:pr-10 w-full items-start">
                    {columns.map((col, colIndex) => (
                        <div key={colIndex} className="flex flex-col gap-5 flex-1 min-w-0">
                            {col.map((note) => (
                                <NoteCard
                                    key={note._id}
                                    id={note._id}
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
                    ))}
                </div>
            </SortableContext>

            <DragOverlay>
                {activeNote ? (
                    <NoteCard
                        id={activeNote._id}
                        title={activeNote.title}
                        date={activeNote.createdOn}
                        content={activeNote.content}
                        tags={activeNote.tags}
                        isPinned={activeNote.isPinned}
                        isChecklist={activeNote.isChecklist}
                        checklist={activeNote.checklist}
                        isArchived={activeNote.isArchived}
                        isTrash={isTrash}
                        isOverlay={true}
                    />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
};

export default NotesGrid;

