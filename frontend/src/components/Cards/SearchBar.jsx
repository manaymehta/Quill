import React from 'react';
import { FaMagnifyingGlass } from 'react-icons/fa6';
import { IoMdClose } from 'react-icons/io';
import { RiSparkling2Fill } from 'react-icons/ri';
import { useSearchStore } from '../../store/useSearchStore';
import { useAgentStore } from '../../store/useAgentStore';

const SearchBar = () => {
  const {
    searchQuery, setSearchQuery,
    searchMode, setSearchMode,
    clearSearch,
  } = useSearchStore();

  const isAgent = searchMode === 'agent';

  // Agent input lives in the chat panel; the navbar field acts as a launcher
  // so the conversation panel appears open with context.
  const sendToAgent = () => {
    if (!searchQuery.trim()) return;
    useAgentStore.getState().sendMessage(searchQuery.trim());
    setSearchQuery('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && isAgent) sendToAgent();
  };

  const toggleMode = () => {
    setSearchMode(isAgent ? 'keyword' : 'agent');
  };

  return (
    <div className="flex items-center gap-2 w-full sm:w-auto mx-2 rounded-full">
      <button
        onClick={toggleMode}
        title={isAgent ? 'Notes agent — click for keyword search' : 'Keyword search — click for the notes agent'}
        className={`flex items-center gap-1 px-3 py-3 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer
          ${isAgent
            ? 'bg-[#635c51] text-white '
            : 'bg-[#27272a] text-slate-400 hover:text-white '
          }`}
      >
        <RiSparkling2Fill className={`text-sm ${isAgent ? 'text-white' : 'text-[#dd5e57]'}`} />
        {isAgent && <span>Agent</span>}
      </button>


      <div className="flex w-full sm:w-80 items-center px-4 bg-[#27272a]  rounded-full">
        <input
          type="text"
          value={searchQuery}
          className="w-full bg-transparent py-[10px] outline-none text-white "
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isAgent ? 'Ask the agent…' : 'Search notes…'}
        />
        {searchQuery && (
          <IoMdClose
            className="text-slate-400 hover:text-white mr-2 text-xl cursor-pointer"
            onClick={clearSearch}
          />
        )}
        <FaMagnifyingGlass
          className={`cursor-pointer ${isAgent ? 'text-[#dd5e57]' : 'text-[#ccc6bc]'} hover:text-white transition-colors`}
          onClick={() => {
            if (isAgent) sendToAgent();
          }}
        />
      </div>
    </div>
  );
};

export default SearchBar;
