import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useUIStore } from '../../store/useUIStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useModalStore } from '../Modals/useModalStore';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MdKeyboardArrowDown, MdKeyboardArrowRight, MdEdit, MdDelete, MdPalette, MdFolder, MdFolderOpen } from 'react-icons/md';

const COLORS = ['#e85d56', '#f2994a', '#27ae60', '#2f80ed', '#9b51e0', '#e0e0e0'];

// Row variants — children inherit timing from parent stagger
const rowVariants = {
    open: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 500, damping: 38 } },
    closed: { opacity: 0, x: -10, transition: { duration: 0.12, ease: 'easeIn' } },
};

const FolderNode = ({ folder, expanded, onToggleExpand, activeFolderId }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { isSidebarOpen } = useUIStore();
    const { folders, editFolder } = useFoldersStore();
    const { openFolderDeleteModal } = useModalStore();
    const [isEditing, setIsEditing] = useState(false);
    const [nameVal, setNameVal] = useState(folder.name);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [contextMenu, setContextMenu] = useState(null);

    const hasChildren = folders.some(f => f.parentId === folder._id && !f.isDeleted);
    const isActive = activeFolderId === folder._id;
    const paddingLeft = isSidebarOpen ? '2px' : '8px';

    const handleBlurOrSubmit = () => {
        setIsEditing(false);
        if (nameVal.trim() && nameVal.trim() !== folder.name) {
            editFolder(folder._id, { name: nameVal.trim() });
        } else {
            setNameVal(folder.name);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleBlurOrSubmit();
        if (e.key === 'Escape') { setIsEditing(false); setNameVal(folder.name); }
    };

    return (
        <div style={{ paddingLeft }} className="group relative">
            <div
                onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                onClick={() => {
                    const targetPath = `/folder/${folder._id}`;
                    if (location.pathname === targetPath) {
                        useTabsStore.getState().setActiveTab('home');
                    } else {
                        navigate(targetPath);
                    }
                    if (window.matchMedia('(max-width: 639px)').matches && isSidebarOpen) {
                        useUIStore.getState().toggleSidebar();
                    }
                }}
                onContextMenu={(e) => {
                    if (isSidebarOpen && !isEditing) {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({ x: e.clientX, y: e.clientY });
                    }
                }}
                className={`flex items-center justify-between h-10 w-full rounded-lg cursor-pointer transition-colors duration-150 ${isActive ? 'bg-[#4c2f2e] text-[#e85d56]' : 'text-gray-300 hover:bg-[#282a2d]'} select-none`}
            >
                <div className="flex items-center justify-between w-full min-w-0 px-2">
                    <div className="flex items-center min-w-0 flex-1">
                        <span style={{ color: '#f4eadc' }} className={`mr-2 flex-shrink-0 ${!isSidebarOpen && 'mx-auto flex justify-center w-full'}`}>
                            {expanded ? <MdFolderOpen size={isSidebarOpen ? 20 : 24} /> : <MdFolder size={isSidebarOpen ? 20 : 24} />}
                        </span>
                        {isSidebarOpen && (
                            <div className="flex-1 min-w-0">
                                {isEditing ? (
                                    <input
                                        autoFocus type="text" value={nameVal}
                                        onChange={(e) => setNameVal(e.target.value)}
                                        onBlur={handleBlurOrSubmit}
                                        onKeyDown={handleKeyDown}
                                        className="bg-[#202124] text-white text-sm outline-none border border-[#e85d56] px-1 py-0.5 rounded w-full"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span className="text-sm font-medium truncate block">{folder.name}</span>
                                )}
                            </div>
                        )}
                    </div>
                    {isSidebarOpen && hasChildren && (
                        <div
                            onClick={(e) => { e.stopPropagation(); onToggleExpand(folder._id); }}
                            className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-white rounded ml-2 flex-shrink-0"
                        >
                            {expanded ? <MdKeyboardArrowDown size={18} /> : <MdKeyboardArrowRight size={18} />}
                        </div>
                    )}
                </div>
            </div>

            {/* Context Menu inside React Portal */}
            {contextMenu && createPortal(
                <>
                    <div
                        className="fixed inset-0 z-[9998]"
                        onClick={() => setContextMenu(null)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
                    />
                    <div
                        style={(() => {
                            const menuWidth = 160;
                            const menuHeight = 130;
                            let finalX = contextMenu.x;
                            let finalY = contextMenu.y;
                            let originX = 'left';
                            let originY = 'top';

                            if (contextMenu.x + menuWidth > window.innerWidth) {
                                finalX = Math.max(8, contextMenu.x - menuWidth);
                                originX = 'right';
                            }
                            if (contextMenu.y + menuHeight > window.innerHeight) {
                                finalY = Math.max(8, contextMenu.y - menuHeight);
                                originY = 'bottom';
                            }

                            return {
                                position: 'fixed',
                                left: `${finalX}px`,
                                top: `${finalY}px`,
                                transformOrigin: `${originY} ${originX}`,
                                zIndex: 9999,
                            };
                        })()}
                        className="bg-[#1e1e20]/96 backdrop-blur-xl border border-white/[0.08] py-1.5 rounded-lg shadow-2xl flex flex-col min-w-[160px] context-menu-pop"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold text-stone-500 uppercase tracking-widest select-none">
                            Folder Options
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); setContextMenu(null); setIsEditing(true); }}
                            className="flex items-center gap-2 mx-1 px-2 py-[6px] rounded-md cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-[calc(100%-8px)] hover:bg-white/[0.09] hover:text-white text-stone-300"
                        >
                            <MdEdit size={13} />
                            Rename
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setContextMenu(null); setShowColorPicker(true); }}
                            className="flex items-center gap-2 mx-1 px-2 py-[6px] rounded-md cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-[calc(100%-8px)] hover:bg-white/[0.09] hover:text-white text-stone-300"
                        >
                            <MdPalette size={13} />
                            Color
                        </button>
                        <div className="h-[1px] bg-white/[0.06] mx-0 my-1" />
                        <button
                            onClick={(e) => { e.stopPropagation(); setContextMenu(null); openFolderDeleteModal(folder); }}
                            className="flex items-center gap-2 mx-1 px-2 py-[6px] rounded-md cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-[calc(100%-8px)] hover:bg-red-500/15 hover:text-red-400 text-red-400"
                        >
                            <MdDelete size={13} />
                            Delete
                        </button>
                    </div>
                </>,
                document.body
            )}

            {showColorPicker && isSidebarOpen && (
                <>
                    <div
                        className="fixed inset-0 z-[100]"
                        onClick={() => setShowColorPicker(false)}
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                    <div
                        className="absolute left-8 top-10 bg-[#303134] border border-gray-700 p-2 rounded-lg z-[101] shadow-xl flex space-x-1"
                        onMouseLeave={() => setShowColorPicker(false)}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {COLORS.map(c => (
                            <div key={c} onClick={() => { editFolder(folder._id, { color: c }); setShowColorPicker(false); }} style={{ backgroundColor: c }} className="w-5 h-5 rounded-full cursor-pointer hover:scale-110 transition-transform" />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

// FolderTree renders rows — each row is a motion.div that inherits variants from the
// AnimatePresence parent in Sidebar. No local initial/animate — the parent drives everything.
const FolderTree = ({ parentId = null, depth = 0, expandedFolders, onToggleExpand, activeFolderId }) => {
    const { folders } = useFoldersStore();
    const siblingFolders = folders
        .filter(f => f.parentId === parentId && !f.isDeleted)
        .sort((a, b) => a.orderIndex - b.orderIndex);

    if (siblingFolders.length === 0) return null;

    return (
        <div className="space-y-0.5">
            {siblingFolders.map((folder) => {
                const expanded = !!expandedFolders[folder._id];
                return (
                    // variants inherited from parent — this is what enables stagger
                    <motion.div key={folder._id} variants={rowVariants} style={{ willChange: 'transform, opacity' }}>
                        <FolderNode
                            folder={folder}
                            depth={depth}
                            expanded={expanded}
                            onToggleExpand={onToggleExpand}
                            activeFolderId={activeFolderId}
                        />
                        {/* Nested children use CSS grid trick — independent of top-level stagger */}
                        <div style={{
                            display: 'grid',
                            gridTemplateRows: expanded ? '1fr' : '0fr',
                            transition: 'grid-template-rows 180ms cubic-bezier(0.4,0,0.2,1)',
                        }}>
                            <div
                                style={{ overflow: 'hidden', minHeight: 0 }}
                                className={`ml-4 pl-1 border-l-2 ${folders.some(f => f.parentId === folder._id && !f.isDeleted && f._id === activeFolderId) ? 'border-[#414549]' : 'border-[#2d3033]'}`}
                            >
                                <FolderTree
                                    parentId={folder._id}
                                    depth={depth + 1}
                                    expandedFolders={expandedFolders}
                                    onToggleExpand={onToggleExpand}
                                    activeFolderId={activeFolderId}
                                />
                            </div>
                        </div>
                    </motion.div>
                );
            })}
        </div>
    );
};

export default FolderTree;
