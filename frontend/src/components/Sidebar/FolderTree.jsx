import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../store/useUIStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useModalStore } from '../Modals/useModalStore';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useFoldersQuery } from '../../hooks/useNotesQuery';
import { useEditFolderMutation } from '../../hooks/useFolderMutations';
import { buildFolderHierarchy } from '../../utils/folderHierarchy';
import { MdKeyboardArrowDown, MdKeyboardArrowRight, MdEdit, MdDelete, MdPalette, MdFolder, MdFolderOpen } from 'react-icons/md';

const COLORS = ['#e85d56', '#f2994a', '#27ae60', '#2f80ed', '#9b51e0', '#e0e0e0'];

const shutterMenuVariants = {
    closed: {
        opacity: 0,
        scaleY: 0.82,
        y: -8,
        transition: {
            duration: 0.12,
            ease: [0.4, 0, 1, 1],
        },
    },
    open: {
        opacity: 1,
        scaleY: 1,
        y: 0,
        transition: {
            duration: 0.16,
            ease: [0.16, 1, 0.3, 1],
        },
    },
};

const shutterItemVariants = {
    closed: {
        opacity: 0,
        y: -4,
        transition: {
            duration: 0.1,
            ease: [0.4, 0, 1, 1],
        },
    },
    open: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.15,
            ease: [0.16, 1, 0.3, 1],
        },
    },
};

// Row variants — children inherit timing from parent stagger
const rowVariants = {
    open: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 500, damping: 38 } },
    closed: { opacity: 0, x: -10, transition: { duration: 0.12, ease: 'easeIn' } },
};

const FolderNode = ({ folder, expanded, onToggleExpand, activeFolderId, hierarchy }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
    const editFolderMutation = useEditFolderMutation();
    const { openFolderDeleteModal } = useModalStore();
    const [isEditing, setIsEditing] = useState(false);
    const [nameVal, setNameVal] = useState(folder.name);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [contextMenu, setContextMenu] = useState(null);
    const [closingMenuCoords, setClosingMenuCoords] = useState(null);

    const hasChildren = hierarchy ? hierarchy.hasChildren(folder._id) : false;
    const isActive = activeFolderId === folder._id;
    const paddingLeft = isSidebarOpen ? '2px' : '8px';

    const handleBlurOrSubmit = () => {
        setIsEditing(false);
        if (nameVal.trim() && nameVal.trim() !== folder.name) {
            editFolderMutation.mutate({ folderId: folder._id, patch: { name: nameVal.trim() } });
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
                        setClosingMenuCoords({ x: e.clientX, y: e.clientY });
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
            {(contextMenu || closingMenuCoords) && createPortal(
                <AnimatePresence onExitComplete={() => setClosingMenuCoords(null)}>
                    {contextMenu && (
                        <>
                            <motion.div
                                key="tree-backdrop"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.12 }}
                                className="fixed inset-0 z-[9998]"
                                onClick={() => setContextMenu(null)}
                                onMouseDown={(e) => e.stopPropagation()}
                                onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
                            />
                            <motion.div
                                key="tree-context-menu"
                                initial="closed"
                                animate="open"
                                exit="closed"
                                variants={shutterMenuVariants}
                                style={(() => {
                                    const coords = contextMenu || closingMenuCoords;
                                    const menuWidth = 160;
                                    const menuHeight = 130;
                                    let finalX = coords.x;
                                    let finalY = coords.y;

                                    if (coords.x + menuWidth > window.innerWidth) {
                                        finalX = Math.max(8, coords.x - menuWidth);
                                    }
                                    if (coords.y + menuHeight > window.innerHeight) {
                                        finalY = Math.max(8, coords.y - menuHeight);
                                    }

                                    return {
                                        position: 'fixed',
                                        left: `${finalX}px`,
                                        top: `${finalY}px`,
                                        transformOrigin: 'top',
                                        zIndex: 9999,
                                    };
                                })()}
                                className="bg-[#1e1e20] p-1 rounded-2xl shadow-2xl flex flex-col gap-[5px] min-w-[160px] no-card-click border-0 outline-none overflow-hidden"
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <motion.div variants={shutterItemVariants} className="px-2 pb-1 pt-0.5 text-[10px] font-semibold text-stone-500 uppercase tracking-widest select-none">
                                    Folder Options
                                </motion.div>
                                <motion.button
                                    variants={shutterItemVariants}
                                    onClick={(e) => { e.stopPropagation(); setContextMenu(null); setIsEditing(true); }}
                                    className="flex items-center justify-between gap-3 px-2 py-[6px] rounded-xl cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-full hover:bg-white/[0.09] hover:text-white text-stone-300"
                                >
                                    <span>Rename</span>
                                    <MdEdit size={13} className="shrink-0" />
                                </motion.button>
                                <motion.button
                                    variants={shutterItemVariants}
                                    onClick={(e) => { e.stopPropagation(); setContextMenu(null); setShowColorPicker(true); }}
                                    className="flex items-center justify-between gap-3 px-2 py-[6px] rounded-xl cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-full hover:bg-white/[0.09] hover:text-white text-stone-300"
                                >
                                    <span>Color</span>
                                    <MdPalette size={13} className="shrink-0" />
                                </motion.button>
                                <motion.button
                                    variants={shutterItemVariants}
                                    onClick={(e) => { e.stopPropagation(); setContextMenu(null); openFolderDeleteModal(folder); }}
                                    className="flex items-center justify-between gap-3 px-2 py-[6px] rounded-xl cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-full hover:bg-red-500/15 hover:text-red-400 text-red-400"
                                >
                                    <span>Delete</span>
                                    <MdDelete size={13} className="shrink-0" />
                                </motion.button>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>,
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
                        className="absolute left-8 top-10 bg-[#303134] p-2 rounded-2xl z-[101] shadow-xl flex space-x-1 border-0 outline-none"
                        onMouseLeave={() => setShowColorPicker(false)}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {COLORS.map(c => (
                            <div key={c} onClick={() => { editFolderMutation.mutate({ folderId: folder._id, patch: { color: c } }); setShowColorPicker(false); }} style={{ backgroundColor: c }} className="w-5 h-5 rounded-full cursor-pointer hover:scale-110 transition-transform" />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const FolderTree = ({ parentId = null, depth = 0, expandedFolders, onToggleExpand, activeFolderId, hierarchy: passedHierarchy }) => {
    const { data: folders = [] } = useFoldersQuery();
    const fallbackHierarchy = useMemo(() => buildFolderHierarchy(folders), [folders]);
    const hierarchy = passedHierarchy || fallbackHierarchy;
    const siblingFolders = hierarchy.getDirectChildren(parentId);

    if (siblingFolders.length === 0) return null;

    return (
        <div className="space-y-0.5">
            {siblingFolders.map((folder) => {
                const expanded = !!expandedFolders[folder._id];
                const hasActiveChild = hierarchy.getDirectChildren(folder._id).some(f => f._id === activeFolderId);
                return (
                    // variants inherited from parent — this is what enables stagger
                    <motion.div key={folder._id} variants={rowVariants} style={{ willChange: 'transform, opacity' }}>
                        <FolderNode
                            folder={folder}
                            depth={depth}
                            expanded={expanded}
                            onToggleExpand={onToggleExpand}
                            activeFolderId={activeFolderId}
                            hierarchy={hierarchy}
                        />
                        {/* Nested children use CSS grid trick — independent of top-level stagger */}
                        <div style={{
                            display: 'grid',
                            gridTemplateRows: expanded ? '1fr' : '0fr',
                            transition: 'grid-template-rows 180ms cubic-bezier(0.4,0,0.2,1)',
                        }}>
                            <div
                                style={{ overflow: 'hidden', minHeight: 0 }}
                                className={`ml-4 pl-1 border-l-2 ${hasActiveChild ? 'border-[#414549]' : 'border-[#2d3033]'}`}
                            >
                                <FolderTree
                                    parentId={folder._id}
                                    depth={depth + 1}
                                    expandedFolders={expandedFolders}
                                    onToggleExpand={onToggleExpand}
                                    activeFolderId={activeFolderId}
                                    hierarchy={hierarchy}
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
