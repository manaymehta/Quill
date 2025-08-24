import React from 'react';
import { FaMagnifyingGlass } from 'react-icons/fa6';
import { IoMdClose } from 'react-icons/io';
import { useSearchStore } from '../../store/useSearchStore';

const SearchBar = () => {
  const { searchQuery, setSearchQuery, clearSearch, handleSearch } = useSearchStore();

  return (
    <div className="flex w-70 items-center px-4 bg-slate-100 rounded-full">
      <input
        type="text"
        value={searchQuery}
        className="w-full bg-transparent py-[11px] outline-none"
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search Notes"
      />
      {searchQuery && (
        <IoMdClose
          className="text-slate-400 hover:text-black mr-2 text-xl"
          onClick={clearSearch}
        />
      )}
      <FaMagnifyingGlass
        className="cursor-pointer text-slate-400 hover:text-black"
        onClick={handleSearch}
      />
    </div>
  );
};

export default SearchBar;