import React, { useState, useEffect } from 'react';
import { MdClose, MdSearch, MdOutlineFolder, MdHomeFilled } from 'react-icons/md';
import { useFoldersStore } from '../../store/useFoldersStore';
import { motion, AnimatePresence } from 'framer-motion';

const MoveToPicker = ({ isOpen, onClose, noteId, currentFolderId, onMove }) => {
    const { folders } = useFoldersStore();
    const [searchVal, setSearchVal] = useState('');

    // Reset search when modal opens
    useEffect(() => {
        if (isOpen) setSearchVal('');
    }, [isOpen]);

    // Recursive helper to sort and flatten folders with depth indicator
    const getFlattenedTree = (parentId = null, depth = 0) => {
        let result = [];
        const siblings = folders
            .filter(f => f.parentId === parentId && !f.isDeleted)
            .sort((a, b) => a.orderIndex - b.orderIndex);

        siblings.forEach(folder => {
            result.push({ ...folder, depth });
            result = result.concat(getFlattenedTree(folder._id, depth + 1));
        });
        return result;
    };

    const flatTree = getFlattenedTree(null, 0);

    const filteredTree = flatTree.filter(f => 
        f.name.toLowerCase().includes(searchVal.toLowerCase())
    );

    const handleSelect = (targetFolderId) => {
        onMove(noteId, targetFolderId);
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-6 bg-stone-900/40 backdrop-blur-[2px]"
                    onClick={onClose}
                >
                    {/* Modal card — scale pops independently */}
                    <motion.div 
                        initial={{ scale: 0.88 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0.88 }}
                        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                        style={{ position: 'relative', zIndex: 1 }}
                        className="w-full max-w-sm bg-[#202124] rounded-2xl shadow-2xl border border-[#3c4043] overflow-hidden flex flex-col max-h-[80vh]"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 pt-5 pb-2 shrink-0">
                            <div>
                                <h2 className="text-lg font-bold text-gray-100 tracking-tight">Select destination folder</h2>
                            </div>
                            <button 
                                onClick={onClose} 
                                className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
                            >
                                <MdClose size={20} />
                            </button>
                        </div>

                        {/* Search Input */}
                        <div className="px-5 pt-2 pb-3 shrink-0">
                            <div className="flex items-center bg-[#2d2e30] border border-stone-700 px-3 py-2.5 rounded-xl transition-colors focus-within:bg-[#323436] focus-within:border-[#e85d56] focus-within:ring-2 focus-within:ring-[#e85d56]/20">
                                <MdSearch size={18} className="text-gray-400 mr-2 shrink-0" />
                                <input
                                    type="text"
                                    placeholder="Find a folder..."
                                    value={searchVal}
                                    onChange={(e) => setSearchVal(e.target.value)}
                                    className="bg-transparent text-gray-200 text-sm font-medium outline-none w-full placeholder:text-gray-500 placeholder:font-normal"
                                />
                            </div>
                        </div>

                        {/* Folders List */}
                        <div className="overflow-y-auto px-3 pb-4 flex-grow editor-scrollbar space-y-0.5">
                            {!searchVal && (
                                <button
                                    onClick={() => handleSelect(null)}
                                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center group cursor-pointer ${
                                        currentFolderId === null
                                            ? 'bg-[#4c2f2e]/60 text-[#e85d56]'
                                            : 'text-gray-300 hover:bg-[#282a2d]'
                                    }`}
                                >
                                    <div className={`p-1.5 rounded-lg mr-3 transition-colors ${currentFolderId === null ? 'bg-[#e85d56]/20 text-[#e85d56]' : 'bg-[#2d2e30] text-gray-400 group-hover:bg-[#36383a] group-hover:text-gray-200'}`}>
                                        <MdHomeFilled size={16} />
                                    </div>
                                    <span>Unfiled Notes</span>
                                    {currentFolderId === null && (
                                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#e85d56]" />
                                    )}
                                </button>
                            )}

                            {filteredTree.map(folder => {
                                const isCurrent = currentFolderId === folder._id;
                                return (
                                    <button
                                        key={folder._id}
                                        onClick={() => handleSelect(folder._id)}
                                        style={{ paddingLeft: `${folder.depth * 16 + 12}px` }}
                                        className={`w-full text-left py-2.5 pr-3 rounded-xl text-sm transition-all duration-200 flex items-center group cursor-pointer mt-0.5 ${
                                            isCurrent
                                                ? 'bg-[#4c2f2e]/60 text-[#e85d56] font-semibold'
                                                : 'text-gray-300 hover:bg-[#282a2d]'
                                        }`}
                                    >
                                        <div 
                                            className={`p-1.5 rounded-lg mr-3 transition-all ${isCurrent ? 'bg-[#e85d56]/20' : 'bg-[#2d2e30] border border-stone-800 shadow-sm group-hover:scale-110'}`}
                                        >
                                            <MdOutlineFolder 
                                                size={16}
                                                style={{ color: isCurrent ? '#e85d56' : (folder.color || '#a8a29e') }}
                                            />
                                        </div>
                                        <span className="truncate">{folder.name}</span>
                                        {isCurrent && (
                                            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#e85d56]" />
                                        )}
                                    </button>
                                );
                            })}

                            {filteredTree.length === 0 && searchVal && (
                                <div className="text-center py-8 text-sm text-gray-500 flex flex-col items-center">
                                    <MdOutlineFolder size={32} className="text-stone-700 mb-2" />
                                    No folders match "{searchVal}"
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default MoveToPicker;
