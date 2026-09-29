import { useSyncExternalStore } from 'react';

// Subscribes to a CSS media query; re-renders only when the match state flips,
// not on every resize event.
export const useMediaQuery = (query) =>
  useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
