import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home/Home';
import SignUp from './pages/SignUp/SignUp';
import Login from './pages/Login/Login';
import MainLayout from './components/Layout/MainLayout';
import Pinned from './pages/Pinned/Pinned';
import Trash from './pages/Trash/Trash';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>

        {/* Public Routes*/}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />

        {/* Protected Routes*/}
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={<Home />} />
          <Route path="/pinned" element={<Pinned />} />
          <Route path="/trash" element={<Trash />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
};

export default App;
