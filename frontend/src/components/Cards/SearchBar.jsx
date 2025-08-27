import React, { useEffect } from 'react';
import { FaMagnifyingGlass } from 'react-icons/fa6';
import { IoMdClose } from 'react-icons/io';
import { useSearchStore } from '../../store/useSearchStore';

const SearchBar = ({ onSearch, handleClearSearch }) => {
  const { searchQuery, setSearchQuery } = useSearchStore();

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (searchQuery) {
        onSearch(searchQuery);
      } else {
        handleClearSearch();
      }
    }, 300);

    return () => {
      clearTimeout(debounce);
    };
  }, [searchQuery, onSearch, handleClearSearch]);

  return (
    <div className="flex w-full sm:w-120 items-center px-4 bg-[#9c9892] mx-2 border-slate-500 rounded-full">
      <input
        type="text"
        value={searchQuery}
        className="w-full bg-transparent py-[11px] outline-none text-white"
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search Notes"
      />
      {searchQuery && (
        <IoMdClose
          className="text-slate-400 hover:text-black mr-2 text-xl"
          onClick={() => setSearchQuery('')}
        />
      )}
      <FaMagnifyingGlass
        className="cursor-pointer text-[#ccc6bc] hover:text-black"
      />
    </div>
  );
};

export default SearchBar;