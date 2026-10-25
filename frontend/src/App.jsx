import React, { useEffect, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home/Home';
import MainLayout from './components/Layout/MainLayout';
import Archive from './pages/Archive/Archive';
import Trash from './pages/Trash/Trash';
import { useAuthStore } from './store/useAuthStore';
import LandingPage from './pages/LandingPage/LandingPage';
import FolderView from './pages/FolderView/FolderView';

// Heavy route (react-force-graph + d3) split into its own chunk; Suspense boundary lives in MainLayout
const Graph = lazy(() => import('./pages/Graph/Graph'));

const App = () => {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const initializeAuth = useAuthStore((s) => s.initializeAuth);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  if (!isInitialized) return null;

  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
};

export default App;
