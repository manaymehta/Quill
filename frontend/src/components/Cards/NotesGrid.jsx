import { useState, useEffect, useCallback } from 'react';
import NoteCard from './NoteCard';
import EmptyCard from './EmptyCard';
import { useNotesStore } from '../../store/useNotesStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useSearchStore } from '../../store/useSearchStore';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy, } from '@dnd-kit/sortable';

const NotesGrid = ({
    notes,
    loading,
    emptyMessage,
    onEdit,
    onDelete,
    onArchive,
    onChecklistToggle,
    onRestore,
    isTrash,
    allowDrag = true,
    hideFolderBadge = false
}) => {
    const { reorderNotes, reorderHomeNotes } = useNotesStore();
    const { activeFolderId } = useFoldersStore();
    const { searchMode, isSearchingAI, semanticResult } = useSearchStore();
    const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);
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
    const getColumnCount = useCallback(() => {
        if (typeof window === 'undefined') return 2;
        
        // Drop a column if the AI side panel is taking up 1/3 of the screen width
        if (isAIMode) {
            if (window.innerWidth >= 1280) return 3;
            if (window.innerWidth >= 1024) return 2;
            if (window.innerWidth >= 640) return 2;
            return 2;
        }

        if (window.innerWidth >= 1280) return 4; // xl
        if (window.innerWidth >= 1024) return 3; // lg
        if (window.innerWidth >= 640) return 2;  // sm
        return 2; // Mobile is now 2 columns like Google Keep
    }, [isAIMode]);

    const [cols, setCols] = useState(getColumnCount());

    useEffect(() => {
        const handleResize = () => setCols(getColumnCount());
        window.addEventListener('resize', handleResize);
        
        // Re-evaluate immediately when AI mode toggles
        setCols(getColumnCount());
        
        return () => window.removeEventListener('resize', handleResize);
    }, [getColumnCount]);

    // During loading, render nothing only if we don't have cached notes to show
    if (loading && (!notes || notes.length === 0)) {
        return null;
    }

    if (!notes || notes.length === 0) {
        return (
            <div className={`flex items-center justify-center ${isTrash ? 'mt-20' : ''} w-full`}>
                <EmptyCard message={emptyMessage} />
            </div>
        );
    }

    // Distribute notes left-to-right into columns
    const columns = Array.from({ length: cols }, () => []);
    notes.forEach((note, index) => {
        columns[index % cols].push(note);
    });

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = (event) => {
        setActiveId(null);
        if (!allowDrag) return; // Let it snap back, do not save

        const { active, over } = event;
        if (!over) return;

        if (active.id !== over.id) {
            const oldIndex = notes.findIndex((n) => n._id === active.id);
            const newIndex = notes.findIndex((n) => n._id === over.id);

            const newOrder = arrayMove(notes, oldIndex, newIndex);
            if (activeFolderId === null) {
                reorderHomeNotes(newOrder);
            } else {
                reorderNotes(newOrder, activeFolderId);
            }
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
                <div className="flex flex-row gap-2 md:gap-4 sm:pr-10 w-full items-start">
                    {columns.map((col, colIndex) => (
                        <div key={colIndex} className="flex flex-col gap-2 md:gap-4 flex-1 min-w-0">
                            {col.map((note, noteIndex) => (
                                <NoteCard
                                    key={note._id}
                                    index={noteIndex}
                                    id={note._id}
                                    title={note.title}
                                    content={note.content}
                                    tags={note.tags}
                                    folderId={note.folderId}
                                    isChecklist={note.isChecklist}
                                    checklist={note.checklist}
                                    isArchived={note.isArchived}
                                    isTrash={isTrash}
                                    onEdit={() => onEdit && onEdit(note)}
                                    onDelete={() => onDelete && onDelete(note)}
                                    onArchive={() => onArchive && onArchive(note)}
                                    onChecklistToggle={(index) => onChecklistToggle && onChecklistToggle(note, index)}
                                    onRestore={() => onRestore && onRestore(note)}
                                    hideFolderBadge={hideFolderBadge}
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
                        content={activeNote.content}
                        tags={activeNote.tags}
                        folderId={activeNote.folderId}
                        isChecklist={activeNote.isChecklist}
                        checklist={activeNote.checklist}
                        isArchived={activeNote.isArchived}
                        isTrash={isTrash}
                        isOverlay={true}
                        hideFolderBadge={hideFolderBadge}
                    />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
};

export default NotesGrid;
