import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import {
  clearAccessToken,
  publishLogout,
  setAccessToken,
  subscribeToAuthEvents,
} from '../utils/authSession';

let initializationPromise = null;

// Not a secret, just a hint: did this browser have a session last time? With it, a page load waits to
// learn who's here (it's about to go to the dashboard); without it, the public pages show at once
// while the session is checked (App.jsx).
const SESSION_HINT_KEY = 'quill:hadSession';
export const hadSessionHint = () => {
  try { return localStorage.getItem(SESSION_HINT_KEY) === '1'; } catch { return false; }
};
const setSessionHint = (on) => {
  try {
    if (on) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch { /* storage blocked: every load then waits only on the protected pages */ }
};

// The first session check keeps asking while the backend can't answer (asleep, restarting, timing
// out) — only the server saying no means logged out — and gives up after this long
const INIT_GIVE_UP_MS = 90_000;
const INIT_RETRY_MS = [2000, 4000, 8000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// detail: { loggedIn, userId } on login, { loggedIn: false, reason: 'logout' | 'expired' } when the
// session ends (main.jsx decides what to clear from it)
const notifyAuthChanged = (detail) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:changed', { detail }));
  }
};

const applyAuthentication = (set, data) => {
  setAccessToken(data.accessToken);
  set({
    token: data.accessToken,
    user: data.user || null,
    isLoggedIn: true,
    isLoading: false,
    error: null,
  });
  setSessionHint(true);
  notifyAuthChanged({ loggedIn: true, userId: data.user?._id || null });
};

export const useAuthStore = create((set, get) => ({
  // Access tokens intentionally live only in the module/runtime memory.
  token: null,
  user: null,
  error: null,
  isLoading: false,
  isInitialized: false,
  isLoggedIn: false,

  initializeAuth: async () => {
    if (get().isInitialized) return;
    if (initializationPromise) return initializationPromise;

    // Remove tokens from the previous localStorage-based implementation.
    localStorage.removeItem('token');
    initializationPromise = (async () => {
      const giveUpAt = Date.now() + INIT_GIVE_UP_MS;
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await axiosInstance.post('/auth/refresh', undefined, { _skipAuthRefresh: true });
          if (response.data?.accessToken) {
            applyAuthentication(set, response.data);
            break;
          }
          // An answer without a token is an answer: logged out
          clearAccessToken();
          setSessionHint(false);
          set({ token: null, user: null, isLoggedIn: false });
          break;
        } catch (error) {
          const status = error?.response?.status;
          const answered = status >= 400 && status < 500;   // e.g. 401: no session, or it was revoked
          if (answered || Date.now() >= giveUpAt) {
            clearAccessToken();
            // Gave up without an answer: keep the hint, the session may still be good next time
            if (answered) setSessionHint(false);
            set({ token: null, user: null, isLoggedIn: false });
            break;
          }
          await sleep(INIT_RETRY_MS[Math.min(attempt, INIT_RETRY_MS.length - 1)]);
        }
      }
      set({ isInitialized: true });
      initializationPromise = null;
    })();

    return initializationPromise;
  },

  getUser: async () => {
    try {
      const response = await axiosInstance.get('/get-user');
      if (response.data?.user) set({ user: response.data.user });
    } catch (error) {
      console.error('Failed to fetch user', error);
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await axiosInstance.post('/login', { email, password });
      if (response.data?.error) {
        set({ error: response.data.message, isLoading: false, isLoggedIn: false });
        return;
      }
      if (!response.data?.accessToken) throw new Error('Invalid login response');
      applyAuthentication(set, response.data);
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Unexpected Error. Please try again';
      set({ error: errorMessage, isLoading: false, isLoggedIn: false });
    }
  },

  signup: async (name, email, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await axiosInstance.post('/create-account', { fullName: name, email, password });
      if (response.data?.error) {
        set({ error: response.data.message, isLoading: false, isLoggedIn: false });
        return;
      }
      if (!response.data?.accessToken) throw new Error('Invalid signup response');
      applyAuthentication(set, response.data);
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Unexpected Error. Please try again';
      set({ error: errorMessage, isLoading: false, isLoggedIn: false });
    }
  },

  googleLogin: async (response) => {
    set({ isLoading: true, error: null });
    try {
      const result = await axiosInstance.post('/auth/google', { token: response.credential });
      if (!result.data?.accessToken) throw new Error('Invalid Google login response');
      applyAuthentication(set, result.data);
    } catch (error) {
      console.error('Google login failed', error);
      set({ error: error.response?.data?.message || 'Google login failed', isLoading: false, isLoggedIn: false });
    }
  },

  // reason: 'logout' (the user chose to) or 'expired' (the session ran out; open tabs are kept)
  clearSession: (broadcast = true, reason = 'logout') => {
    clearAccessToken();
    set({ token: null, user: null, isLoggedIn: false, isLoading: false });
    setSessionHint(false);
    if (broadcast) publishLogout(reason);
    notifyAuthChanged({ loggedIn: false, reason });
  },

  logout: async () => {
    const logoutRequest = axiosInstance.post('/auth/logout', undefined, { _skipAuthRefresh: true });
    get().clearSession();
    try {
      await logoutRequest;
    } catch (error) {
      console.error('Logout request failed', error);
    }
  },
}));

if (typeof window !== 'undefined') {
  subscribeToAuthEvents((event) => {
    if (event.type === 'logout') {
      useAuthStore.getState().clearSession(false, event.reason || 'logout');
    }
  });

  window.addEventListener('auth:expired', () => {
    useAuthStore.getState().clearSession(true, 'expired');
  });
}
