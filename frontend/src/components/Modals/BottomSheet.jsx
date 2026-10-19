import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, animate, useDragControls, useMotionValue, useTransform } from 'framer-motion';
import { EASE_IN, EASE_OUT } from '../TabDock/dockMotion';

// A bottom sheet for phones, pulled down to close in the iOS way (the agent's History / Settings and
// the editor's side panel). It moves with the finger 1:1 going down (a little give going up), and only
// its top — the handle, plus whatever the content marks with `startDrag` (a title, tabs) — starts a
// drag, so lists inside scroll normally (dragging the whole sheet blocked their touch scrolling). The
// backdrop lightens as the sheet goes down. Let go past ~30% of its height or with a flick and it
// closes, carrying the flick's speed; otherwise it springs back. Positions are in pixels from one
// measured height, so open, drag and close all agree.
//
// Rendered at the page's top level, above the navbar and the dock: inside a layer of its own (the
// editor's, the agent panel's) it would sit under the dock. Render it inside an AnimatePresence, and
// give `children` a function: (startDrag) => content.

const OPEN = { type: 'spring', visualDuration: 0.28, bounce: 0.15 };
const BACK = { type: 'spring', visualDuration: 0.3, bounce: 0.2 };
const CLOSE = { type: 'spring', visualDuration: 0.24, bounce: 0 }; // continues at the sheet's own speed
const FADE_IN = { duration: 0.12, ease: EASE_OUT };
const FADE_OUT = { duration: 0.06, ease: EASE_IN };
const CLOSE_SHARE = 0.3;
const FLICK = 500; // px/s

const BottomSheet = ({ onClose, heightShare = 0.72, className = '', children }) => {
  const [height] = useState(() => Math.round(window.innerHeight * heightShare));
  const y = useMotionValue(height);
  const dragControls = useDragControls();
  const backdropOpacity = useTransform(y, (v) => 1 - Math.min(1, Math.max(0, v / height)));
  // A drag ending on the handle also fires a click: only a plain tap closes
  const [wasDragged, setWasDragged] = useState(false);
  const startDrag = (event) => {
    setWasDragged(false);
    dragControls.start(event);
  };

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: FADE_IN }}
        exit={{ opacity: 0, transition: FADE_OUT }}
        onClick={onClose}
        // Above the navbar (z-[100]); -inset-2 overhangs the screen so the blur's edge sampling falls
        // outside it (as the sidebar's backdrop does) — at the edge itself it left a smeared strip
        className="fixed -inset-2 z-[110]"
      >
        <motion.div style={{ opacity: backdropOpacity }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      </motion.div>
      <motion.div
        style={{ y, height, touchAction: 'auto' }}
        initial={{ y: height }}
        animate={{ y: 0, transition: OPEN }}
        exit={{ y: height, transition: CLOSE }}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0.08, bottom: 0 }}
        dragMomentum={false}
        onDragStart={() => setWasDragged(true)}
        onDragEnd={(event, info) => {
          if (info.offset.y > height * CLOSE_SHARE || info.velocity.y > FLICK) onClose();
          else animate(y, 0, BACK);
        }}
        // after: the sheet's fill carried on below its bottom edge, so pulling it up shows more sheet,
        // not a gap with the page under it
        className={`fixed inset-x-0 bottom-0 z-[111] bg-[#1e1e1e] rounded-t-[32px] border-t border-[#333] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col after:content-[''] after:absolute after:inset-x-0 after:top-full after:h-[40vh] after:bg-[#1e1e1e] ${className}`}
      >
        {/* The handle: drag from it, or tap it to close */}
        <div
          onPointerDown={startDrag}
          onClick={() => { if (!wasDragged) onClose(); }}
          className="shrink-0 pt-3 pb-1 touch-none cursor-grab active:cursor-grabbing"
          aria-label="Close"
          role="button"
        >
          <div className="w-12 h-1.5 bg-[#444] rounded-full mx-auto" />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children(startDrag)}</div>
      </motion.div>
    </>,
    document.body,
  );
};

export default BottomSheet;
