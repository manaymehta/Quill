import React from 'react';
import ProfileInfo from '../Cards/ProfileInfo';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../Cards/SearchBar';
import { FiMenu } from 'react-icons/fi';
import { IoClose } from 'react-icons/io5';
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';

const Navbar = ({ onSearch, handleClearSearch }) => {
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
    <div className="bg-[#202124] border-b-[#6d6c6c]  px-5 py-2 drop-shadow flex items-center justify-between z-50 relative">
      <div className="flex items-center gap-4 text-[#dd5e57]">
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

        <h2 className="text-3xl text-white font-bold cursor-pointer py-2">
          Quill
        </h2>
      </div>

      {isLoggedIn &&( <div className="flex-1 flex justify-center">
        <SearchBar onSearch={onSearch} handleClearSearch={handleClearSearch} />
      </div>)}

      {isLoggedIn && (
        <div className="flex items-center">
          <ProfileInfo onLogout={onLogout} />
        </div>
      )}
    </div>
  );
};

export default Navbar;