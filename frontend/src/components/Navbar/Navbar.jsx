import React, { useState } from 'react'
import ProfileInfo from '../Cards/ProfileInfo';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../Cards/SearchBar';
import { FiMenu } from 'react-icons/fi';
import { IoClose } from 'react-icons/io5';

const Navbar = ({ userInfo, isVisible = true, onSearch, handleClearSearch, onToggleSidebar, isSidebarOpen }) => {

  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const handleSearch = () => {
    if (searchQuery) {
      onSearch(searchQuery);
    }
  };

  const onClearSearch = () => {
    setSearchQuery("");
    handleClearSearch();
  }

  const onLogout = () => {
    navigate("/login");
  };

  return (
    <div className='bg-white px-5 py-2 drop-shadow flex items-center justify-between z-50 relative'>

      <div className="flex items-center gap-4">
        {isVisible && (
          isSidebarOpen ? (
            <IoClose className="text-2xl cursor-pointer" onClick={onToggleSidebar} />
          ) : (
            <FiMenu className="text-2xl cursor-pointer" onClick={onToggleSidebar} />
          )
        )}

        <h2 className='text-xl text-black font-medium py-2.5'>Notes</h2>
      </div>

      {isVisible && (
        <div className="flex-1 flex justify-center">
          <SearchBar
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClearSearch={onClearSearch}
            handleSearch={handleSearch}
          />
        </div>
      )}

      {isVisible && (
        <div className="flex items-center">
          <ProfileInfo userInfo={userInfo} onLogout={onLogout} />
        </div>
      )}
    </div>
  )
};

export default Navbar
