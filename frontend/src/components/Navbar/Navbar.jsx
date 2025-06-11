import React, { useState } from 'react'
import ProfileInfo from '../Cards/ProfileInfo';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../Cards/SearchBar';

const Navbar = ({userInfo, isVisible = true, onSearch, handleClearSearch}) => {

  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const handleSearch = () => {
    if(searchQuery){
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
    <div className='bg-white px-6 py-2 drop-shadow flex items-center justify-between '>
      <h2 className='text-xl text-black font-medium py-2'>Notes</h2>

      {isVisible && <SearchBar 
        value = {searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
        }}
        onClearSearch={onClearSearch}
        handleSearch={handleSearch}
      />}

      {isVisible && <ProfileInfo userInfo={userInfo} onLogout={onLogout}/>}
    </div>
  )
};

export default Navbar
