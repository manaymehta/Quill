import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home/Home';
import SignUp from './pages/SignUp/SignUp';
import Login from './pages/Login/Login';
import MainLayout from './components/Layout/MainLayout';
import Pinned from './pages/Pinned/Pinned';
import Trash from './pages/Trash/Trash';
import { useAuthStore } from './store/useAuthStore';

const App = () => {
  const{ isLoggedIn } = useAuthStore();
  return (
    <BrowserRouter>
      <Routes>

        {/* Public Routes*/}
        <Route path="/" element={!isLoggedIn ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/signup" element={!isLoggedIn ? <SignUp /> : <Navigate to="/dashboard" />} />

        {/* Protected Routes*/}
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={isLoggedIn ? <Home /> : <Navigate to="/" />} />
          <Route path="/pinned" element={isLoggedIn ? <Pinned /> : <Navigate to="/" />} />
          <Route path="/trash" element={isLoggedIn ? <Trash /> : <Navigate to="/" />} />z
        </Route>

      </Routes>
    </BrowserRouter>
  );
};

export default App;
