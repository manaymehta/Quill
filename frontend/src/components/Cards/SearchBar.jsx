import React, { useEffect, useRef } from 'react';
import { FaMagnifyingGlass } from 'react-icons/fa6';
import { IoMdClose } from 'react-icons/io';
import { RiSparkling2Fill } from 'react-icons/ri';
import { useSearchStore } from '../../store/useSearchStore';

const SearchBar = ({ onSearch, handleClearSearch, onAiSearch }) => {
  const {
    searchQuery, setSearchQuery,
    searchMode, setSearchMode,
    isSearchingAI,
  } = useSearchStore();

  const debounceRef = useRef(null);

  useEffect(() => {
    if (searchMode !== 'keyword') return;

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchQuery) {
        onSearch(searchQuery);
      } else {
        handleClearSearch();
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, searchMode, onSearch, handleClearSearch]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && searchMode === 'semantic' && searchQuery.trim()) {
      onAiSearch(searchQuery.trim());
    }
  };

  const handleClear = () => {
    setSearchQuery('');
    if (searchMode === 'keyword') handleClearSearch();
  };

  const toggleMode = () => {
    const next = searchMode === 'keyword' ? 'semantic' : 'keyword';
    setSearchMode(next);
    setSearchQuery('');
    handleClearSearch();
  };

  const isAI = searchMode === 'semantic';

  return (
    <div className="flex items-center gap-2 w-full sm:w-auto mx-2 rounded-full">
      <button
        onClick={toggleMode}
        title={isAI ? 'Switch to keyword search' : 'Switch to AI search'}
        className={`flex items-center gap-1 px-3 py-3 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer
          ${isAI
            ? 'bg-[#dd5e57] text-white '
            : 'bg-[#27272a] text-slate-400 hover:text-white '
          }`}
      >
        <RiSparkling2Fill className={`text-sm ${isAI ? 'text-white' : 'text-[#dd5e57]'}`} />

      </button>


      <div className="flex w-full sm:w-80 items-center px-4 bg-[#27272a]  rounded-full">
        <input
          type="text"
          value={searchQuery}
          className="w-full bg-transparent py-[10px] outline-none text-white "
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isAI ? 'AI Search' : 'Search notes…'}
        />
        {isSearchingAI && (
          <span className="text-[#dd5e57] text-xs mr-2 animate-pulse">thinking…</span>
        )}
        {searchQuery && !isSearchingAI && (
          <IoMdClose
            className="text-slate-400 hover:text-white mr-2 text-xl cursor-pointer"
            onClick={handleClear}
          />
        )}
        <FaMagnifyingGlass
          className={`cursor-pointer ${isAI ? 'text-[#dd5e57]' : 'text-[#ccc6bc]'} hover:text-white transition-colors`}
          onClick={() => {
            if (isAI && searchQuery.trim()) onAiSearch(searchQuery.trim());
          }}
        />
      </div>
    </div>
  );
};

export default SearchBar;