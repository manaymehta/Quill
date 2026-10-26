import React, { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { validateEmail } from '../../utils/helper';
import { loadGoogleIdentity } from '../../utils/googleIdentity';
import { FaRegEye, FaRegEyeSlash } from 'react-icons/fa6';

// Google's sign-in is set up once per page load; the button itself is drawn again for each card
let googleReady = false;

// The login and signup card on the landing page's desk: one card for both, the name line folding open for signing up.
// `active` is false while the card is put away (on the landing page itself), so nothing in it can be reached.
const AuthCard = ({ mode, visit, active, onSwitch }) => {
  const up = mode === 'signup';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  // a field's own complaint, kept with the card and visit it was made in, so switching cards or coming back starts clean
  const at = `${mode}:${visit}`;
  const [bad, setBad] = useState({ at, f: {} });
  const fe = bad.at === at ? bad.f : {};
  const error = useAuthStore((s) => s.error);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);
  const nameRef = useRef(null), emailRef = useRef(null), passwordRef = useRef(null);
  const gRef = useRef(null);

  // an error from the other card, or from an earlier visit, never shows on this one
  useEffect(() => { useAuthStore.setState({ error: null }); }, [mode, visit]);

  // with a mouse, the first empty line is ready to type in once the card has landed (a phone would pop its keyboard, so not there)
  const first = useRef(true);
  useEffect(() => {
    if (!active || !matchMedia('(pointer: fine)').matches) return;
    const t = setTimeout(() => (up ? nameRef : emailRef).current?.focus({ preventScroll: true }), first.current ? 1150 : 60); // after the glide: focusing mid-move made the page stall
    first.current = false;
    return () => clearTimeout(t);
  }, [active, up]);

  // the Google button, drawn once to the card's width. Google draws a placeholder first and its iframe under it, then
  // drops the placeholder a frame or two later; the box's fixed height (LandingPage.css) keeps that from jolting the card,
  // and drawing once ("Continue with Google" fits both cards) keeps switching cards from redrawing it
  const drawn = useRef(false), firstRun = useRef(true);
  // Google's script couldn't load (offline or blocked): the "or" line and the button's placeholder go, rather than a
  // button-shaped shape that does nothing
  const [googleFailed, setGoogleFailed] = useState(false);
  useEffect(() => {
    // when: at once if the page opened on the card (nothing is moving); otherwise early, while the card is still put
    // away, so it's ready before the card opens; and if the card opens first, just after its glide, as building it
    // mid-move stalled the page. The script itself starts loading now, whatever the delay.
    const delay = firstRun.current && active ? 0 : active ? 1150 : 1200;
    firstRun.current = false;
    if (drawn.current) return;
    const google = loadGoogleIdentity();
    google.catch(() => {});
    let t, later, mo, cancelled = false;
    const draw = (loaded) => {
      const g = loaded.accounts.id, box = gRef.current;
      if (cancelled || !box) return;
      if (!googleReady) {
        g.initialize({ client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID, callback: (r) => useAuthStore.getState().googleLogin(r) });
        googleReady = true;
      }
      drawn.current = true;
      g.renderButton(box, { theme: 'filled_black', size: 'large', shape: 'pill', width: Math.round(Math.min(400, Math.max(200, box.clientWidth))), text: 'continue_with', logo_alignment: 'center' });
      // Google's button arrives in steps (a placeholder, then its frame, then, when someone is signed in to Google, the
      // frame swaps to "Continue as …" at another width), each step shifting it; it stays hidden until its frame has
      // loaded and settled, then fades in once
      const show = () => { clearTimeout(t); t = setTimeout(() => box.classList.add('ready'), 300); };
      const frame = box.querySelector('iframe');
      if (frame) frame.addEventListener('load', show, { once: true });
      else {
        mo = new MutationObserver(() => { const f = box.querySelector('iframe'); if (f) { mo.disconnect(); f.addEventListener('load', show, { once: true }); } });
        mo.observe(box, { childList: true, subtree: true });
      }
      later = setTimeout(() => box.classList.add('ready'), 3000);
    };
    t = setTimeout(() => google.then(draw, () => { if (!cancelled) setGoogleFailed(true); }), delay);
    return () => { cancelled = true; clearTimeout(t); clearTimeout(later); mo?.disconnect(); };
  }, [active]);

  const submit = async (e) => {
    e.preventDefault();
    const f = {};
    if (up && !name.trim()) f.name = 'What should we call you?';
    if (!validateEmail(email.trim())) f.email = email.trim() ? "That doesn't look like an email address." : 'Your email, please.';
    if (!password) f.password = 'Your password, please.';
    setBad({ at, f });
    const firstBad = ['name', 'email', 'password'].find((k) => f[k]);
    if (firstBad) { ({ name: nameRef, email: emailRef, password: passwordRef })[firstBad].current?.focus(); return; }
    if (up) await signup(name.trim(), email.trim(), password);
    else await login(email.trim(), password);
  };

  // typing in a line clears its complaint
  const edit = (k, set) => (e) => { set(e.target.value); if (fe[k]) setBad({ at, f: { ...fe, [k]: undefined } }); };

  const firstName = name.trim().split(/\s+/)[0].slice(0, 18);
  const title = up ? (firstName ? `${firstName}’s notes.` : 'Start your notes.') : 'Welcome back.';

  const field = (k, label, input) => (
    <div className={`fld${fe[k] ? ' bad' : ''}`}>
      <label htmlFor={`auth-${k}`}>{label}</label>
      <div className="line">{input}</div>
      {fe[k] && <p className="ferr" id={`${k}-err`}>{fe[k]}</p>}
    </div>
  );

  return (
    <div className={`acard${up ? ' up' : ''}`} inert={!active}>
      <h2 key={mode} className="swap">{title}</h2>
      <form onSubmit={submit} noValidate>
        <div className="namerow" inert={!up || undefined}>
          <div>
            {field('name', 'Name', <input ref={nameRef} id="auth-name" type="text" autoComplete="name" placeholder="What should we call you?" value={name} onChange={edit('name', setName)} aria-invalid={!!fe.name} aria-describedby={fe.name ? 'name-err' : undefined} />)}
          </div>
        </div>
        {field('email', 'Email', <input ref={emailRef} id="auth-email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={edit('email', setEmail)} aria-invalid={!!fe.email} aria-describedby={fe.email ? 'email-err' : undefined} />)}
        {field('password', 'Password', <>
          <input ref={passwordRef} id="auth-password" type={show ? 'text' : 'password'} autoComplete={up ? 'new-password' : 'current-password'} placeholder={up ? 'Pick a password' : 'Your password'} value={password} onChange={edit('password', setPassword)} aria-invalid={!!fe.password} aria-describedby={fe.password ? 'password-err' : undefined} />
          <button type="button" className="eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
            {show ? <FaRegEye size={18} aria-hidden="true" /> : <FaRegEyeSlash size={18} aria-hidden="true" />}
          </button>
        </>)}
        {error && <p className="aerr" role="alert">{error}</p>}
        <button type="submit" className="asub" disabled={isLoading}>
          {isLoading ? (up ? 'Making your notes…' : 'Opening your notes…') : (up ? 'Create account' : 'Log in')}
        </button>
      </form>
      <p className="aswitch">
        {up ? 'Already writing here? ' : 'New to Quill? '}
        <button type="button" onClick={() => onSwitch(up ? '/login' : '/signup')}>{up ? 'Log in' : 'Create an account'}</button>
      </p>
      {!googleFailed && <>
        <div className="aor" role="separator"><span>or</span></div>
        <div className="agoogle" ref={gRef} />
      </>}
    </div>
  );
};

export default AuthCard;
