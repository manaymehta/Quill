import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import {
  clearAccessToken,
  publishLogout,
  setAccessToken,
  subscribeToAuthEvents,
} from '../utils/authSession';

let initializationPromise = null;

const notifyAuthChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth:changed'));
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
  notifyAuthChanged();
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
      try {
        const response = await axiosInstance.post('/auth/refresh', undefined, { _skipAuthRefresh: true });
        if (!response.data?.accessToken) throw new Error('Invalid refresh response');
        applyAuthentication(set, response.data);
      } catch {
        clearAccessToken();
        set({ token: null, user: null, isLoggedIn: false });
      } finally {
        set({ isInitialized: true });
        initializationPromise = null;
      }
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

  clearSession: (broadcast = true) => {
    clearAccessToken();
    set({ token: null, user: null, isLoggedIn: false, isLoading: false });
    if (broadcast) publishLogout();
    notifyAuthChanged();
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
      useAuthStore.getState().clearSession(false);
    }
  });

  window.addEventListener('auth:expired', () => {
    useAuthStore.getState().clearSession();
  });
}
