import React, { useState } from 'react'
import ProfileInfo from '../Cards/ProfileInfo';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../Cards/SearchBar';

const Navbar = () => {

  const navigate = useNavigate;

  const [searchQuery, setSearchQuery] = useState("");
  const handleSearch = () => {

  }
  const onClearSearch = () => {
    setSearchQuery("");
  }

  const onLogout = () => {
    navigate("/login");
  };

  return (
    <div className='bg-white px-6 py-2 drop-shadow flex items-center justify-between '>
      <h2 className='text-xl text-black font-medium py-2'>Notes</h2>
      <SearchBar 
        value = {searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
        }}
        onClearSearch={onClearSearch}
        handleSearch={handleSearch}
      />
      <ProfileInfo onLogout={onLogout}/>
    </div>
  );
};

export default Navbar
