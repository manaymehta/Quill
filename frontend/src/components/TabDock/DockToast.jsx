import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdDeleteOutline, MdErrorOutline, MdOutlineArchive } from 'react-icons/md';
import { LuCheck, LuUndo2 } from 'react-icons/lu';
import { motion, frame, AnimatePresence, useIsPresent, useMotionValue, useSpring } from 'framer-motion';
import { useToastStore } from '../../store/useToastStore';
import { EASE_IN, EASE_OUT, useCenteredDockPx, useDockPx } from './dockMotion';

const getToastDisplayText = (toast) => {
  if (!toast) return '';
  if (toast.type === 'warning' || toast.type === 'error') {
    return toast.message || toast.label || 'Warning';
  }
  return toast.label || toast.message || 'Saved';
};

const renderToastIcon = (type) => {
  const iconClass = 'text-sm shrink-0';
  if (type === 'warning') return <MdErrorOutline className={`${iconClass} text-amber-400`} />;
  if (type === 'error')   return <MdErrorOutline className={`${iconClass} text-red-400`} />;
  if (type === 'archive') return <MdOutlineArchive className={`${iconClass} text-stone-300`} />;
  if (type === 'delete')  return <MdDeleteOutline className={`${iconClass} text-red-400`} />;
  return <LuCheck className={`${iconClass} text-stone-300`} />;
};

// Capsule appear/dismiss: pops up out of the dock with a visible overshoot (bounce 0.4: 0.28 read as
// no bounce), opacity in a blink so the pop is carried by scale, not a fade. Leaves fast.
const TOAST_SHELL_HIDDEN = { opacity: 0, scale: 0.5, y: 10 };
const TOAST_SHELL_SHOWN = {
  opacity: 1, scale: 1, y: 0,
  transition: {
    default: { type: 'spring', visualDuration: 0.22, bounce: 0.4 },
    opacity: { duration: 0.08, ease: EASE_OUT },
  },
};
const TOAST_SHELL_EXIT = {
  opacity: 0, scale: 0.6, y: 8,
  transition: { duration: 0.1, ease: EASE_IN },
};

// Message swap: the text swaps near-instantly at its natural size (a quick crossfade, so no blink)
// and the capsule springs to the new width, its edges revealing or closing in on the text — one
// capsule resizing rather than a new toast replacing it.
const TOAST_WIDTH_SPRING = { type: 'spring', visualDuration: 0.16, bounce: 0.3 };
const TOAST_CONTENT_HIDDEN = { opacity: 0 };
const TOAST_CONTENT_SHOWN = { opacity: 1, transition: { duration: 0.08, ease: EASE_OUT } };
const TOAST_CONTENT_EXIT = { opacity: 0, transition: { duration: 0.06, ease: EASE_IN } };

// One message inside the capsule, centred at its natural size. Reports that size so the capsule can
// fit it: synchronously on mount (so the capsule starts moving this frame), then on later changes.
const ToastContent = ({ onResize, style, ...props }) => {
  // An exiting message stays mounted during the crossfade; only the present one sizes the capsule.
  const isPresent = useIsPresent();
  const isPresentRef = useRef(isPresent);
  useLayoutEffect(() => {
    isPresentRef.current = isPresent;
  }, [isPresent]);

  const nodeRef = useRef(null);
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const measure = () => {
      if (isPresentRef.current) onResize(node);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onResize]);

  return <motion.div ref={nodeRef} style={{ ...style, x: '-50%' }} {...props} />;
};

// Toast — one persistent "dynamic island" capsule above the dock, sized with it (height, radius and
// paddings follow the dock's compaction `progress`). It pops in once; while visible, a new message
// morphs it (width springs to the new content, old/new content crossfade in place) instead of
// stacking a second bubble. Keyed by a stable key so it isn't remounted per message.
const DockToast = ({ progress, metrics, height, radius }) => {
  const toast     = useToastStore((s) => s.toast);
  const hideToast = useToastStore((s) => s.hideToast);
  const [undoneToastId, setUndoneToastId] = useState(null);
  const isUndone = Boolean(toast?.id && undoneToastId === toast.id);

  const handleUndo = async () => {
    if (isUndone || !toast?.onUndo) return;
    const currentToastId = toast.id;
    if (currentToastId) setUndoneToastId(currentToastId);
    try {
      await Promise.resolve(toast.onUndo());
    } catch (err) {
      console.error('Toast undo error:', err);
    } finally {
      const s = useToastStore.getState();
      if (!s.toast || s.toast.id === currentToastId) hideToast();
    }
  };

  const gap          = useDockPx(progress, metrics.toastGap);
  const paddingL     = useDockPx(progress, metrics.toastPaddingLeft);
  const paddingR     = useDockPx(progress, metrics.toastPaddingRight);
  const paddingRUndo = useDockPx(progress, metrics.toastPaddingRightUndo);
  const undoSize     = useCenteredDockPx(progress, metrics.height, metrics.undo);

  // Capsule width: springs to the current message's measured width. The first message of a fresh
  // capsule jumps straight to its width (the capsule's pop-in is the entrance animation).
  const widthTarget = useMotionValue(0);
  const width       = useSpring(widthTarget, TOAST_WIDTH_SPRING);

  // Called by the present ToastContent whenever its natural size changes. Springs only for a NEW
  // message (the morph). The same message resizing is followed instantly: re-aiming the spring every
  // frame restarts it, so the capsule lagged behind its own content.
  // (offsetWidth, not getBoundingClientRect: the toast scales while popping in, which would skew it.)
  const lastNodeRef = useRef(null);
  const lastWidthRef = useRef(0);
  const handleContentResize = useCallback((node) => {
    const capsule = node.parentElement;
    const nextWidth = node.offsetWidth + (capsule.offsetWidth - capsule.clientWidth); // + capsule borders
    const isNewMessage = node !== lastNodeRef.current;
    // A ResizeObserver also fires once right after observing, repeating the mount measurement;
    // treating that as a resize would cut the morph short.
    if (!isNewMessage && nextWidth === lastWidthRef.current) return;
    lastNodeRef.current = node;
    lastWidthRef.current = nextWidth;
    if (width.get() === 0 || !isNewMessage) {
      widthTarget.jump(nextWidth);
      width.jump(nextWidth);
    } else {
      widthTarget.set(nextWidth);
    }
  }, [width, widthTarget]);

  // While the dock compacts, the paddings and undo button change every frame, and the ResizeObserver
  // above reports a frame late (content at its new width, the capsule still at the old one: clipped
  // edges). So re-measure in Framer's postRender step, right after this frame's styles are applied,
  // and write the capsule width directly. Skipped during a morph (the spring owns the width then).
  useEffect(() => {
    const syncWidth = () => {
      const node = lastNodeRef.current;
      if (!node?.isConnected || width.isAnimating()) return;
      const capsule = node.parentElement;
      const nextWidth = node.offsetWidth + (capsule.offsetWidth - capsule.clientWidth);
      if (nextWidth === lastWidthRef.current) return;
      lastWidthRef.current = nextWidth;
      widthTarget.jump(nextWidth);
      width.jump(nextWidth);
      capsule.style.width = `${nextWidth}px`;
    };
    return progress.on('change', () => frame.postRender(syncWidth));
  }, [progress, width, widthTarget]);

  const resetWidth = useCallback(() => {
    widthTarget.jump(0);
    width.jump(0);
  }, [width, widthTarget]);

  return (
    <AnimatePresence onExitComplete={resetWidth}>
      {toast && (
        <motion.div
          key="dock-toast"
          initial={TOAST_SHELL_HIDDEN}
          animate={TOAST_SHELL_SHOWN}
          exit={TOAST_SHELL_EXIT}
          className="pointer-events-auto shrink-0 flex justify-center"
          style={{ marginBottom: gap, originY: 1 /* grows up out of the dock */ }}
        >
          <motion.div
            style={{ width, height, borderRadius: radius }}
            onClick={toast.onUndo ? handleUndo : hideToast}
            className="dock-glass relative overflow-hidden select-none cursor-pointer border border-white/10 shadow-2xl text-stone-100 hover:bg-[#333336]"
          >
            <AnimatePresence initial={false}>
              <ToastContent
                key={toast.id}
                onResize={handleContentResize}
                initial={TOAST_CONTENT_HIDDEN}
                animate={TOAST_CONTENT_SHOWN}
                exit={TOAST_CONTENT_EXIT}
                style={{ paddingLeft: paddingL, paddingRight: toast.onUndo ? paddingRUndo : paddingR }}
                className="absolute left-1/2 inset-y-0 w-max max-w-[min(90vw,400px)] flex items-center justify-between whitespace-nowrap"
              >
                <div className="flex items-center gap-2 min-w-0 pr-1">
                  {renderToastIcon(toast.type)}
                  <span className="truncate font-semibold tracking-wide text-stone-100 text-xs sm:text-sm">
                    {getToastDisplayText(toast)}
                  </span>
                </div>
                {toast.onUndo && (
                  <motion.button
                    style={{ width: undoSize, height: undoSize }}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleUndo(); }}
                    title="Undo"
                    className="shrink-0 rounded-full bg-white/20 hover:bg-white/30 active:scale-90 flex items-center justify-center text-white border border-white/25 shadow-sm cursor-pointer ml-2"
                  >
                    <LuUndo2 className="text-xs" />
                  </motion.button>
                )}
              </ToastContent>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DockToast;
