import React, { useState, useEffect } from 'react';
import { MdClose, MdWarning, MdDelete, MdOutlineFolder, MdOutlineStickyNote2 } from 'react-icons/md';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useNotesStore } from '../../store/useNotesStore';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useModalStore } from './useModalStore';

const FolderDeleteModal = () => {
    const { folderDeleteModal, closeFolderDeleteModal } = useModalStore();
    const { isOpen, folder, onConfirm } = folderDeleteModal;

    const { getSubtreeIds, getFolderPath, folders, deleteFolder } = useFoldersStore();
    const { allNotes } = useNotesStore();

    const [step, setStep] = useState(1);
    const [typedPath, setTypedPath] = useState('');
    const [stats, setStats] = useState({ notesCount: 0, foldersCount: 0 });
    const [fullPath, setFullPath] = useState('');

    useEffect(() => {
        if (folder) {
            setStep(1);
            setTypedPath('');

            // Calculate subtree stats
            const subtreeIds = getSubtreeIds(folder._id);
            const notesCount = allNotes.filter(n => subtreeIds.includes(n.folderId) && !n.isDeleted).length;
            const foldersCount = subtreeIds.length - 1; // exclude current folder
            setStats({ notesCount, foldersCount });

            // Calculate path
            const path = getFolderPath(folder._id);
            const pathStr = path.map(f => f.name).join('/');
            setFullPath(pathStr);
        }
    }, [folder, folders, allNotes, getSubtreeIds, getFolderPath]);

    const handleConfirm = async () => {
        if (stats.notesCount === 0 && stats.foldersCount === 0) {
            await deleteFolder(folder._id);
            if (onConfirm) onConfirm();
            closeFolderDeleteModal();
        } else if (step === 1) {
            setStep(2);
        } else if (step === 2 && typedPath === fullPath) {
            await deleteFolder(folder._id);
            if (onConfirm) onConfirm();
            closeFolderDeleteModal();
        }
    };

    const isConfirmDisabled = step === 2 && typedPath !== fullPath;

    if (!folder) return null;

    const isEmpty = stats.notesCount === 0 && stats.foldersCount === 0;

    if (typeof window === 'undefined' || !document.body) return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="folder-delete-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-6 bg-stone-900/40 backdrop-blur-[2px]"
                    onClick={closeFolderDeleteModal}
                >
                    <motion.div
                        initial={{ scale: 0.88 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0.88 }}
                        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                        className="w-full max-w-[300px] bg-[#202124] rounded-2xl shadow-2xl border border-[#3c4043] overflow-hidden flex flex-col p-4 text-white relative"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="mb-2 pr-6">
                            <h2 className="text-lg font-bold text-[#e85d56] tracking-tight">
                                {step === 1 ? `Delete "${folder.name}"?` : 'Confirm Deletion'}
                            </h2>
                        </div>
                        <button
                            onClick={closeFolderDeleteModal}
                            className="absolute top-5 right-5 p-1 rounded-full text-gray-400 hover:text-white hover:bg-[#2d2e30] transition-colors cursor-pointer"
                        >
                            <MdClose size={20} />
                        </button>

                        {step === 1 ? (
                            <div className="flex flex-col gap-3 mt-1">
                                {!isEmpty ? (
                                    <>
                                        <div className="">
                                            <p className="text-stone-300 text-sm px-0 leading-relaxed">
                                                This deletes the following as well:
                                            </p>
                                        </div>

                                        <div className="flex justify-center gap-3">
                                            {stats.foldersCount > 0 && (
                                                <div className="bg-[#2d2e30] border border-stone-700/50 rounded-xl px-4 py-2 flex flex-col items-center min-w-[80px]">
                                                    <div className="flex items-center gap-1.5 text-xl font-bold text-white mb-0.5">
                                                        <MdOutlineFolder className="text-[#a8a29e]" size={18} />
                                                        <span>{stats.foldersCount}</span>
                                                    </div>
                                                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Subfolders</span>
                                                </div>
                                            )}
                                            {stats.notesCount > 0 && (
                                                <div className="bg-[#2d2e30] border border-stone-700/50 rounded-xl px-4 py-2 flex flex-col items-center min-w-[80px]">
                                                    <div className="flex items-center gap-1.5 text-xl font-bold text-white mb-0.5">
                                                        <MdOutlineStickyNote2 className="text-[#e85d56]" size={18} />
                                                        <span>{stats.notesCount}</span>
                                                    </div>
                                                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Notes</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center mb-1">
                                        <p className="text-gray-300 text-sm">
                                            Are you sure you want to delete this folder?
                                        </p>
                                    </div>
                                )}

                                <div className="pt-2 flex w-full space-x-3">
                                    <button
                                        onClick={closeFolderDeleteModal}
                                        className="flex-1 py-2.5 bg-[#2d2e30] text-gray-300 text-sm font-medium rounded-xl hover:bg-[#3c4043] transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleConfirm}
                                        className="flex-1 py-2.5 bg-[#e85d56] text-white text-sm font-medium rounded-xl hover:bg-opacity-90 shadow-lg shadow-[#e85d56]/20 transition-colors"
                                    >
                                        Yes
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 text-center mt-1">
                                <p className="text-gray-300 text-sm px-4">
                                    To confirm deletion, please type the full folder path below:
                                </p>

                                <div className="bg-stone-900/60 p-2.5 rounded-xl text-center text-sm font-mono text-[#e85d56] select-all border border-stone-700 mx-2">
                                    {fullPath}
                                </div>

                                <input
                                    type="text"
                                    value={typedPath}
                                    onChange={(e) => setTypedPath(e.target.value)}
                                    placeholder={fullPath}
                                    className="bg-[#2d2e30] text-center text-white text-sm outline-none border border-stone-700 px-4 py-2.5 rounded-xl w-full focus:border-[#e85d56] focus:ring-1 focus:ring-[#e85d56] transition-all font-mono placeholder:text-stone-600"
                                    autoFocus
                                />

                                <div className="flex w-full space-x-3 pt-2">
                                    <button
                                        onClick={() => setStep(1)}
                                        className="flex-1 py-2.5 bg-[#2d2e30] text-gray-300 text-sm font-medium rounded-xl hover:bg-[#3c4043] transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        disabled={isConfirmDisabled}
                                        onClick={handleConfirm}
                                        className={`flex-1 py-2.5 text-white text-sm font-medium rounded-xl transition-colors ${isConfirmDisabled
                                            ? 'bg-stone-700 text-stone-500 cursor-not-allowed'
                                            : 'bg-[#e85d56] hover:bg-opacity-90 shadow-lg shadow-[#e85d56]/20'
                                            }`}
                                    >
                                        Yes
                                    </button>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
};

export default FolderDeleteModal;
