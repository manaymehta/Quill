import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MdEdit, MdDelete, MdPalette, MdFolder, MdOutlineFolder, MdRestore, MdDeleteForever, MdMoreVert } from 'react-icons/md';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useNotesStore } from '../../store/useNotesStore';

const COLORS = ['#e85d56', '#f2994a', '#27ae60', '#2f80ed', '#9b51e0', '#e0e0e0'];

const FolderCard = ({ folder, onRename, onDelete, onColorChange, isTrash = false, onRestore, onDeletePermanent }) => {
    const navigate = useNavigate();
    const { folders, activeDropdownFolderId, setActiveDropdownFolderId } = useFoldersStore();
    const { allNotes } = useNotesStore();
    const [isEditing, setIsEditing] = useState(false);
    const [nameVal, setNameVal] = useState(folder.name);
    const [showColorPicker, setShowColorPicker] = useState(false);

    const showDropdown = activeDropdownFolderId === folder._id;

    // Auto-close dropdown when clicking outside
    useEffect(() => {
        if (activeDropdownFolderId !== folder._id) return;
        const handleOutsideClick = () => setActiveDropdownFolderId(null);
        document.addEventListener('click', handleOutsideClick);
        return () => document.removeEventListener('click', handleOutsideClick);
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

    // Unified option menu configurations matching sidebar context menu items
    const menuItems = isTrash ? [
        { icon: <MdRestore size={14} />, label: "Restore", onClick: () => onRestore && onRestore(folder) },
        { icon: <MdDeleteForever size={14} />, label: "Delete Forever", onClick: () => onDeletePermanent && onDeletePermanent(folder), danger: true }
    ] : [
        { icon: <MdPalette size={14} />, label: "Color", onClick: () => setShowColorPicker(true) },
        { icon: <MdEdit size={14} />, label: "Rename", onClick: () => setIsEditing(true) },
        { icon: <MdDelete size={14} />, label: "Delete", onClick: () => onDelete(folder), danger: true }
    ];

    return (
        <div 
            onClick={() => {
                if (isTrash) return;
                if (!isEditing) navigate(`/folder/${folder._id}`);
            }}
            /* Lift card z-index to z-40 when dropdown is open to prevent overlap from cards/tabs below it */
            className={`group relative physical-folder-card p-5 cursor-pointer transition-[transform,box-shadow] duration-300 select-none flex flex-col h-[150px] justify-between hover:shadow-xl hover:-translate-y-1 ${
                showDropdown ? 'z-40 shadow-xl' : 'z-10'
            }`}
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
                <div className="relative">
                    <button
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            setActiveDropdownFolderId(showDropdown ? null : folder._id); 
                        }}
                        className="p-1.5 text-stone-600 hover:text-stone-950 rounded-full hover:bg-stone-300 transition-colors"
                        title="Options"
                    >
                        <MdMoreVert size={20} />
                    </button>

                    {/* Instant-mount solid dropdown menu (aligned with sidebar context menu layout, no opacity) */}
                    {showDropdown && (
                        <div 
                            className="absolute right-0 top-9 bg-[#2a2b2e] border border-[#3d3f43] p-1.5 rounded-lg shadow-xl flex flex-col gap-0.5 min-w-[140px] z-50"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {menuItems.map((item, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        setActiveDropdownFolderId(null);
                                        item.onClick();
                                    }}
                                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-colors text-left w-full ${
                                        item.danger 
                                            ? 'hover:bg-[#4a1c1d] hover:text-[#ff8f8a] text-[#ff8f8a]' 
                                            : 'hover:bg-[#3d3f43] hover:text-white text-stone-300'
                                    }`}
                                >
                                    {React.cloneElement(item.icon, { className: "shrink-0" })}
                                    <span>{item.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
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
                        className="bg-[#2a2b2e] text-white text-md outline-none border border-[#e85d56] px-3 py-1.5 rounded-lg w-full font-medium shadow-inner"
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
                    className="absolute right-4 top-14 bg-[#2a2b2e] border border-[#3d3f43] p-2 rounded-lg shadow-xl flex space-x-1.5 z-50 animate-none"
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
        </div>
    );
};

export default FolderCard;
