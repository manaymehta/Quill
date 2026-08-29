let accessToken = null;
const REFRESH_LOCK_NAME = 'quill-auth-refresh';
const AUTH_CHANNEL_NAME = 'quill-auth-session';
const tabId = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;
const authChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel(AUTH_CHANNEL_NAME)
  : null;
const accessTokenWaiters = new Set();
const authEventListeners = new Set();

if (authChannel) {
  authChannel.addEventListener('message', ({ data }) => {
    if (!data || data.senderId === tabId) return;

    if (data.type === 'access-token' && data.token) {
      setAccessToken(data.token);
      accessTokenWaiters.forEach(({ resolve }) => resolve(data.token));
      accessTokenWaiters.clear();
    }

    if (data.type === 'refresh-failed') {
      accessTokenWaiters.forEach(({ reject }) => reject(new Error('Session refresh failed')));
      accessTokenWaiters.clear();
    }

    authEventListeners.forEach((listener) => listener(data));
  });
}

export const getAccessToken = () => accessToken;

export const setAccessToken = (token) => {
  accessToken = token || null;
};

export const clearAccessToken = () => {
  accessToken = null;
};

export const publishAccessToken = (token) => {
  authChannel?.postMessage({ type: 'access-token', token, senderId: tabId });
};

export const publishRefreshFailure = () => {
  authChannel?.postMessage({ type: 'refresh-failed', senderId: tabId });
};

export const publishLogout = () => {
  authChannel?.postMessage({ type: 'logout', senderId: tabId });
};

export const waitForCrossTabAccessToken = (timeoutMs = 35000) => new Promise((resolve, reject) => {
  const waiter = {
    resolve: (token) => {
      clearTimeout(timeoutId);
      resolve(token);
    },
    reject: (error) => {
      clearTimeout(timeoutId);
      reject(error);
    },
  };
  const timeoutId = setTimeout(() => {
    accessTokenWaiters.delete(waiter);
    waiter.reject(new Error('Timed out waiting for another tab to refresh the session'));
  }, timeoutMs);

  accessTokenWaiters.add(waiter);
});

export const subscribeToAuthEvents = (listener) => {
  authEventListeners.add(listener);
  return () => authEventListeners.delete(listener);
};

export const getRefreshLockName = () => REFRESH_LOCK_NAME;

export const hasCrossTabCoordination = () => Boolean(authChannel)
  && typeof navigator !== 'undefined'
  && Boolean(navigator.locks?.request);
