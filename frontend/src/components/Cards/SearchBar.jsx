import React from 'react';
import { FaMagnifyingGlass } from 'react-icons/fa6';
import { IoMdClose } from 'react-icons/io';
import { RiSparkling2Fill } from 'react-icons/ri';
import { motion, AnimatePresence } from 'framer-motion';
import { PILL_FADE } from '../TabDock/dockMotion';

// The label's width: the dock's quickest width spring (no bounce on widths)
const LABEL_SPRING = { type: 'spring', visualDuration: 0.16, bounce: 0 };
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
    <div data-navbar-search="" className="flex items-center gap-2 w-full sm:w-auto mx-2 rounded-full">
      <button
        onClick={toggleMode}
        title={isAgent ? 'Notes agent — click for keyword search' : 'Keyword search — click for the notes agent'}
        className={`flex items-center px-3 py-3 rounded-full text-xs font-semibold transition-colors duration-200 whitespace-nowrap cursor-pointer
          ${isAgent
            ? 'bg-[#dd5e57] hover:bg-[#fb6d65] text-white '
            : 'bg-[#27272a] text-slate-400 hover:text-white '
          }`}
      >
        <RiSparkling2Fill className={`text-sm ${isAgent ? 'text-white' : 'text-[#dd5e57]'}`} />
        {/* The label grows in and out with a quick width spring (no bounce on widths) and
            fades, so the button and the search field glide instead of snapping. Its gap is inside
            the part that grows, so nothing jumps at the end. */}
        <AnimatePresence initial={false}>
          {isAgent && (
            <motion.span
              key="label"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ width: LABEL_SPRING, opacity: PILL_FADE }}
              // Phones: the coral sparkle alone says it, and the search field needs the room
              className="overflow-hidden hidden sm:block"
            >
              <span className="block pl-1">Agent</span>
            </motion.span>
          )}
        </AnimatePresence>
      </button>


      {/* min-w-0 here and on the input: an input won't shrink below its built-in width on its own,
          so on a phone it ran under the search icon */}
      <div className="flex flex-1 min-w-0 sm:flex-none sm:w-80 items-center px-4 bg-[#27272a] rounded-full">
        <input
          type="text"
          value={searchQuery}
          className="flex-1 min-w-0 w-full bg-transparent py-[10px] outline-none text-white placeholder:truncate"
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isAgent ? 'Ask the agent…' : 'Search notes…'}
        />
        {searchQuery && (
          <IoMdClose
            className="shrink-0 text-slate-400 hover:text-white mr-2 text-xl cursor-pointer"
            onClick={clearSearch}
          />
        )}
        <FaMagnifyingGlass
          className={`shrink-0 ml-2 cursor-pointer ${isAgent ? 'text-[#dd5e57]' : 'text-[#ccc6bc]'} hover:text-white transition-colors`}
          onClick={() => {
            if (isAgent) sendToAgent();
          }}
        />
      </div>
    </div>
  );
};

export default SearchBar;
