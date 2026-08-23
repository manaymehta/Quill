import { useState, useEffect, useMemo } from 'react';
import NoteCard from './NoteCard';
import EmptyCard from './EmptyCard';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useSearchStore } from '../../store/useSearchStore';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useReorderNotesMutation, useReorderHomeNotesMutation } from '../../hooks/useNoteMutations';

const dropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.4',
      },
    },
  }),
};

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
    onToggleHome,
    onPin,
    onMove,
    isTrash,
    allowDrag = true,
    hideFolderBadge = false,
}) => {
    const reorderNotesMutation = useReorderNotesMutation();
    const reorderHomeNotesMutation = useReorderHomeNotesMutation();
    const { activeFolderId } = useFoldersStore();
    const { searchMode, isSearchingAI, semanticResult } = useSearchStore();
    const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);

    const [items, setItems] = useState(notes || []);
    const [activeId, setActiveId] = useState(null);
    const [cols, setCols] = useState(() => getCols(isAIMode));

    // Keep local items synchronized with incoming notes prop
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(notes || []);
    }, [notes]);

    const sortableItems = useMemo(() => (items || []).map(n => n._id), [items]);

    // Re-compute on window resize and whenever AI mode toggles
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCols(getCols(isAIMode));
        const onResize = () => setCols(getCols(isAIMode));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [isAIMode]);

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 6 } }),
    );

    if (loading && (!items || items.length === 0)) return null;

    if (!items || items.length === 0) {
        return (
            <div className={`flex items-center justify-center ${isTrash ? 'mt-20' : ''} w-full`}>
                <EmptyCard message={emptyMessage} />
            </div>
        );
    }

    // Distribute notes left-to-right into columns (index % cols preserves visual reading order)
    const columns = Array.from({ length: cols }, () => []);
    items.forEach((note, i) => columns[i % cols].push(note));

    const handleDragStart = ({ active }) => setActiveId(active.id);

    const handleDragEnd = ({ active, over }) => {
        setActiveId(null);
        if (!allowDrag || !over || active.id === over.id) return;

        const oldIndex = items.findIndex((n) => n._id === active.id);
        const newIndex = items.findIndex((n) => n._id === over.id);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

        const newOrder = arrayMove(items, oldIndex, newIndex);
        setItems(newOrder);

        if (activeFolderId === null) {
            const updates = newOrder.map((n, idx) => ({ _id: n._id, homeOrderIndex: idx }));
            reorderHomeNotesMutation.mutate({ updates, reorderedNotes: newOrder });
        } else {
            const updates = newOrder.map((n, idx) => ({ _id: n._id, orderIndex: idx }));
            reorderNotesMutation.mutate({ updates, reorderedNotes: newOrder, folderId: activeFolderId });
        }
    };

    const handleDragCancel = () => setActiveId(null);

    const activeNote = (items || []).find(n => n._id === activeId) ?? null;

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
                                    showInHome={note.showInHome}
                                    isTrash={isTrash}
                                    onEdit={() => onEdit?.(note)}
                                    onDelete={() => onDelete?.(note)}
                                    onArchive={() => onArchive?.(note)}
                                    onToggleHome={() => (onToggleHome || onPin)?.(note)}
                                    onMove={(targetFolderId) => onMove?.(note._id, targetFolderId)}
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

            <DragOverlay dropAnimation={dropAnimation}>
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
