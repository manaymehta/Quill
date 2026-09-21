import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { MdEdit, MdDelete, MdPalette, MdFolder, MdOutlineFolder, MdRestore, MdDeleteForever, MdMoreVert } from 'react-icons/md';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

const FolderCard = ({
    folder,
    subfoldersCount = 0,
    notesCount = 0,
    onRename,
    onDelete,
    onColorChange,
    isTrash = false,
    onRestore,
    onDeletePermanent,
    isOverlay = false
}) => {
    const navigate = useNavigate();
    const activeDropdownFolderId = useFoldersStore((state) => state.activeDropdownFolderId);
    const setActiveDropdownFolderId = useFoldersStore((state) => state.setActiveDropdownFolderId);
    const [isEditing, setIsEditing] = useState(false);
    const [nameVal, setNameVal] = useState(folder.name);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [coords, setCoords] = useState(null);

    const [shouldAnimate, setShouldAnimate] = useState(true);

    const isEditorActive = useTabsStore((state) => state.activeTabId !== 'home');
    const wasEditorActiveRef = useRef(isEditorActive);

    useLayoutEffect(() => {
        if (wasEditorActiveRef.current && !isEditorActive) {
            setShouldAnimate(true);
        }
        wasEditorActiveRef.current = isEditorActive;
    }, [isEditorActive]);

    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging,
    } = useSortable({ id: folder._id, disabled: isTrash || isOverlay });

    const showDropdown = activeDropdownFolderId === folder._id;

    const style = {
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? undefined : transition,
        zIndex: isOverlay ? 100 : (isDragging ? 0 : (showDropdown ? 40 : 'auto')),
        opacity: 1,
        touchAction: isDragging ? 'none' : 'pan-y',
    };

    // Auto-close dropdown when clicking outside anywhere or on scroll
    useEffect(() => {
        if (activeDropdownFolderId !== folder._id) return;
        const handleOutsideClick = (e) => {
            if (e.target.closest?.('.no-card-click')) return;
            setActiveDropdownFolderId(null);
        };
        const handleScroll = () => {
            setActiveDropdownFolderId(null);
        };

        document.addEventListener('click', handleOutsideClick);
        document.addEventListener('contextmenu', handleOutsideClick);
        document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
        return () => {
            document.removeEventListener('click', handleOutsideClick);
            document.removeEventListener('contextmenu', handleOutsideClick);
            document.removeEventListener('scroll', handleScroll, { capture: true });
        };
    }, [activeDropdownFolderId, folder._id, setActiveDropdownFolderId]);

    const longPressTimerRef = useRef(null);
    const touchStartPosRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        return () => {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
            }
        };
    }, [isDragging]);

    const handleTouchStart = (e) => {
        if (isDragging || isOverlay) return;
        const { activeDropdownNoteId, activeDropdownFolderId } = useFoldersStore.getState();
        if (activeDropdownNoteId !== null || activeDropdownFolderId !== null || showColorPicker) return;

        const touch = e.touches[0];
        if (!touch) return;
        touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

        longPressTimerRef.current = setTimeout(() => {
            flushSync(() => {
                setCoords({ x: touchStartPosRef.current.x, y: touchStartPosRef.current.y });
                setActiveDropdownFolderId(folder._id);
            });
        }, 500);
    };

    const handleTouchMove = (e) => {
        if (isOverlay) return;
        if (isDragging) {
            // Card is being dragged — close dropdown if open
            if (showDropdown) {
                setActiveDropdownFolderId(null);
            }
            return;
        }
        const touch = e.touches[0];
        if (!touch) return;
        const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
        const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
        if (dx > 20 || dy > 20) {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
            }
            if (showDropdown) {
                setActiveDropdownFolderId(null);
            }
        }
    };

    const handleTouchEnd = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };


    useEffect(() => {
        if (!showColorPicker) return;
        const handleOutsideClick = (e) => {
            if (e.target.closest?.('.color-picker-pop')) return;
            e.stopPropagation();
            e.preventDefault();
            setShowColorPicker(false);
            setCoords(null);
        };
        document.addEventListener('click', handleOutsideClick, true);
        return () => {
            document.removeEventListener('click', handleOutsideClick, true);
        };
    }, [showColorPicker]);

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
        { icon: <MdDeleteForever size={13} />, label: "Delete Forever", onClick: () => onDeletePermanent && onDeletePermanent(folder), danger: true, dividerBefore: true }
    ] : [
        { icon: <MdPalette size={13} />, label: "Color", onClick: () => setShowColorPicker(true) },
        { icon: <MdEdit size={13} />, label: "Rename", onClick: () => setIsEditing(true) },
        { icon: <MdDelete size={13} />, label: "Delete", onClick: () => onDelete(folder), danger: true, dividerBefore: true }
    ];

    const dragProps = isOverlay ? {} : { ...attributes, ...listeners };

    return (
        <div
            ref={isOverlay ? null : setNodeRef}
            style={style}
            {...dragProps}
            onTouchStart={(e) => {
                dragProps?.onTouchStart?.(e);
                handleTouchStart(e);
            }}
            onTouchMove={(e) => {
                dragProps?.onTouchMove?.(e);
                handleTouchMove(e);
            }}
            onTouchEnd={(e) => {
                dragProps?.onTouchEnd?.(e);
                handleTouchEnd(e);
            }}
            onTouchCancel={(e) => {
                dragProps?.onTouchCancel?.(e);
                handleTouchEnd(e);
            }}
            onClick={(e) => {
                if (isOverlay) return;
                if (e.target.closest('.no-card-click') || isDragging) return;
                if (isTrash) return;
                const { activeDropdownNoteId, activeDropdownFolderId, setActiveDropdownNoteId, setActiveDropdownFolderId } = useFoldersStore.getState();
                if (activeDropdownNoteId !== null || activeDropdownFolderId !== null || showColorPicker) {
                    e.stopPropagation();
                    e.preventDefault();
                    if (activeDropdownFolderId !== folder._id) {
                        setActiveDropdownNoteId(null);
                        setActiveDropdownFolderId(null);
                        setShowColorPicker(false);
                    }
                    return;
                }
                if (!isEditing) navigate(`/folder/${folder._id}`);
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isOverlay || isDragging || showDropdown) return;
                setCoords({ x: e.clientX, y: e.clientY });
                setActiveDropdownFolderId(folder._id);
            }}
            className={`folder-card-wrapper relative select-none [touch-action:manipulation] [-webkit-touch-callout:none] ${showDropdown ? 'z-40' : 'z-10'} ${isDragging ? 'is-dragging-active touch-none' : ''}`}
        >
            <div
                onAnimationEnd={() => setShouldAnimate(false)}
                style={showDropdown ? { zIndex: 40 } : undefined}
                className={`group physical-folder-card cursor-pointer select-none flex flex-col justify-between transition-transform duration-200 ease-out [-webkit-touch-callout:none]
                    ${showDropdown ? 'shadow-xl ring-1 ring-white/10' : ''}
                    ${shouldAnimate && !isOverlay ? 'animate-card-fade-in' : ''}
                    ${isDragging ? 'opacity-30' : 'opacity-100'}
                    ${isOverlay ? 'cursor-grabbing pointer-events-none' : ''}`}
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
                        className="p-2 sm:p-3 rounded-xl inline-flex items-center justify-center shadow-sm transition-transform group-hover:scale-110 duration-300"
                        style={{ backgroundColor: `${folder.color}20`, color: folder.color }}
                    >
                        <MdFolder className="text-[16cqi] sm:text-2xl" />
                    </div>

                    {/* Options Menu Button (compact, mobile-friendly) */}
                    {!isOverlay && (
                        <div className="relative no-card-click">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (showDropdown) {
                                        setActiveDropdownFolderId(null);
                                    } else {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        // Default: align menu start (left edge) with button position, expanding to the right
                                        setCoords({ x: rect.left, y: rect.bottom + 8 });
                                        setActiveDropdownFolderId(folder._id);
                                    }
                                }}
                                className="p-1 sm:p-1.5 text-stone-600 hover:text-stone-950 rounded-full hover:bg-stone-400 cursor-pointer transition-colors"
                                title="Options"
                            >
                                <MdMoreVert className="text-[14cqi] sm:text-xl" />
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
                            className="bg-[#2a2b2e] text-white text-[13cqi] sm:text-lg outline-none border border-[#e85d56] px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl w-full font-medium shadow-inner no-card-click"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <h3 className="text-[13.5cqi] sm:text-xl font-bold text-stone-900 tracking-tight truncate max-w-full group-hover:text-stone-950 transition-colors">
                            {folder.name}
                        </h3>
                    )}

                    <div className="flex items-center space-x-1 sm:space-x-2 mt-0.5 sm:mt-1.5 text-[8.5cqi] sm:text-[13px] text-stone-600 font-medium truncate max-w-full">
                        {subfoldersCount > 0 && (
                            <>
                                <span className="flex items-center shrink-0">
                                    <MdOutlineFolder className="mr-0.5 sm:mr-1 opacity-70 shrink-0 text-[9cqi] sm:text-[14px]" />
                                    {subfoldersCount}
                                </span>
                                <span className="w-1 h-1 rounded-full bg-stone-400 shrink-0" />
                            </>
                        )}
                        <span className="flex items-center truncate shrink-0">
                            {notesCount} {notesCount === 1 ? 'note' : 'notes'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Viewport-Aware Portal Context Menu */}
            {(showDropdown || coords) && createPortal(
                <AnimatePresence onExitComplete={() => setCoords(null)}>
                    {showDropdown && coords && (
                        <motion.div
                            key="folder-context-menu"
                            initial="closed"
                            animate="open"
                            exit="closed"
                            variants={shutterMenuVariants}
                            style={(() => {
                                const menuWidth = 165;
                                const menuHeight = isTrash ? 85 : 130;
                                const bottomMargin = window.innerWidth < 640 ? 76 : 16;
                                let finalX = coords.x;
                                if (finalX + menuWidth > window.innerWidth - 8) {
                                    finalX = Math.max(8, window.innerWidth - menuWidth - 8);
                                }
                                finalX = Math.max(8, finalX);
                                
                                // Ensure Y flips if bottom overflows screen
                                let finalY = coords.y;
                                if (finalY + menuHeight > window.innerHeight - bottomMargin) {
                                    finalY = Math.max(8, coords.y - menuHeight - 12);
                                }

                                return {
                                    position: 'fixed',
                                    left: `${finalX}px`,
                                    top: `${finalY}px`,
                                    zIndex: 9999,
                                    transformOrigin: 'top',
                                };
                            })()}
                            className="bg-[#1e1e20] p-1 rounded-2xl shadow-2xl flex flex-col gap-[5px] min-w-[165px] no-card-click border-0 outline-none overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {menuItems.map((item, idx) => (
                                <motion.button
                                    key={idx}
                                    variants={shutterItemVariants}
                                    onClick={() => {
                                        setActiveDropdownFolderId(null);
                                        item.onClick();
                                    }}
                                    className={`flex items-center justify-between gap-3 px-2 py-[6px] rounded-xl cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-full ${item.danger
                                        ? 'hover:bg-red-500/20 hover:text-red-400 text-red-400'
                                        : 'hover:bg-white/[0.15] hover:text-white text-stone-300'
                                        }`}
                                >
                                    <span>{item.label}</span>
                                    {React.cloneElement(item.icon, { className: "shrink-0" })}
                                </motion.button>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}

            {/* Viewport-Aware portal floating color picker */}
            {showColorPicker && coords && createPortal(
                <div
                    style={(() => {
                        const pickerWidth = 175;
                        const pickerHeight = 44;
                        
                        // Default to right of anchor point; flip left if it overflows right screen boundary
                        let finalX = coords.x;
                        if (finalX + pickerWidth > window.innerWidth - 8) {
                            finalX = Math.max(8, window.innerWidth - pickerWidth - 8);
                        }
                        finalX = Math.max(8, finalX);

                        let finalY = coords.y;
                        if (finalY + pickerHeight > window.innerHeight - 8) {
                            finalY = Math.max(8, coords.y - pickerHeight - 12);
                        }
                        return {
                            position: 'fixed',
                            left: `${finalX}px`,
                            top: `${finalY}px`,
                            zIndex: 9999,
                        };
                    })()}
                    className="bg-[#1e1e20] p-2 rounded-2xl shadow-2xl flex items-center space-x-2 z-[9999] no-card-click color-picker-pop border-0 outline-none"
                    onClick={(e) => e.stopPropagation()}
                >
                    {COLORS.map(c => (
                        <div
                            key={c}
                            onClick={() => {
                                onColorChange(folder._id, c);
                                setShowColorPicker(false);
                                setCoords(null);
                            }}
                            style={{ backgroundColor: c }}
                            className="w-6 h-6 rounded-full cursor-pointer hover:scale-125 transition-transform shadow-inner border border-black/20"
                        />
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
};

export default FolderCard;
