import { useSyncExternalStore } from 'react';

// One MediaQueryList per query string, shared by every component using it: React calls the
// snapshot function on every render and store check, so creating a new one each time was waste.
const mediaQueryLists = new Map();
const getMediaQueryList = (query) => {
  let mql = mediaQueryLists.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    mediaQueryLists.set(query, mql);
  }
  return mql;
};

// Subscribes to a CSS media query; re-renders only when the match state flips,
// not on every resize event.
export const useMediaQuery = (query) =>
  useSyncExternalStore(
    (onChange) => {
      const mql = getMediaQueryList(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => getMediaQueryList(query).matches,
    () => false,
  );
