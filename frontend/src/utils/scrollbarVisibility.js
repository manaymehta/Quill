// Every visible scrollbar in the app shows only while its own area is being scrolled, fading in and
// out (like macOS and phones; on Windows they were otherwise on screen whenever something could
// scroll). One listener for the whole page: scroll events don't bubble, but they do pass the
// document on the way down. What fades is --scroll-thumb-alpha on the scrolling element, which only
// the scrollbar colours read (index.css); animating it through the Web Animations API leaves the
// element's own transitions and animations alone. Areas whose scrollbar is hidden stay hidden.
const FADE_IN = { duration: 120, easing: 'ease-out', fill: 'forwards' };
const FADE_OUT = { duration: 450, easing: 'ease-out', fill: 'forwards' };
const HIDE_AFTER_MS = 800;

const states = new WeakMap();

const fadeTo = (el, state, target, timing) => {
  const from = parseFloat(getComputedStyle(el).getPropertyValue('--scroll-thumb-alpha')) || 0;
  state.animation?.cancel();
  state.animation = el.animate({ '--scroll-thumb-alpha': [from, target] }, timing);
};

// The page's own scrollbar belongs to the window; its styling may come from <html> or from <body>
// (body's overflow is what the window uses here), so both carry the fade
const onScroll = (e) => {
  if (e.target === document) {
    showWhileScrolling(document.documentElement);
    showWhileScrolling(document.body);
  } else if (e.target instanceof Element) {
    showWhileScrolling(e.target);
  }
};

const showWhileScrolling = (el) => {
  let state = states.get(el);
  if (!state) {
    state = { shown: false, timer: null, animation: null };
    states.set(el, state);
  }
  if (!state.shown) {
    state.shown = true;
    fadeTo(el, state, 1, FADE_IN);
  }
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.shown = false;
    fadeTo(el, state, 0, FADE_OUT);
  }, HIDE_AFTER_MS);
};

export const installScrollbarVisibility = () => {
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
};
