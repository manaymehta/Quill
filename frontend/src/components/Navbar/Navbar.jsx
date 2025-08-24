import React from 'react';
import ProfileInfo from '../Cards/ProfileInfo';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../Cards/SearchBar';
import { FiMenu } from 'react-icons/fi';
import { IoClose } from 'react-icons/io5';
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';

const Navbar = () => {
  const navigate = useNavigate();
  const { user, logout, isLoggedIn } = useAuthStore();
  const { isNavbarVisible, isSidebarOpen, toggleSidebar } = useUIStore();

  const onLogout = () => {
    logout();
    navigate('/');
  };

  if (!isNavbarVisible) {
    return null;
  }

  return (
    <div className="bg-white px-5 py-2 drop-shadow flex items-center justify-between z-50 relative">
      <div className="flex items-center gap-4">
        {isLoggedIn &&
          (isSidebarOpen ? (
            <IoClose
              className="text-2xl cursor-pointer"
              onClick={toggleSidebar}
            />
          ) : (
            <FiMenu
              className="text-2xl cursor-pointer"
              onClick={toggleSidebar}
            />
          ))}

        <h2 className="text-xl text-black font-bold cursor-pointer py-2.5">
          Quill
        </h2>
      </div>

      {isLoggedIn &&( <div className="flex-1 flex justify-center">
        <SearchBar />
      </div>)}

      {isLoggedIn && (
        <div className="flex items-center">
          <ProfileInfo userInfo={user} onLogout={onLogout} />
        </div>
      )}
    </div>
  );
};

export default Navbar;