import React, { forwardRef, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '../../store/useUIStore';
import { MdOutlineStickyNote2, MdOutlineDelete, MdOutlineAutoGraph, MdOutlineArchive, MdAdd, MdOutlineFolder } from 'react-icons/md';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useTabsStore } from '../../store/useTabsStore';
import FolderTree from './FolderTree';

const Sidebar = forwardRef((props, ref) => {
  const navigate = useNavigate();
  const { isSidebarOpen } = useUIStore();
  const location = useLocation();

  const {
    folders,
    getFolders,
    createFolder
  } = useFoldersStore();

  const [isFoldersCollapsed, setIsFoldersCollapsed] = useState(false);
  const [showAddFolderInput, setShowAddFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [expandedFolders, setExpandedFolders] = useState({});

  useEffect(() => {
    getFolders();
  }, [getFolders]);

  const toggleExpand = (id) => {
    setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));
  };


  let activeFolderId = null;
  const match = location.pathname.match(/^\/folder\/([^/]+)/);
  if (match) {
    activeFolderId = match[1];
  }

  const isFoldersActive = activeFolderId !== null || location.search === '?view=folders';

  const menuItems = [
    { icon: <MdOutlineStickyNote2 size={24} />, text: 'All Notes', path: '/dashboard' },
    { icon: <MdOutlineArchive size={24} />, text: 'Archive', path: '/archive' },
    { icon: <MdOutlineAutoGraph size={24} />, text: 'Graph', path: '/graph' },
    { icon: <MdOutlineDelete size={24} />, text: 'Trash', path: '/trash' },
  ];

  return (
    <div
      ref={ref}
      className={`
        fixed top-0 left-0 h-full bg-[#202124] 
        transform transition-all duration-200 ease-in-out z-40
        sm:translate-x-0 overflow-y-auto overflow-x-hidden scrollbar-thin
        ${isSidebarOpen ? 'translate-x-0 w-55' : '-translate-x-full w-55 sm:w-16'}
      `}
    >
      <div className="py-4">
        <h2 className="text-xl font-semibold"><br></br></h2>
      </div>
      <ul className="px-1 space-y-1 mt-3 text-[#e85d56] text-xl font-medium">
        {menuItems.map((item, index) => (
          <li key={index}>
            <button
              className={`cursor-pointer w-full flex items-center h-14 rounded-4xl transition-colors duration-200 ease-in-out overflow-hidden ${
                (item.path === '/dashboard'
                  ? location.pathname === '/dashboard' && !location.search.includes('view=folders')
                  : location.pathname === item.path)
                ? 'bg-[#4c2f2e]'
                : 'hover:bg-[#313337]'
              }`}
              onClick={() => {
                useFoldersStore.getState().setActiveFolderId(null);
                const isActive = item.path === '/dashboard'
                  ? location.pathname === '/dashboard' && !location.search.includes('view=folders')
                  : location.pathname === item.path;
                
                if (isActive) {
                  useTabsStore.getState().setActiveTab('home');
                } else {
                  navigate(item.path);
                }
                if (window.matchMedia('(max-width: 639px)').matches && isSidebarOpen) {
                  useUIStore.getState().toggleSidebar();
                }
              }}
            >
              <div className={`w-14 flex-shrink-0 flex items-center justify-center`}>
                {item.icon}
              </div>
              <div className={`transition-all duration-200 overflow-hidden  ${isSidebarOpen ? 'w-23' : 'w-23 sm:w-0'}`}>
                <span className="whitespace-nowrap">
                  {item.text}
                </span>
              </div>
            </button>
          </li>
        ))}

        {/* Collapsible Folders menu item */}
        <li>
          <div className="flex flex-col">
            <div
              className={`cursor-pointer w-full flex items-center h-14 rounded-4xl transition-colors duration-200 ease-in-out overflow-hidden ${isFoldersActive ? 'bg-[#4c2f2e]' : 'hover:bg-[#313337]'}`}
              onClick={() => {
                const targetPath = '/dashboard?view=folders';
                if (location.pathname === '/dashboard' && location.search.includes('view=folders')) {
                  useTabsStore.getState().setActiveTab('home');
                } else {
                  navigate(targetPath);
                }
                if (window.matchMedia('(max-width: 639px)').matches && isSidebarOpen) {
                  useUIStore.getState().toggleSidebar();
                } else {
                  if (!isSidebarOpen) {
                    useUIStore.getState().toggleSidebar();
                    setIsFoldersCollapsed(false);
                  } else {
                    setIsFoldersCollapsed(prev => !prev);
                  }
                }
              }}
            >
              <div className="w-14 flex-shrink-0 flex items-center justify-center">
                <MdOutlineFolder size={24} />
              </div>
              <div className={`transition-all duration-200 overflow-hidden flex items-center justify-between w-full pr-4 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 sm:w-0'}`}>
                <span className="whitespace-nowrap text-left flex-1 pl-1">Folders</span>
                {isSidebarOpen && (
                  <div className="flex items-center gap-1">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAddFolderInput(true);
                        if (isFoldersCollapsed) setIsFoldersCollapsed(false);
                      }}
                      className="p-1 hover:text-white hover:bg-black/20 rounded transition-colors cursor-pointer text-stone-400"
                      title="Add Folder"
                    >
                      <MdAdd size={18} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Parent staggered container variants */}
            <AnimatePresence initial={false}>
              {isSidebarOpen && !isFoldersCollapsed && (
                <motion.div
                  initial="closed"
                  animate="open"
                  exit="closed"
                  variants={{
                    open: {
                      height: "auto",
                      opacity: 1,
                      transition: {
                        height: { type: "spring", stiffness: 400, damping: 30 },
                        opacity: { duration: 0.15 },
                        staggerChildren: 0.035,
                        delayChildren: 0.05
                      }
                    },
                    closed: {
                      height: 0,
                      opacity: 0,
                      transition: {
                        height: { duration: 0.2, ease: "easeIn" },
                        opacity: { duration: 0.1 },
                        staggerChildren: 0.02,
                        staggerDirection: -1
                      }
                    }
                  }}
                  className={`overflow-hidden pl-1 pr-1 py-1 border-l-2 ${folders.some(f => f.parentId === null && !f.isDeleted && f._id === activeFolderId) ? 'border-[#414549]' : 'border-[#2d3033]'} ml-5 mt-1`}
                >
                  {showAddFolderInput && (
                    <div className="flex items-center h-10 px-2 rounded-lg bg-[#282a2d] mb-1">
                      <MdOutlineFolder size={20} style={{ color: '#f4eadc' }} className="mr-2 flex-shrink-0" />
                      <input
                        autoFocus
                        type="text"
                        placeholder="Folder name..."
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onBlur={() => {
                          setShowAddFolderInput(false);
                          setNewFolderName('');
                        }}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            if (newFolderName.trim()) {
                              await createFolder(newFolderName.trim());
                            }
                            setShowAddFolderInput(false);
                            setNewFolderName('');
                          } else if (e.key === 'Escape') {
                            setShowAddFolderInput(false);
                            setNewFolderName('');
                          }
                        }}
                        className="bg-transparent text-white text-sm outline-none w-full"
                      />
                    </div>
                  )}

                  <FolderTree
                    parentId={null}
                    depth={0}
                    expandedFolders={expandedFolders}
                    onToggleExpand={toggleExpand}
                    activeFolderId={activeFolderId}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </li>
      </ul>
    </div>
  );
});

export default Sidebar;
