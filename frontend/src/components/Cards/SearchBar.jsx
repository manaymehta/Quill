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
    isSearchingAI,
    executeAiSearch,
    clearSearch,
  } = useSearchStore();

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      if (searchMode === 'semantic') {
        executeAiSearch(searchQuery.trim());
      } else if (searchMode === 'agent') {
        // Agent input lives in the chat panel; the navbar field acts as a
        // launcher so the conversation panel appears open with context.
        useAgentStore.getState().sendMessage(searchQuery.trim());
        setSearchQuery('');
      }
    }
  };

  const handleClear = () => {
    clearSearch();
  };

  const MODE_ORDER = ['keyword', 'semantic', 'agent'];
  const toggleMode = () => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(searchMode) + 1) % MODE_ORDER.length];
    setSearchMode(next);
  };

  const isAI = searchMode === 'semantic';
  const isAgent = searchMode === 'agent';
  const modeTitle = isAI
    ? 'AI search — click to switch mode'
    : isAgent
      ? 'Notes agent — click to switch mode'
      : 'Keyword search — click to switch mode';

  return (
    <div className="flex items-center gap-2 w-full sm:w-auto mx-2 rounded-full">
      <button
        onClick={toggleMode}
        title={modeTitle}
        className={`flex items-center gap-1 px-3 py-3 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer
          ${isAI
            ? 'bg-[#dd5e57] text-white '
            : isAgent
              ? 'bg-[#635c51] text-white '
              : 'bg-[#27272a] text-slate-400 hover:text-white '
          }`}
      >
        <RiSparkling2Fill className={`text-sm ${isAI || isAgent ? 'text-white' : 'text-[#dd5e57]'}`} />
        {isAgent && <span>Agent</span>}
      </button>


      <div className="flex w-full sm:w-80 items-center px-4 bg-[#27272a]  rounded-full">
        <input
          type="text"
          value={searchQuery}
          className="w-full bg-transparent py-[10px] outline-none text-white "
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isAgent ? 'Ask the agent…' : isAI ? 'AI Search' : 'Search notes…'}
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
          className={`cursor-pointer ${isAI || isAgent ? 'text-[#dd5e57]' : 'text-[#ccc6bc]'} hover:text-white transition-colors`}
          onClick={() => {
            if (!searchQuery.trim()) return;
            if (isAI) {
              executeAiSearch(searchQuery.trim());
            } else if (isAgent) {
              useAgentStore.getState().sendMessage(searchQuery.trim());
              setSearchQuery('');
            }
          }}
        />
      </div>
    </div>
  );
};

export default SearchBar;