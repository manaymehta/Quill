// Shown while the first session check is still waiting on the backend (Render's free plan sleeps
// when idle and takes up to a minute to wake). Only after a short pause, so a normal load never
// flashes it. The tab icon (the quill mark on its tile) stands in as the logo.
const WakingScreen = () => (
  <div
    role="status"
    className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
    style={{ animation: 'waking-in .4s ease-out both' }}
  >
    <img src="/apple-touch-icon.png" alt="" width="56" height="56" className="rounded-[13px]" />
    <p className="text-[15px] font-medium text-stone-200">Waking up Quill…</p>
    <p className="max-w-[18rem] text-xs leading-relaxed text-stone-500">
      The server sleeps when nobody's using it. This can take up to a minute.
    </p>
  </div>
);

export default WakingScreen;
