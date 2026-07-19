import { useState, useEffect, useMemo } from 'react';
import NoteCard from './NoteCard';
import EmptyCard from './EmptyCard';
import { useNotesStore } from '../../store/useNotesStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useSearchStore } from '../../store/useSearchStore';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';

const getCols = (isAIMode) => {
    if (typeof window === 'undefined') return 2;
    if (isAIMode) return window.innerWidth >= 1280 ? 3 : 2;
    if (window.innerWidth >= 1280) return 4;
    if (window.innerWidth >= 1024) return 3;
    return 2;
};

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
    hideFolderBadge = false,
}) => {
    const { reorderNotes, reorderHomeNotes } = useNotesStore();
    const { activeFolderId } = useFoldersStore();
    const { searchMode, isSearchingAI, semanticResult } = useSearchStore();
    const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);

    const [activeId, setActiveId] = useState(null);
    const [cols, setCols] = useState(() => getCols(isAIMode));

    const sortableItems = useMemo(() => (notes || []).map(n => n._id), [notes]);

    // Re-compute on window resize and whenever AI mode toggles
    useEffect(() => {
        setCols(getCols(isAIMode));
        const onResize = () => setCols(getCols(isAIMode));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [isAIMode]);

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    );

    if (loading && (!notes || notes.length === 0)) return null;

    if (!notes || notes.length === 0) {
        return (
            <div className={`flex items-center justify-center ${isTrash ? 'mt-20' : ''} w-full`}>
                <EmptyCard message={emptyMessage} />
            </div>
        );
    }

    // Distribute notes left-to-right into columns (index % cols preserves visual reading order)
    const columns = Array.from({ length: cols }, () => []);
    notes.forEach((note, i) => columns[i % cols].push(note));

    const handleDragStart = ({ active }) => setActiveId(active.id);

    const handleDragEnd = ({ active, over }) => {
        setActiveId(null);
        if (!allowDrag || !over || active.id === over.id) return;

        const oldIndex = notes.findIndex((n) => n._id === active.id);
        const newIndex = notes.findIndex((n) => n._id === over.id);
        const newOrder = arrayMove(notes, oldIndex, newIndex);

        if (activeFolderId === null) {
            reorderHomeNotes(newOrder);
        } else {
            reorderNotes(newOrder, activeFolderId);
        }
    };

    const handleDragCancel = () => setActiveId(null);

    const activeNote = notes.find(n => n._id === activeId) ?? null;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <SortableContext items={sortableItems} strategy={rectSortingStrategy}>
                <div className={`flex flex-row gap-2 md:gap-3 sm:pr-10 w-full items-start ${activeId ? 'is-dragging-active' : ''}`}>
                    {columns.map((col, colIndex) => (
                        <div key={colIndex} className="flex flex-col gap-2 md:gap-3 flex-1 min-w-0">
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
                                    onEdit={() => onEdit?.(note)}
                                    onDelete={() => onDelete?.(note)}
                                    onArchive={() => onArchive?.(note)}
                                    onChecklistToggle={(i) => onChecklistToggle?.(note, i)}
                                    onRestore={() => onRestore?.(note)}
                                    hideFolderBadge={hideFolderBadge}
                                    linkPreviews={note.linkPreviews}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </SortableContext>

            <DragOverlay>
                {activeNote && (
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
                        linkPreviews={activeNote.linkPreviews}
                    />
                )}
            </DragOverlay>
        </DndContext>
    );
};

export default NotesGrid;
