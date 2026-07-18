import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MdEdit, MdDelete, MdPalette, MdFolder, MdOutlineFolder, MdRestore, MdDeleteForever, MdMoreVert } from 'react-icons/md';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useNotesStore } from '../../store/useNotesStore';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const COLORS = ['#e85d56', '#f2994a', '#27ae60', '#2f80ed', '#9b51e0', '#e0e0e0'];

const FolderCard = ({ folder, onRename, onDelete, onColorChange, isTrash = false, onRestore, onDeletePermanent, isOverlay = false }) => {
    const navigate = useNavigate();
    const { folders, activeDropdownFolderId, setActiveDropdownFolderId } = useFoldersStore();
    const { allNotes } = useNotesStore();
    const [isEditing, setIsEditing] = useState(false);
    const [nameVal, setNameVal] = useState(folder.name);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [coords, setCoords] = useState(null);

    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging,
    } = useSortable({ id: folder._id, disabled: isTrash || isOverlay });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isOverlay ? 100 : (isDragging ? 0 : 'auto'),
        opacity: isOverlay ? 1 : (isDragging ? 0.3 : 1),
    };

    const showDropdown = activeDropdownFolderId === folder._id;

    // Auto-close dropdown when clicking or right-clicking outside anywhere
    useEffect(() => {
        if (activeDropdownFolderId !== folder._id) return;
        const handleOutsideClick = () => {
            setActiveDropdownFolderId(null);
            setCoords(null);
        };
        document.addEventListener('click', handleOutsideClick);
        document.addEventListener('contextmenu', handleOutsideClick);
        return () => {
            document.removeEventListener('click', handleOutsideClick);
            document.removeEventListener('contextmenu', handleOutsideClick);
        };
    }, [activeDropdownFolderId, folder._id, setActiveDropdownFolderId]);

    // Calculate subfolders and notes counts
    const subfoldersCount = folders.filter(f => f.parentId === folder._id && (isTrash || !f.isDeleted)).length;
    const notesCount = allNotes.filter(n => n.folderId === folder._id && (isTrash || (!n.isDeleted && !n.isArchived))).length;

    const handleRenameSubmit = () => {
        setIsEditing(false);
        if (nameVal.trim() && nameVal.trim() !== folder.name) {
            onRename(folder._id, nameVal.trim());
        } else {
            setNameVal(folder.name);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleRenameSubmit();
        if (e.key === 'Escape') {
            setIsEditing(false);
            setNameVal(folder.name);
        }
    };

    // Unified option menu configurations
    const menuItems = isTrash ? [
        { icon: <MdRestore size={13} />, label: "Restore", onClick: () => onRestore && onRestore(folder) },
        { icon: <MdDeleteForever size={13} />, label: "Delete Forever", onClick: () => onDeletePermanent && onDeletePermanent(folder), danger: true }
    ] : [
        { icon: <MdPalette size={13} />, label: "Color", onClick: () => setShowColorPicker(true) },
        { icon: <MdEdit size={13} />, label: "Rename", onClick: () => setIsEditing(true) },
        { icon: <MdDelete size={13} />, label: "Delete", onClick: () => onDelete(folder), danger: true }
    ];

    const dragProps = isOverlay ? {} : { ...attributes, ...listeners };

    return (
        <div
            ref={isOverlay ? null : setNodeRef}
            style={style}
            {...dragProps}
            onClick={(e) => {
                if (isOverlay) return;
                if (e.target.closest('.no-card-click') || isDragging) return;
                if (isTrash) return;
                if (!isEditing) navigate(`/folder/${folder._id}`);
            }}
            onContextMenu={(e) => {
                if (isOverlay || isDragging) return;
                e.preventDefault();
                e.stopPropagation();
                setCoords({ x: e.clientX, y: e.clientY });
                setActiveDropdownFolderId(folder._id);
            }}
            /* Lift card z-index to z-40 when dropdown is open to prevent overlap from cards/tabs below it */
            className={`group relative physical-folder-card p-5 cursor-pointer transition-[transform,box-shadow] duration-300 select-none flex flex-col h-[150px] justify-between hover:shadow-xl hover:-translate-y-1 ${showDropdown ? 'z-40 shadow-xl' : 'z-10'
                } ${isOverlay ? 'cursor-grabbing pointer-events-none' : ''}`}
        >
            {/* Inner background absolute elements container */}
            <div className="absolute inset-0 rounded-r-2xl rounded-bl-2xl overflow-hidden pointer-events-none">
                {/* Watermark Icon */}
                <MdFolder
                    size={120}
                    className="absolute -bottom-8 -right-6 opacity-[0.04] text-stone-900 rotate-12 pointer-events-none transition-transform duration-500 group-hover:rotate-6 group-hover:scale-110"
                />
            </div>

            {/* Header: Icon + Edit actions */}
            <div className={`flex justify-between items-start relative ${showDropdown ? 'z-20' : 'z-10'}`}>
                <div
                    className="p-3 rounded-xl inline-flex items-center justify-center shadow-sm transition-transform group-hover:scale-110 duration-300"
                    style={{ backgroundColor: `${folder.color}20`, color: folder.color }}
                >
                    <MdFolder size={26} />
                </div>

                {/* Options Menu Button (compact, mobile-friendly) */}
                {!isOverlay && (
                    <div className="relative no-card-click">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (showDropdown) {
                                    setActiveDropdownFolderId(null);
                                    setCoords(null);
                                } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    // Align menu below the 3-dots button, sticking to its right edge (160px width offset)
                                    setCoords({ x: rect.right - 160, y: rect.bottom + 8 });
                                    setActiveDropdownFolderId(folder._id);
                                }
                            }}
                            className="p-1.5 text-stone-600 hover:text-stone-950 rounded-full hover:bg-stone-400 cursor-pointer transition-colors"
                            title="Options"
                        >
                            <MdMoreVert size={20} />
                        </button>
                    </div>
                )}
            </div>

            {/* Folder Name & Stats */}
            <div className="relative z-10 mt-auto">
                {isEditing ? (
                    <input
                        autoFocus
                        type="text"
                        value={nameVal}
                        onChange={(e) => setNameVal(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={handleKeyDown}
                        className="bg-[#2a2b2e] text-white text-md outline-none border border-[#e85d56] px-3 py-1.5 rounded-xl w-full font-medium shadow-inner no-card-click"
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <h3 className="text-lg font-bold text-stone-900 tracking-tight truncate max-w-full group-hover:text-stone-950 transition-colors">
                        {folder.name}
                    </h3>
                )}

                <div className="flex items-center space-x-2 mt-1.5 text-[13px] text-stone-600 font-medium">
                    {subfoldersCount > 0 && (
                        <>
                            <span className="flex items-center">
                                <MdOutlineFolder className="mr-1 opacity-70" size={14} />
                                {subfoldersCount}
                            </span>
                            <span className="w-1 h-1 rounded-full bg-stone-400" />
                        </>
                    )}
                    <span className="flex items-center">
                        {notesCount} {notesCount === 1 ? 'note' : 'notes'}
                    </span>
                </div>
            </div>

            {/* Floating Color Picker (Matching context menu style, instant mount, solid color) */}
            {showColorPicker && (
                <div
                    className="absolute right-4 top-14 bg-[#2a2b2e] border border-[#3d3f43] p-2 rounded-lg shadow-xl flex space-x-1.5 z-50 animate-none no-card-click"
                    onMouseLeave={() => setShowColorPicker(false)}
                    onClick={(e) => e.stopPropagation()}
                >
                    {COLORS.map(c => (
                        <div
                            key={c}
                            onClick={() => {
                                onColorChange(folder._id, c);
                                setShowColorPicker(false);
                            }}
                            style={{ backgroundColor: c }}
                            className="w-5 h-5 rounded-full cursor-pointer hover:scale-125 transition-transform shadow-inner border border-black/20"
                        />
                    ))}
                </div>
            )}

            {/* Viewport-Aware portal context menu */}
            {showDropdown && coords && createPortal(
                <div
                    style={(() => {
                        const menuWidth = 160;
                        const menuHeight = isTrash ? 80 : 130;
                        let finalX = coords.x;
                        let finalY = coords.y;
                        let originX = 'left';
                        let originY = 'top';

                        if (coords.x + menuWidth > window.innerWidth) {
                            finalX = Math.max(8, coords.x - menuWidth);
                            originX = 'right';
                        }
                        if (coords.y + menuHeight > window.innerHeight) {
                            finalY = Math.max(8, coords.y - menuHeight);
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
                    className="bg-[#1e1e20]/96 backdrop-blur-xl border border-white/[0.08] py-1.5 rounded-xl shadow-2xl flex flex-col min-w-[160px] context-menu-pop no-card-click"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="px-3 pb-1 pt-0.5 text-[11px] font-semibold text-stone-400 uppercase tracking-widest select-none">
                        Folder Options
                    </div>
                    {menuItems.map((item, idx) => (
                        <React.Fragment key={idx}>
                            {idx === menuItems.length - 1 && (
                                <div className="h-[1px] bg-white/[0.06] mx-0 my-1" />
                            )}
                            <button
                                onClick={() => {
                                    setActiveDropdownFolderId(null);
                                    setCoords(null);
                                    item.onClick();
                                }}
                                className={`flex items-center gap-2 mx-1 px-2 py-[6px] rounded-md cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-[calc(100%-8px)] ${item.danger
                                    ? 'hover:bg-red-500/20 hover:text-red-400 text-red-400'
                                    : 'hover:bg-white/[0.15] hover:text-white text-stone-300'
                                    }`}
                            >
                                {React.cloneElement(item.icon, { className: "shrink-0" })}
                                <span>{item.label}</span>
                            </button>
                        </React.Fragment>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
};

export default FolderCard;
