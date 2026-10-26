import React, { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore, hadSessionHint } from './store/useAuthStore';
import WakingScreen from './components/Layout/WakingScreen';
import { preconnectGoogleIdentity } from './utils/googleIdentity';

// Two halves, each its own download: the landing page (for visitors) and the logged-in app. The one
// this visit needs starts loading at once, alongside the session check; the other loads when the
// browser is idle. Graph (react-force-graph + d3) is split further; its Suspense boundary lives in MainLayout.
const importLanding = () => import('./pages/LandingPage/LandingPage');
const importLayout = () => import('./components/Layout/MainLayout');
const importHome = () => import('./pages/Home/Home');
const importAppPages = () => Promise.all([
  importLayout(), importHome(),
  import('./pages/FolderView/FolderView'), import('./pages/Archive/Archive'), import('./pages/Trash/Trash'),
]);

const LandingPage = lazy(importLanding);
const MainLayout = lazy(importLayout);
const Home = lazy(importHome);
const FolderView = lazy(() => import('./pages/FolderView/FolderView'));
const Archive = lazy(() => import('./pages/Archive/Archive'));
const Trash = lazy(() => import('./pages/Trash/Trash'));
const Graph = lazy(() => import('./pages/Graph/Graph'));

const PUBLIC_PATHS = ['/', '/login', '/signup'];
const WAKING_AFTER_MS = 2500;

const whenIdle = (run) => (window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 2000));

const App = () => {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const initializeAuth = useAuthStore((s) => s.initializeAuth);
  const [isSlow, setIsSlow] = useState(false);

  // Waiting to learn who's here matters only where it changes the page: the logged-in pages, and the
  // public ones in a browser that had a session (they're about to go to the dashboard). A visitor
  // sees the landing page at once.
  const waitForSession = hadSessionHint() || !PUBLIC_PATHS.includes(window.location.pathname);

  useEffect(() => {
    initializeAuth();
    // the half this visit needs, in parallel with the session check
    (waitForSession ? importAppPages : importLanding)().catch(() => {});
    // a visitor will see the login card: connect to Google now, so its button is ready sooner
    if (!waitForSession) preconnectGoogleIdentity();
  }, [initializeAuth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isInitialized) {
      // then the other half, so logging in or out doesn't wait on a download
      whenIdle(() => (isLoggedIn ? importLanding : importAppPages)().catch(() => {}));
      return undefined;
    }
    const timer = setTimeout(() => setIsSlow(true), WAKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isInitialized]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isInitialized && waitForSession) return isSlow ? <WakingScreen /> : null;

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>

          {/* Public Routes*/}
          {/* one page for all three: the landing page stays mounted, and /login and /signup open its card beside the quill */}
          <Route element={!isLoggedIn ? <LandingPage /> : <Navigate to="/dashboard" />}>
            <Route path="/" element={null} />
            <Route path="/login" element={null} />
            <Route path="/signup" element={null} />
          </Route>

          {/* Protected Routes*/}
          {/* guarded once here: logged out, the app shell (sidebar, dock, editor, modals) never mounts, so
              none of its queries fire */}
          <Route element={isLoggedIn ? <MainLayout /> : <Navigate to="/" />}>
            <Route path="/dashboard" element={<Home />} />
            <Route path="/folder/:folderId" element={<FolderView />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/trash" element={<Trash />} />
            <Route path="/graph" element={<Graph />} />
          </Route>

        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
