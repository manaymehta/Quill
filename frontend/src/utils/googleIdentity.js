// Google's sign-in script, loaded only when the login card is on the page (it used to load on every
// page for everyone). One load per page; resolves with window.google, or rejects when the script
// can't load (offline, or blocked, as privacy extensions often do). After a failure the next call
// tries again.
const GSI_ORIGIN = 'https://accounts.google.com';
const GSI_SRC = `${GSI_ORIGIN}/gsi/client`;
let loading = null;
let preconnected = false;

// Opens the connection to Google early (DNS, TCP, TLS), so the script and then the button's frame
// don't each wait for it. For visitors only, at app start, while the landing page is still downloading.
export const preconnectGoogleIdentity = () => {
  if (preconnected) return;
  preconnected = true;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = GSI_ORIGIN;
  document.head.appendChild(link);
};

export const loadGoogleIdentity = () => {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google sign-in did not start')));
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error('Google sign-in could not load'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
};
