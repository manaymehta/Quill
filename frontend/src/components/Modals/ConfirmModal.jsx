import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useModalStore } from './useModalStore';

const ConfirmModal = () => {
    const { confirmModal, closeConfirmModal } = useModalStore();
    const { isOpen, title, message, confirmLabel, variant, onConfirm } = confirmModal;

    if (typeof window === 'undefined' || !document.body) return null;

    const handleConfirmClick = () => {
        if (onConfirm) onConfirm();
        closeConfirmModal();
    };

    // Variant mapping for styling
    const confirmBtnStyles = variant === 'danger'
        ? 'bg-[#e85d56] text-white hover:bg-opacity-90 shadow-lg shadow-[#e85d56]/20'
        : 'bg-[#f4eadc] text-stone-900 hover:bg-opacity-90';

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="confirm-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-[2px]"
                    onClick={closeConfirmModal}
                >
                    <motion.div
                        initial={{ scale: 0.88 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0.88 }}
                        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                        className="w-full max-w-[320px] bg-[#202124] rounded-2xl shadow-2xl border border-[#3c4043] overflow-hidden flex flex-col p-5 text-white relative"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="mb-2">
                            <h2 className="text-lg font-bold text-stone-100 tracking-tight pr-6">
                                {title}
                            </h2>
                        </div>

                        <div className="flex flex-col gap-3 mt-1">
                            <p className="text-stone-300 text-sm leading-relaxed">
                                {message}
                            </p>

                            <div className="pt-2 flex w-full space-x-3">
                                <button
                                    onClick={closeConfirmModal}
                                    className="flex-1 py-2.5 bg-[#2d2e30] text-gray-300 text-sm font-medium rounded-xl hover:bg-[#3c4043] transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmClick}
                                    className={`flex-1 py-2.5 text-sm font-medium rounded-xl transition-colors ${confirmBtnStyles}`}
                                >
                                    {confirmLabel}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
};

export default ConfirmModal;
