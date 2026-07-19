import React, { useState, useMemo } from 'react';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { MdFolder, MdAdd } from 'react-icons/md';
import FolderCard from './FolderCard';
import { useFoldersStore } from '../../store/useFoldersStore';

const FoldersGrid = ({
    folders,
    parentId = null,
    onRename,
    onColorChange,
    onDelete,
    isAddingFolder,
    setIsAddingFolder,
    isTrash = false,
    onRestore,
    onDeletePermanent
}) => {
    const { reorderFolders, createFolder } = useFoldersStore();
    const [newFolderNameInline, setNewFolderNameInline] = useState('');
    const [activeId, setActiveId] = useState(null);

    const sortableItems = useMemo(() => (folders || []).map(f => f._id), [folders]);

    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 3,
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 250,
                tolerance: 5,
            },
        })
    );

    const handleCreateFolderInline = async () => {
        if (newFolderNameInline.trim()) {
            await createFolder(newFolderNameInline.trim(), parentId);
        }
        setIsAddingFolder(false);
        setNewFolderNameInline('');
    };

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = (event) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over) return;

        if (active.id !== over.id) {
            const oldIndex = folders.findIndex((f) => f._id === active.id);
            const newIndex = folders.findIndex((f) => f._id === over.id);

            const newFolders = arrayMove(folders, oldIndex, newIndex);
            const updates = newFolders.map((f, idx) => ({
                _id: f._id,
                orderIndex: idx
            }));
            reorderFolders(parentId, updates);
        }
    };

    const handleDragCancel = () => {
        setActiveId(null);
    };

    const activeFolder = activeId ? folders.find((f) => f._id === activeId) : null;

    // Inner grid content
    const gridContent = (
        <div className={`grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4 ${activeId ? 'is-dragging-active' : ''}`}>
            {folders.map(folder => (
                <FolderCard
                    key={folder._id}
                    folder={folder}
                    onRename={onRename}
                    onColorChange={onColorChange}
                    onDelete={onDelete}
                    isTrash={isTrash}
                    onRestore={onRestore}
                    onDeletePermanent={onDeletePermanent}
                />
            ))}

            {/* Inline Adding Card (Not sortable/draggable, kept at the end) */}
            {isAddingFolder && (
                <div 
                    key="inline-add-folder-card"
                    className="group relative physical-folder-card p-5 select-none flex flex-col h-[150px] justify-between z-10"
                >
                    <div 
                        className="p-3 rounded-xl inline-flex items-center justify-center shadow-sm self-start"
                        style={{ backgroundColor: '#e85d5620', color: '#e85d56' }}
                    >
                        <MdFolder size={26} />
                    </div>
                    <div className="mt-auto relative z-10 no-card-click">
                        <input
                            autoFocus
                            type="text"
                            placeholder="Folder name..."
                            value={newFolderNameInline}
                            onChange={(e) => setNewFolderNameInline(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateFolderInline();
                                if (e.key === 'Escape') {
                                    setIsAddingFolder(false);
                                    setNewFolderNameInline('');
                                }
                            }}
                            onBlur={handleCreateFolderInline}
                            className="bg-[#2a2b2e] text-white text-md outline-none border border-[#e85d56] px-3 py-1.5 rounded-lg w-full font-medium shadow-inner"
                        />
                    </div>
                </div>
            )}

            {/* New Folder Placeholder Card (Not sortable/draggable, kept at the end) */}
            {!isAddingFolder && !isTrash && (
                <div 
                    key="new-folder-placeholder-card"
                    onClick={() => setIsAddingFolder(true)}
                    className="group relative cursor-pointer transition-transform duration-300 select-none flex flex-col h-[150px] items-center justify-center hover:-translate-y-1 mt-6"
                >
                    <svg
                        className="absolute w-full pointer-events-none"
                        style={{ height: '174px', top: '-24px', left: 0, overflow: 'visible' }}
                        viewBox="0 0 320 174"
                        preserveAspectRatio="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            className="transition-colors duration-300 group-hover:stroke-[#5a5f63]"
                            d="M 0,158 L 0,16 A 16,16 0 0 1 16,0 L 136,0 C 152,0 160,24 176,24 L 304,24 A 16,16 0 0 1 320,40 L 320,158 A 16,16 0 0 1 304,174 L 16,174 A 16,16 0 0 1 0,158 Z"
                            fill="none"
                            stroke="#3c4043"
                            strokeWidth="2"
                            strokeDasharray="6 4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                        />
                    </svg>
                    <div className="relative z-10 p-4 rounded-full bg-[#3c4043]/30 text-gray-400 group-hover:text-[#e85d56] group-hover:bg-[#e85d56]/10 transition-colors duration-300">
                        <MdAdd size={32} />
                    </div>
                    <span className="relative z-10 mt-3 text-sm font-medium text-gray-500 group-hover:text-gray-300 transition-colors">New Folder</span>
                </div>
            )}
        </div>
    );

    // If it's trash, render static layout without drag context.
    if (isTrash) {
        return gridContent;
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <SortableContext items={sortableItems} strategy={rectSortingStrategy}>
                {gridContent}
            </SortableContext>

            <DragOverlay>
                {activeFolder ? (
                    <FolderCard
                        folder={activeFolder}
                        isOverlay={true}
                    />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
};

export default FoldersGrid;
