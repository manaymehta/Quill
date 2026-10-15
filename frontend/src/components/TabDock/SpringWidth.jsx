import { useContext, useLayoutEffect, useRef } from 'react';
import { motion, animate, PresenceContext, usePresence, useMotionValue } from 'framer-motion';
import { PILL_SPRING, PILL_FADE } from './dockMotion';

// Opens from width 0 to its content's natural width when entering, and closes back to 0 when
// leaving (AnimatePresence waits for it). Settled, it is plain `width: auto`.
//
// Driven by a fixed 0→1 progress spring, with width = progress × the content's *live* natural width,
// because the dock often resizes at the same moment (compacting as a note opens). Chasing the width
// instead fails: Framer's `width: 'auto'` measures its target once (stale → end snap), and
// re-targeting a spring every frame restarts it (a crawl). Once open it hands over to real `auto`,
// since tracking the content through a ResizeObserver lags a frame and clips it.
// animateEnter={false}: appear already open (no grow-in), but still close on exit.
const SpringWidth = ({ gap, animateEnter = true, className, style, transition, contentClassName, contentStyle, onSettled, children, ...rest }) => {
  const [isPresent, safeToRemove] = usePresence();
  const presenceSkipsEnter = useContext(PresenceContext)?.initial === false; // AnimatePresence initial={false}
  const skipEnter = !animateEnter || presenceSkipsEnter;
  const onSettledRef = useRef(onSettled);
  useLayoutEffect(() => {
    onSettledRef.current = onSettled;
  });

  const progress = useMotionValue(skipEnter ? 1 : 0);
  const width = useMotionValue(skipEnter ? 'auto' : 0);
  // The collapsing element cancels its flex gap with a negative LEFT margin: scrollable overflow counts
  // border boxes, so a negative right margin would still leave the gap in the strip's scrollWidth, and
  // removing the element would then clamp the scroll by that gap — a late jump.
  // Added on top of any fixed left margin passed in `style`.
  const baseMarginLeft = style?.marginLeft ?? 0;
  const marginLeft = useMotionValue(baseMarginLeft - (skipEnter ? 0 : gap));
  const settledRef = useRef(skipEnter);
  const naturalRef = useRef(0);
  const contentRef = useRef(null);

  // width/margin follow progress × live content width; once settled, hand sizing back to CSS.
  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    // Fractional width: offsetWidth rounds, and the switch to `auto` then jumped by the difference.
    const naturalWidth = () => (naturalRef.current = node.getBoundingClientRect().width);
    let natural = naturalWidth();
    const update = () => {
      if (settledRef.current) {
        width.set('auto');
        marginLeft.set(baseMarginLeft);
        return;
      }
      const p = progress.get();
      width.set(p * natural);
      marginLeft.set(baseMarginLeft + (p - 1) * gap);
    };
    const measure = () => {
      natural = naturalWidth();
      update();
    };
    update();
    const unsubscribe = progress.on('change', update);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [progress, width, marginLeft, baseMarginLeft, gap]);

  // Enter: spring progress to 1, then settle to auto. Exit: spring to 0, then let AnimatePresence
  // remove it. Both finish once under half a pixel of width remains, instead of creeping through
  // invisible fractions (on exit that creep kept shrinking the scroll width, and the browser clamped
  // the scroll a device pixel after everything had visibly stopped).
  useLayoutEffect(() => {
    const restDelta = 0.5 / Math.max(naturalRef.current, 1); // progress units: half a pixel of width
    const settle = { ...PILL_SPRING, restDelta, restSpeed: restDelta * 30 };
    if (isPresent) {
      if (settledRef.current) return;
      const controls = animate(progress, 1, {
        ...settle,
        onComplete: () => {
          settledRef.current = true;
          width.set('auto');
          marginLeft.set(baseMarginLeft);
          onSettledRef.current?.();
        },
      });
      return () => controls.stop();
    }
    if (settledRef.current) {
      settledRef.current = false;
      progress.set(1); // re-derive a numeric width from auto before closing
    }
    const controls = animate(progress, 0, { ...settle, onComplete: () => safeToRemove?.() });
    return () => controls.stop();
  }, [isPresent, progress, width, marginLeft, baseMarginLeft, safeToRemove]);

  return (
    <motion.div
      initial={skipEnter ? false : { opacity: 0 }}
      animate={{ opacity: isPresent ? 1 : 0 }}
      transition={{ opacity: PILL_FADE, ...transition }}
      style={{ ...style, width, marginLeft }}
      className={`overflow-hidden ${className}`}
      {...rest}
    >
      <div ref={contentRef} className={`w-max ${contentClassName}`} style={contentStyle}>
        {children}
      </div>
    </motion.div>
  );
};

export default SpringWidth;
