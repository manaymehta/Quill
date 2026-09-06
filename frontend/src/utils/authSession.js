let accessToken = null;
let lastRefreshFailedAt = 0;
const REFRESH_FAILURE_COOLDOWN_MS = 5000;
const REFRESH_LOCK_NAME = 'quill-auth-refresh';
const AUTH_CHANNEL_NAME = 'quill-auth-session';
const tabId = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;
const authChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel(AUTH_CHANNEL_NAME)
  : null;
const authEventListeners = new Set();

export const markRefreshFailed = () => {
  lastRefreshFailedAt = Date.now();
};

export const hasRecentRefreshFailure = () => {
  return Date.now() - lastRefreshFailedAt < REFRESH_FAILURE_COOLDOWN_MS;
};

export const clearRefreshFailure = () => {
  lastRefreshFailedAt = 0;
};

if (authChannel) {
  authChannel.addEventListener('message', ({ data }) => {
    if (!data || data.senderId === tabId) return;

    if (data.type === 'access-token' && data.token) {
      accessToken = data.token;
      clearRefreshFailure();
    }

    if (data.type === 'refresh-failed') {
      markRefreshFailed();
    }

    authEventListeners.forEach((listener) => listener(data));
  });
}

export const getAccessToken = () => accessToken;

export const setAccessToken = (token) => {
  accessToken = token || null;
  if (accessToken) {
    clearRefreshFailure();
  }
};

export const clearAccessToken = () => {
  accessToken = null;
};

export const publishAccessToken = (token) => {
  setAccessToken(token);
  authChannel?.postMessage({ type: 'access-token', token, senderId: tabId });
};

export const publishRefreshFailure = (error) => {
  markRefreshFailed();
  authChannel?.postMessage({
    type: 'refresh-failed',
    senderId: tabId,
    message: error?.message || 'Session refresh failed',
  });
};

export const publishLogout = () => {
  clearRefreshFailure();
  authChannel?.postMessage({ type: 'logout', senderId: tabId });
};

export const subscribeToAuthEvents = (listener) => {
  authEventListeners.add(listener);
  return () => authEventListeners.delete(listener);
};

export const getRefreshLockName = () => REFRESH_LOCK_NAME;

export const hasCrossTabCoordination = () => Boolean(authChannel)
  && typeof navigator !== 'undefined'
  && Boolean(navigator.locks?.request);
