import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';

export const useAuthStore = create((set) => ({
  token: localStorage.getItem('token') || null,
  user: null,
  error: null,
  isLoading: false,
  isLoggedIn: !!localStorage.getItem('token'),

  login: async (email, password, navigate) => {
    set({ isLoading: true, error: null });
    try {
      const response = await axiosInstance.post('/login', { email, password });
      if (response.data && response.data.accessToken) {
        localStorage.setItem('token', response.data.accessToken);
        set({ token: response.data.accessToken, user: response.data.user, isLoading: false, isLoggedIn: true });
        navigate('/dashboard');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Unexpected Error. Please try again';
      set({ error: errorMessage, isLoading: false, isLoggedIn: false });
    }
  },

  signup: async (name, email, password, navigate) => {
    set({ isLoading: true, error: null });
    try {
      const response = await axiosInstance.post('/create-account', { fullName: name, email, password });
      if (response.data && response.data.accessToken) {
        localStorage.setItem('token', response.data.accessToken);
        set({ token: response.data.accessToken, user: response.data.user, isLoading: false, isLoggedIn: true });
        navigate('/dashboard');
      } else if (response.data && response.data.error) {
        set({ error: response.data.message, isLoading: false, isLoggedIn: false });
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Unexpected Error. Please try again';
      set({ error: errorMessage, isLoading: false, isLoggedIn: false });
    }
  },

  googleLogin: async (response, navigate) => {
    set({ isLoading: true, error: null });
    try {
      const res = await axiosInstance.post('/auth/google', { token: response.credential });
      if (res.data && res.data.accessToken) {
        localStorage.setItem('token', res.data.accessToken);
        set({ token: res.data.accessToken, user: res.data.user, isLoading: false, isLoggedIn: true });
        navigate('/dashboard');
      }
    } catch (err) {
      console.error('Google login failed', err);
      set({ error: 'Google login failed', isLoading: false, isLoggedIn: false });
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null, isLoggedIn: false });
  },
}));