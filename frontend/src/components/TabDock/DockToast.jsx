import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdDeleteOutline, MdErrorOutline, MdOutlineArchive } from 'react-icons/md';
import { LuCheck, LuLoaderCircle, LuSparkles, LuUndo2 } from 'react-icons/lu';
import { motion, frame, AnimatePresence, useIsPresent, useMotionValue, useSpring } from 'framer-motion';
import { useToastStore } from '../../store/useToastStore';
import { EASE_IN, EASE_OUT, PILL_FADE, useCenteredDockPx, useDockPx } from './dockMotion';
import { useOutsidePress } from './useOutsidePress';

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
  if (type === 'agent')   return <LuSparkles className={`${iconClass} text-[#f4eadc]`} />;
  if (type === 'agent-working') return <LuLoaderCircle className={`${iconClass} text-[#f4eadc] animate-spin`} />;
  return <LuCheck className={`${iconClass} text-stone-300`} />;
};

// Capsule appear: pops up out of the dock with a visible overshoot (bounce 0.4: 0.28 read as no
// bounce), opacity in a blink so the pop is carried by scale, not a fade.
const TOAST_SHELL_HIDDEN = { opacity: 0, scale: 0.5, y: 10 };
const TOAST_SHELL_SHOWN = {
  opacity: 1, scale: 1, y: 0,
  transition: {
    default: { type: 'spring', visualDuration: 0.22, bounce: 0.4 },
    opacity: { duration: 0.08, ease: EASE_OUT },
  },
};

// Leaving: fast, shrinking a little from wherever the card stands in the stack
const TOAST_EXIT_S = 0.1;
const TOAST_EXIT_SCALE = 0.6;
const TOAST_EXIT_DROP_PX = 8;

// An update in place (same toast, new text): the text swaps near-instantly at its natural size (a quick
// crossfade, so no blink) and the capsule springs to the new width, its edges revealing or closing in
// on the text — one capsule resizing rather than a new toast replacing it.
const TOAST_WIDTH_SPRING = { type: 'spring', visualDuration: 0.16, bounce: 0.3 };
const TOAST_CONTENT_HIDDEN = { opacity: 0 };
const TOAST_CONTENT_SHOWN = { opacity: 1, transition: { duration: 0.08, ease: EASE_OUT } };
const TOAST_CONTENT_EXIT = { opacity: 0, transition: { duration: 0.06, ease: EASE_IN } };

// The stack. Closed (the pile): the newest in front, up to PEEK_LEVELS older ones peeking out above
// it, each level smaller and higher; older ones wait hidden behind the last level. Open (the list):
// every card at full size in a column above the front one. Cards only move and scale (transforms),
// with a bounce — their widths never animate here, so nothing twitches sideways.
const PEEK_LEVELS = 2;
const PEEK_Y_PX = 10;     // each level's rise above the one in front
const PEEK_SCALE = 0.06;  // each level's shrink
const PEEK_TINT = 0.07;   // each level's lightening, so a card's edge stands apart from the one in front
const STACK_SPRING = { type: 'spring', visualDuration: 0.18, bounce: 0.38 };
// In the pile the cards behind take the front card's width, so the pile reads as one shape; at the
// front or in the list each has its own. No bounce: a centred width overshooting twitches sideways.
const PILE_WIDTH_SPRING = { type: 'spring', visualDuration: 0.16, bounce: 0 };

// One message inside a capsule, centred at its natural size. Reports that size so the capsule can
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

// Where a card stands: `depth` 0 is the front card
const cardPlace = (depth, isList, rowPitch) => {
  if (isList) return { y: -depth * rowPitch, scale: 1, opacity: 1 };
  const level = Math.min(depth, PEEK_LEVELS);
  return { y: -level * PEEK_Y_PX, scale: 1 - level * PEEK_SCALE, opacity: depth > PEEK_LEVELS ? 0 : 1 };
};

// One toast: a glass capsule sized with the dock (height, radius and paddings follow its compaction
// `progress`). Pops in once; an update in place (updateToast) morphs it to the new text.
const ToastCard = ({ toast, depth, isList, isStacked, rowPitch, frontWidth, progress, height, radius, paddingL, paddingR, paddingRUndo, undoSize }) => {
  const dismissToast = useToastStore((s) => s.dismissToast);
  const setListOpen  = useToastStore((s) => s.setListOpen);
  const [isUndone, setIsUndone] = useState(false);

  // Undo only from the round button; the card goes once it has run
  const handleUndo = async () => {
    if (isUndone || !toast.onUndo) return;
    setIsUndone(true);
    try {
      await Promise.resolve(toast.onUndo());
    } catch (err) {
      console.error('Toast undo error:', err);
    } finally {
      dismissToast(toast.id);
    }
  };

  // The body: in the closed pile it opens the list; alone or as a list row it hides the toast (or
  // runs its own tap action)
  const handleTap = () => {
    if (isStacked && !isList) {
      setListOpen(true);
      return;
    }
    if (toast.onTap) {
      setListOpen(false);
      toast.onTap();
      return;
    }
    dismissToast(toast.id);
  };

  // Capsule width: springs to the current message's measured width. The first message jumps straight
  // to its width (the capsule's pop-in is the entrance animation).
  const widthTarget = useMotionValue(0);
  const width       = useSpring(widthTarget, TOAST_WIDTH_SPRING);

  // Called by the present ToastContent whenever its natural size changes. Springs only for a NEW
  // message (the morph). The same message resizing is followed instantly: re-aiming the spring every
  // frame restarts it, so the capsule lagged behind its own content.
  // (offsetWidth, not getBoundingClientRect: the toast scales while popping in, which would skew it.)
  const lastNodeRef = useRef(null);
  const lastWidthRef = useRef(0);
  const handleContentResize = useCallback((node) => {
    const capsule = node.parentElement.parentElement; // content → its fade layer → the capsule
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

  // The width shown: its own, blended toward the front card's while it sits behind it in the pile
  const isPresent = useIsPresent();
  const takesFrontWidth = !isList && depth > 0;
  const pileBlendTarget = useMotionValue(takesFrontWidth ? 1 : 0);
  const pileBlend = useSpring(pileBlendTarget, PILE_WIDTH_SPRING);
  useLayoutEffect(() => {
    pileBlendTarget.set(takesFrontWidth ? 1 : 0);
  }, [takesFrontWidth, pileBlendTarget]);
  const shownWidthOf = useCallback((own) => own + (frontWidth.get() - own) * pileBlend.get(), [frontWidth, pileBlend]);
  const shownWidth = useMotionValue(0);
  // Kept in step by hand, not with useTransform: that subscribes only after the content's first
  // measurement (a child's layout effect runs first), so a new card stayed 0 wide — a bare line.
  // This layout effect runs after the child's, so its first update picks up the measured width.
  useLayoutEffect(() => {
    const update = () => shownWidth.set(shownWidthOf(width.get()));
    update();
    const unsubscribers = [width, frontWidth, pileBlend].map((v) => v.on('change', update));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [shownWidth, shownWidthOf, width, frontWidth, pileBlend]);

  // The front card publishes its width for the ones behind (a leaving card no longer does)
  const isFront = depth === 0 && isPresent;
  useEffect(() => {
    if (!isFront) return;
    frontWidth.set(width.get());
    return width.on('change', (v) => frontWidth.set(v));
  }, [isFront, width, frontWidth]);

  // While the dock compacts, the paddings and undo button change every frame, and the ResizeObserver
  // above reports a frame late (content at its new width, the capsule still at the old one: clipped
  // edges). So re-measure in Framer's postRender step, right after this frame's styles are applied,
  // and write the capsule width directly. Skipped during a morph (the spring owns the width then).
  useEffect(() => {
    const syncWidth = () => {
      const node = lastNodeRef.current;
      if (!node?.isConnected || width.isAnimating()) return;
      const capsule = node.parentElement.parentElement;
      const nextWidth = node.offsetWidth + (capsule.offsetWidth - capsule.clientWidth);
      if (nextWidth === lastWidthRef.current) return;
      lastWidthRef.current = nextWidth;
      widthTarget.jump(nextWidth);
      width.jump(nextWidth);
      capsule.style.width = `${shownWidthOf(nextWidth)}px`;
    };
    return progress.on('change', () => frame.postRender(syncWidth));
  }, [progress, width, widthTarget, shownWidthOf]);

  const place = cardPlace(depth, isList, rowPitch);
  // Cards behind the front one in the pile show only their edge: their text would smudge through
  // the front card's glass
  const showsContent = isList || depth === 0;
  const tint = isList ? 0 : Math.min(depth, PEEK_LEVELS) * PEEK_TINT;

  return (
    <motion.div
      className="absolute bottom-0 inset-x-0 flex justify-center pointer-events-none"
      style={{ zIndex: 10 - depth, originY: 1 }}
      initial={false}
      animate={place}
      exit={{
        opacity: 0, scale: place.scale * TOAST_EXIT_SCALE, y: place.y + TOAST_EXIT_DROP_PX,
        transition: { duration: TOAST_EXIT_S, ease: EASE_IN },
      }}
      transition={{ default: STACK_SPRING, opacity: PILL_FADE }}
    >
      <motion.div
        initial={TOAST_SHELL_HIDDEN}
        animate={TOAST_SHELL_SHOWN}
        className={`${depth > PEEK_LEVELS && !isList ? 'pointer-events-none' : 'pointer-events-auto'} flex justify-center`}
        style={{ originY: 1 /* grows up out of the dock */ }}
      >
        <motion.div
          style={{ width: shownWidth, height, borderRadius: radius }}
          onClick={handleTap}
          className="group/toast dock-glass relative overflow-hidden select-none cursor-pointer border border-white/5 shadow-2xl text-stone-300"
        >
          {/* The closed note pill's look: the dock's glass under a faint white wash, stronger on hover */}
          <div className="absolute inset-0 bg-white/5 group-hover/toast:bg-white/10 transition-colors duration-200 pointer-events-none" />
          <motion.div
            initial={false}
            animate={{ opacity: tint }}
            transition={PILL_FADE}
            className="absolute inset-0 bg-white pointer-events-none"
          />
          <motion.div initial={false} animate={{ opacity: showsContent ? 1 : 0 }} transition={PILL_FADE}>
            <AnimatePresence initial={false}>
              <ToastContent
                key={toast.rev}
                onResize={handleContentResize}
                initial={TOAST_CONTENT_HIDDEN}
                animate={TOAST_CONTENT_SHOWN}
                exit={TOAST_CONTENT_EXIT}
                style={{ paddingLeft: paddingL, paddingRight: toast.onUndo ? paddingRUndo : paddingR }}
                className="absolute left-1/2 inset-y-0 w-max max-w-[min(90vw,400px)] flex items-center justify-between whitespace-nowrap"
              >
                <div className="flex items-center gap-2 min-w-0 pr-1">
                  {renderToastIcon(toast.type)}
                  <span className="truncate font-semibold tracking-wide text-stone-300 text-xs sm:text-sm">
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
      </motion.div>
    </motion.div>
  );
};

// The toast stack above the dock. Takes no height of its own: the cards stand on its bottom edge and
// rise from there, so nothing below moves when they come and go.
const DockToast = ({ progress, metrics, isCompact, height, radius }) => {
  const toasts      = useToastStore((s) => s.toasts);
  const isListOpen  = useToastStore((s) => s.isListOpen);
  const setListOpen = useToastStore((s) => s.setListOpen);

  const gap          = useDockPx(progress, metrics.toastGap);
  const paddingL     = useDockPx(progress, metrics.toastPaddingLeft);
  const paddingR     = useDockPx(progress, metrics.toastPaddingRight);
  const paddingRUndo = useDockPx(progress, metrics.toastPaddingRightUndo);
  const undoSize     = useCenteredDockPx(progress, metrics.height, metrics.undo);
  const frontWidth   = useMotionValue(0); // the front card's capsule width, set by that card

  // The list's row pitch: a card's height plus the same gap as between the front card and the dock
  const at = isCompact ? 1 : 0;
  const rowPitch = metrics.height[at] + metrics.toastGap[at];

  // Open list: a tap outside only closes it (never presses what's under it), as with the long-press
  // notes list; Escape too.
  const stackRef = useRef(null);
  useOutsidePress(isListOpen, {
    isInside: (target) => stackRef.current?.contains(target),
    onPress: () => setListOpen(false),
  });
  useEffect(() => {
    if (!isListOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setListOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isListOpen, setListOpen]);

  return (
    <motion.div ref={stackRef} className="relative w-full h-0 shrink-0" style={{ marginBottom: gap }}>
      <AnimatePresence>
        {toasts.map((toast, i) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            depth={toasts.length - 1 - i}
            isList={isListOpen}
            isStacked={toasts.length > 1}
            rowPitch={rowPitch}
            frontWidth={frontWidth}
            progress={progress}
            height={height}
            radius={radius}
            paddingL={paddingL}
            paddingR={paddingR}
            paddingRUndo={paddingRUndo}
            undoSize={undoSize}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
};

export default DockToast;
