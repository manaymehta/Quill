import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import './LandingPage.css';
// the page in three parts: its markup (landing.html), its styles scoped to .lp-root (LandingPage.css) and its script (landing.js)
import markup from './landing.html?raw';
import { startLanding } from './landing.js';
import AuthCard from './AuthCard';
import quillLogo from '../../assets/quill/quill-logo.png';
import quillMark from '../../assets/quill/quill-animated.svg';

const html = markup.replaceAll('%LOGO%', quillLogo).replaceAll('%MARK%', quillMark);
const MODES = { '/login': 'login', '/signup': 'signup' };

// The two moves. They start straight from the click (or the Back button) where they can, rather than after the route
// change has re-rendered the page, so the quill never waits a beat and then lurches.
const clearTimers = (timers) => { timers.current.forEach(clearTimeout); timers.current = []; };
// The layout switches at once (the header goes, the hero takes the screen, on one column the quill changes size), and
// the quill is shown back where it was, then glides to its new place and size by transform alone (FLIP): resizing it
// frame by frame re-laid the page out and made it wobble. Its own end transform (the --qx shift on two columns) is kept
// at the end of the starting one, so the glide finishes exactly on it.
const flip = (root, change) => {
  const d = root.querySelector('.desk');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { change(); return; }
  const a = d.getBoundingClientRect();
  root.classList.add('flipping');
  d.style.transform = '';
  change();
  const b = d.getBoundingClientRect(), end = getComputedStyle(d).transform;
  d.style.transform = `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px,${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width})${end === 'none' ? '' : ' ' + end}`;
  d.getBoundingClientRect(); // the browser takes this as the starting point
  root.classList.remove('flipping');
  d.style.transform = '';
};
const enter = (root, timers) => {
  if (root.classList.contains('auth')) return;
  clearTimers(timers);
  flip(root, () => root.classList.add('auth', 'rest-out'));
  timers.current.push(setTimeout(() => root.classList.add('rest-gone'), 400));
  if (root.classList.contains('snaptext')) requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('snaptext')));
};
const leave = (root, timers) => {
  if (!root.classList.contains('auth')) return;
  clearTimers(timers);
  flip(root, () => root.classList.remove('auth', 'rest-gone'));
  timers.current.push(setTimeout(() => root.classList.remove('rest-out'), 500));
};

// One page for "/", "/login" and "/signup" (App.jsx routes all three here), so the quill and the sky stay on screen
// between them: opening the login or signup card slides the quill to the left and the card rises where it was.
const LandingPage = () => {
  const rootRef = useRef(null);
  const navigate = useNavigate();
  const mode = MODES[useLocation().pathname] || 'home';
  // the card keeps its last face while it's put away, so it doesn't change under the eye as it leaves
  const [cardMode, setCardMode] = useState(mode === 'home' ? 'login' : mode);
  if (mode !== 'home' && mode !== cardMode) setCardMode(mode);
  // each opening of the card is a new visit: it starts without the last visit's complaints
  const [visit, setVisit] = useState({ n: 0, open: mode !== 'home' });
  if ((mode !== 'home') !== visit.open) setVisit({ n: visit.n + (mode !== 'home' ? 1 : 0), open: mode !== 'home' });
  // React renders the card into this element, which is placed in the hero's slot once the markup is in
  const [slotEl] = useState(() => document.createElement('div'));
  const first = useRef(true);
  const timers = useRef([]);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  useLayoutEffect(() => {
    const root = rootRef.current;
    // a fresh copy of the markup on every mount, so the script always starts from the page's first state
    root.innerHTML = html;
    root.querySelector('#authSlot').appendChild(slotEl);
    document.documentElement.classList.add('lp-on');
    const stop = startLanding(root);
    // desktop: the quill and the card form one group, a set gap apart, centred on the screen; --qx and --cx are how far
    // each moves from its own place (offsets, which ignore the transforms the move itself adds). One column: neither moves sideways
    const hero = root.querySelector('.hero'), slot = root.querySelector('#authSlot'), desk = root.querySelector('.desk');
    const measure = () => {
      const two = getComputedStyle(hero).gridTemplateColumns.trim().split(/\s+/).length > 1;
      let qx = 0, cx = 0;
      if (two) {
        const wq = desk.offsetWidth, wc = slot.offsetWidth, pad = parseFloat(getComputedStyle(hero).paddingLeft);
        const gap = Math.max(24, Math.min(Math.min(Math.max(56, innerWidth * 0.07), 140), hero.clientWidth - 2 * pad - wq - wc));
        const left = hero.clientWidth / 2 - (wq + gap + wc) / 2;
        qx = left + wq / 2 - (desk.offsetLeft + wq / 2);
        cx = left + wq + gap + wc / 2 - (slot.offsetLeft + wc / 2);
      }
      root.style.setProperty('--qx', `${Math.round(qx)}px`);
      root.style.setProperty('--cx', `${Math.round(cx)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(hero);
    // Back and Forward: move at once, before the app catches up with the new address
    const onPop = () => (MODES[location.pathname] ? enter(root, timers) : leave(root, timers));
    addEventListener('popstate', onPop);
    return () => {
      ro.disconnect();
      removeEventListener('popstate', onPop);
      clearTimers(timers);
      stop();
      root.innerHTML = '';
      root.classList.remove('auth', 'rest-out', 'rest-gone', 'snap', 'snaptext', 'blink');
      first.current = true;
      document.documentElement.classList.remove('lp-on');
    };
  }, [slotEl]);

  // moving between the page and the card
  useLayoutEffect(() => {
    // (the tab stays "Quill" on every page: index.html's title)
    const root = rootRef.current, auth = mode !== 'home';
    // what can't be seen can't be reached: the words and the header's links while the card is up (the card itself is
    // inert while it's away, in AuthCard)
    root.querySelector('#htxt').inert = auth;
    root.querySelector('#hdr').inert = auth;
    // with the header gone, the quill is the way home: a link while the card is up, a picture otherwise
    const desk = root.querySelector('.desk');
    if (auth) { desk.removeAttribute('aria-hidden'); desk.setAttribute('role', 'link'); desk.tabIndex = 0; desk.setAttribute('aria-label', 'Back to the home page'); }
    else { desk.setAttribute('aria-hidden', 'true'); desk.removeAttribute('role'); desk.removeAttribute('tabindex'); desk.removeAttribute('aria-label'); }
    if (first.current) {
      // opened straight on /login or /signup: everything already in place, nothing glides
      first.current = false;
      if (auth) {
        root.classList.add('snap', 'auth', 'rest-out', 'rest-gone');
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('snap')));
      }
      return;
    }
    // usually already started by the click or by Back; this covers any other way the address changes
    if (auth) enter(root, timers); else leave(root, timers);
  }, [mode, slotEl]);

  const go = (href) => {
    const root = rootRef.current;
    if (MODES[href] && mode === 'home' && scrollY > 4) {
      // the card opens beside the hero's quill, so the page first goes back to the top:
      // a short way glides there; a long way blinks there, quicker than scrolling past every section
      if (scrollY < innerHeight * 1.2) {
        let done = false;
        const fire = () => { if (!done) { done = true; removeEventListener('scrollend', fire); enter(root, timers); navigate(href); } };
        addEventListener('scrollend', fire, { once: true });
        later(fire, 700);
        scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        root.classList.add('blink');
        later(() => {
          root.classList.add('snaptext'); // the words go at once (the page is blank for that instant); the quill still glides
          scrollTo(0, 0);
          root.classList.remove('blink');
          enter(root, timers);
          navigate(href);
        }, 200);
      }
      return;
    }
    if (href === '/' && mode === 'home') { scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (MODES[href] && mode === 'home') enter(root, timers);
    if (href === '/') leave(root, timers);
    navigate(href);
  };

  // the page's own links move within the app instead of reloading it; with the card up, the quill leads home
  const onClick = (e) => {
    if (mode !== 'home' && e.target.closest('.desk')) { go('/'); return; }
    const a = e.target.closest('a[href^="/"]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  };

  return (
    <div ref={rootRef} className="lp-root js" onClick={onClick} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && mode !== 'home' && e.target.closest('.desk')) { e.preventDefault(); go('/'); } }}>
      {createPortal(<AuthCard mode={cardMode} visit={visit.n} active={mode !== 'home'} onSwitch={(to) => navigate(to, { replace: true })} />, slotEl)}
    </div>
  );
};

export default LandingPage;
