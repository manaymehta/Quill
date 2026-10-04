import { useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';

// A note title on one line that fades out at its end when it's too long, instead of ending in "…"
// (the dock's pills and the long-press list). The fade is the .tab-pill-label mask (index.css),
// switched on by data-overflow only while the text actually overflows, so a title that fits keeps
// its last letters solid. Overflow can change without a React render (a pill's width cap animates
// as the dock resizes; a title is edited), hence the ResizeObserver plus a check after every render.
// `style` may hold motion values (e.g. an animated maxWidth).
const FadeTitle = ({ style, className = '', children }) => {
  const ref = useRef(null);
  const checkOverflow = () => {
    const el = ref.current;
    if (el) el.toggleAttribute('data-overflow', el.scrollWidth > el.clientWidth);
  };
  useLayoutEffect(checkOverflow);
  useEffect(() => {
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.span ref={ref} style={style} className={`tab-pill-label overflow-hidden whitespace-nowrap ${className}`}>
      {children}
    </motion.span>
  );
};

export default FadeTitle;
