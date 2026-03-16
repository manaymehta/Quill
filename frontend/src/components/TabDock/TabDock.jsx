import { useNavigate } from 'react-router-dom';
import { MdAdd, MdHome, MdClose } from 'react-icons/md';
import { useTabsStore } from '../../store/useTabsStore';

const TabDock = () => {
  const navigate = useNavigate();
  const { openTabs, activeTabId, setActiveTab, closeTab, createDraftTab } = useTabsStore();

  // dock is compact when any editor tab is active
  const isEditorActive = activeTabId !== 'home';

  const handleHomeClick = () => {
    setActiveTab('home');
    navigate('/dashboard');
  };

  const handleNewNote = () => {
    createDraftTab();
    navigate('/dashboard');
  };

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    navigate('/dashboard');
  };

  return (
    <div
      className={`
        fixed left-1/2 -translate-x-1/2 z-50
        flex items-center
        bg-[#2a2a2a]/85 backdrop-blur-md
        rounded-full border border-white/10 shadow-2xl
        transition-all duration-300 ease-in-out
        gap-1
        ${isEditorActive ? 'px-2 py-2 bottom-3' : 'px-2 py-2 bottom-4'}
      `}
    >
      {/* home button */}
      <button
        onClick={handleHomeClick}
        title="Home"
        className={`
          cursor-pointer
          flex items-center justify-center rounded-full transition-all duration-200
          ${activeTabId === 'home' ? 'bg-[#f4eadc] text-[#333] shadow-md' : 'text-stone-300 hover:bg-white/10'}
          ${isEditorActive ? 'w-8 h-8' : 'w-10 h-10'}
        `}
      >
        <MdHome className={isEditorActive ? 'text-lg' : 'text-xl'} />
      </button>

      {/* separator only when tabs exist */}
      {openTabs.length > 0 && (
        <div className={`w-[1px] bg-white/15 mx-0.5 ${isEditorActive ? 'h-4' : 'h-5'}`} />
      )}

      {/* note tabs */}
      {openTabs.map((tab) => {
        const isActive = activeTabId === tab._id;
        return (
          <div
            key={tab._id}
            onClick={() => handleTabClick(tab._id)}
            className={`
              group flex items-center rounded-full cursor-pointer transition-all duration-200 border
              ${isEditorActive ? 'pl-3.5 pr-2.5 py-1.5 max-w-[130px]' : 'pl-4 pr-3 py-2 max-w-[160px]'}
              ${isActive
                ? 'bg-[#f4eadc] text-[#333] shadow-sm border-transparent'
                : 'bg-white/5 text-stone-300 border-white/5 hover:bg-white/10'
              }
            `}
          >
            <span className={`truncate font-medium mr-1.5 ${isEditorActive ? 'text-xs' : 'text-sm'}`}>
              {tab.title || 'Untitled Note'}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab._id); }}
              className={`
                flex-shrink-0 p-0.5 rounded-full transition-colors
                ${isActive
                  ? 'text-stone-500 hover:text-red-500 hover:bg-stone-100'
                  : 'text-stone-400 opacity-0 group-hover:opacity-100 hover:text-red-300 hover:bg-white/10'
                }
              `}
            >
              <MdClose className={isEditorActive ? 'text-[10px] cursor-pointer' : 'text-xs cursor-pointer'} />
            </button>
          </div>
        );
      })}

      {/* separator before + */}
      <div className={`w-[1px] bg-white/15 mx-0.5 ${isEditorActive ? 'h-4' : 'h-5'}`} />

      {/* add note */}
      <button
        onClick={handleNewNote}
        title="New Note"
        className={` 
          cursor-pointer
          flex items-center justify-center rounded-full
          bg-[#dd5e57] text-white hover:bg-[#fb6d65]
          shadow-md transition-all duration-200 hover:rotate-90
          ${isEditorActive ? 'w-8 h-8' : 'w-10 h-10'}
        `}
      >
        <MdAdd className={isEditorActive ? 'text-lg' : 'text-xl'} />
      </button>
    </div>
  );
};

export default TabDock;
