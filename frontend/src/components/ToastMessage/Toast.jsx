import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LuCheck } from 'react-icons/lu';
import { MdDeleteOutline, MdWarningAmber, MdErrorOutline, MdClose } from 'react-icons/md';
import { useToastStore } from '../../store/useToastStore';

const Toast = () => {
  const toast = useToastStore((state) => state.toast);
  const hideToast = useToastStore((state) => state.hideToast);

  const [undoneToastId, setUndoneToastId] = useState(null);

  const isDelete = toast?.type === 'delete';
  const isError = toast?.type === 'error';
  const isWarning = toast?.type === 'warning';

  const isUndone = Boolean(toast?.id && undoneToastId === toast.id);

  const handleUndo = async () => {
    if (isUndone || !toast?.onUndo) return;
    const currentToastId = toast.id;
    if (currentToastId) {
      setUndoneToastId(currentToastId);
    }
    try {
      await Promise.resolve(toast.onUndo());
    } catch (err) {
      console.error("Toast undo error:", err);
    } finally {
      // Only hide if no new toast has been shown since we started the undo.
      // onUndo() may call showToast() to display an error; we must not erase it.
      const currentState = useToastStore.getState();
      if (!currentState.toast || currentState.toast.id === currentToastId) {
        hideToast();
      }
    }
  };

  return (
    <div className="fixed top-16 md:top-20 right-4 sm:right-6 z-[200] pointer-events-none">
      <AnimatePresence mode="wait">
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.94 }}
            transition={{ type: 'spring', damping: 26, stiffness: 420, mass: 0.4 }}
            className="pointer-events-auto flex items-center gap-3 py-2.5 px-4 bg-[#1e1e20]/95 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl text-white max-w-md select-none"
          >
            {/* Icon */}
            <div
              className={`w-8 h-8 flex items-center justify-center rounded-xl shrink-0 ${
                isDelete || isError
                  ? 'bg-red-500/15 text-red-400'
                  : isWarning
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {isDelete ? (
                <MdDeleteOutline className="text-lg" />
              ) : isError ? (
                <MdErrorOutline className="text-lg" />
              ) : isWarning ? (
                <MdWarningAmber className="text-lg" />
              ) : (
                <LuCheck className="text-lg" />
              )}
            </div>

            {/* Message */}
            <p className="text-sm font-medium text-stone-200 leading-snug break-words">
              {toast.message}
            </p>

            {/* Action Buttons: Undo & Dismiss */}
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {toast.onUndo && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="px-2 py-1 text-xs font-semibold text-[#e85d56] hover:text-[#ff7670] bg-[#e85d56]/10 hover:bg-[#e85d56]/20 rounded-lg transition-colors cursor-pointer"
                >
                  Undo
                </button>
              )}

              <button
                type="button"
                onClick={hideToast}
                className="p-1 rounded-lg text-stone-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Dismiss"
              >
                <MdClose size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Toast;
