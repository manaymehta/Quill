import { Component } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LuCheck } from 'react-icons/lu';
import { FADE_IN, FADE_OUT, HEIGHT_SPRING, SWAP, TICK_SPRING } from './agentStyles';

// The agent's building blocks, in the app's own language: round checks, cream sheets with the
// editor's toolbar line.

// ── A round check ──
// A ring when off; on, a filled coral disc with a white check (a dash when only some of what it stands
// for is on) — the owner's call after ink discs read black and outline-only read colourless. Cream on
// the dark side panel. The mark pops in with a spring.
const TICK_TONES = {
  ink: { on: 'bg-[#e85d56] border-[#e85d56] text-white', off: 'border-stone-400/60' },
  cream: { on: 'bg-[#f4eadc] border-[#f4eadc] text-[#2a2a2a]', off: 'border-stone-500' },
};
export const TickIcon = ({ checked, partial = false, small = false, tone = 'ink' }) => {
  const isOn = checked || partial;
  return (
    <span
      className={`relative shrink-0 rounded-full border-[1.5px] flex items-center justify-center transition-colors duration-150 ${
        small ? 'w-4 h-4' : 'w-[18px] h-[18px]'
      } ${isOn ? TICK_TONES[tone].on : TICK_TONES[tone].off}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isOn && (
          <motion.span
            key={partial && !checked ? 'partial' : 'check'}
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, transition: { scale: TICK_SPRING, opacity: FADE_IN } }}
            exit={{ scale: 0.3, opacity: 0, transition: FADE_OUT }}
            className="flex"
          >
            {partial && !checked
              ? <span className="block w-2 h-[2px] rounded-full bg-current" />
              : <LuCheck className={small ? 'text-[10px]' : 'text-[11px]'} strokeWidth={3.5} />}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};

// ── A cream sheet: something the agent hands you (an edit, a review list…) ──
export const Sheet = ({ children, dashed = false, className = '' }) => (
  // overflow-clip, not hidden: clips to the corners the same, but isn't a scroll container — so a
  // sticky footer inside follows the chat's scroll
  <div className={`agent-cream rounded-[20px] bg-[#f4eadc] text-[#494949] border shadow-sm overflow-clip ${dashed ? 'border-dashed border-[#c9b593]' : 'border-[#e8dcc8]'} ${className}`}>
    {children}
  </div>
);

// Plain text: what the sheet is, then one quiet line (no icon tile — the words already say it)
export const SheetHeader = ({ title, subtitle }) => (
  <div className="px-4 pt-3.5 pb-2 min-w-0">
    <p className="text-sm font-semibold text-[#333] leading-snug">{title}</p>
    {subtitle && <p title={typeof subtitle === 'string' ? subtitle : undefined} className="text-xs text-stone-500 mt-0.5 leading-snug line-clamp-2">{subtitle}</p>}
  </div>
);

// The sheet's action bar: the editor toolbar's inset hairline, then the actions. A new `stateKey`
// (open → applying → applied…) crossfades the contents.
// sticky: on a long sheet the bar holds at the chat's bottom edge while the sheet runs past it, and
// settles at the sheet's end when that comes into view. Sticky offsets count from inside the chat's
// 16px bottom padding, so it's pulled 10px into that padding: it ends 6px from the edge (its own 8px
// bottom padding falls in the chat's 12px edge fade, its buttons stay crisp), with a strip of cream
// under it for the rest. At bottom-0 it floated 16px up over a band of cream.
export const SheetFooter = ({ stateKey, sticky = false, children }) => (
  <div className={sticky ? "sticky -bottom-2.5 z-[1] bg-[#f4eadc] after:content-[''] after:absolute after:inset-x-0 after:top-full after:h-1.5 after:bg-[#f4eadc]" : ''}>
    <div className="px-4"><div className="h-px w-full bg-black/5" /></div>
    <div className="px-2.5 py-2 min-h-[48px] flex items-center">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={stateKey} {...SWAP} className="flex flex-wrap items-center gap-1.5 w-full">
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  </div>
);

// Opens and closes its content with a height spring (no bounce)
export const Collapse = ({ isOpen, children }) => (
  <AnimatePresence initial={false}>
    {isOpen && (
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1, transition: { height: HEIGHT_SPRING, opacity: FADE_IN } }}
        exit={{ height: 0, opacity: 0, transition: { height: HEIGHT_SPRING, opacity: FADE_OUT } }}
        className="overflow-hidden"
      >
        {children}
      </motion.div>
    )}
  </AnimatePresence>
);

// Catches a render error below it and shows `fallback` instead, so one bad message (e.g. a list saved
// in a shape the screen doesn't expect) can't blank the whole app. The error still goes to the console.
export class RenderGuard extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[agent] render failed:', error, info?.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
