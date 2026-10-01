// Motion shared by the dock, its toast, and the long-press list.
import { useTransform } from 'framer-motion';

// Tween easings: EASE_OUT for things arriving, EASE_IN for things leaving. Opacity always uses these,
// never a spring (a spring's long settling tail reads as a lazy fade).
export const EASE_OUT = [0.16, 1, 0.3, 1];
export const EASE_IN  = [0.4, 0, 1, 1];

// Widths/heights opening and closing (pills, close slots, list rows). No bounce: a bouncy width
// overshoots, and since the dock is centred its contents move out and back — a horizontal twitch.
export const PILL_SPRING = { type: 'spring', visualDuration: 0.22, bounce: 0 };
export const PILL_FADE   = { duration: 0.12, ease: EASE_OUT };

// A dock dimension interpolated along the compaction progress ([home, editor] px), rounded to whole
// pixels: sub-pixel sizes make glyphs and icons re-snap to the pixel grid each frame, a visible jitter.
export const useDockPx = (progress, [from, to]) =>
  useTransform(progress, (v) => Math.round(from + (to - from) * v));

// The same for an item vertically centred in the dock. Rounding item and dock height independently
// leaves it ½px off-centre on some frames; deriving it from the rounded height minus twice a rounded
// inset keeps it centred, and still lands on the exact sizes at both ends.
export const useCenteredDockPx = (progress, [heightFrom, heightTo], [from, to]) =>
  useTransform(progress, (v) => {
    const height = heightFrom + (heightTo - heightFrom) * v;
    const item = from + (to - from) * v;
    return Math.round(height) - 2 * Math.round((height - item) / 2);
  });
