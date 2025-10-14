import React, { forwardRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUIStore } from '../../store/useUIStore';
import { MdOutlineStickyNote2, MdOutlinePushPin, MdOutlineDelete, MdOutlineAutoGraph } from 'react-icons/md';

const Sidebar = forwardRef((props, ref) => {
  const navigate = useNavigate();
  const { isSidebarOpen } = useUIStore();
  const location = useLocation();

  const menuItems = [
    { icon: <MdOutlineStickyNote2 size={24} />, text: 'All Notes', path: '/dashboard' },
    { icon: <MdOutlinePushPin size={24} />, text: 'Pinned', path: '/pinned' },
    { icon: <MdOutlineAutoGraph size={24} />, text: 'Graph', path: '/graph' },
    { icon: <MdOutlineDelete size={24} />, text: 'Trash', path: '/trash' },
  ];

  return (
    <div
      ref={ref}
      className={`
        fixed top-0 left-0 h-full bg-[#202124] 
        transform transition-all duration-250 ease-in-out
        ${isSidebarOpen ? 'w-55' : 'w-0 sm:w-16'}
      `}
    >
      <div className="py-4">
        <h2 className="text-xl font-semibold"><br></br></h2>
      </div>
      <ul className=" space-y-1 mt-3 text-[#e85d56] text-xl font-medium">
        {menuItems.map((item, index) => (
          <li key={index}>
            <button
              className={`cursor-pointer w-full flex items-center h-14 rounded-4xl  transition-colors duration-50 ${location.pathname === item.path ? 'bg-[#4c2f2e]' : ''} hover:bg-[#313337] overflow-hidden`}
              onClick={() => navigate(item.path)}
            >
              <div className={`w-16 flex-shrink-0 flex items-center justify-center`}>
                {item.icon}
              </div>
              <div className={`transition-all duration-300 overflow-hidden  ${isSidebarOpen ? 'w-23' : 'w-0'}`}>
                <span className="whitespace-nowrap">
                  {item.text}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});

export default Sidebar;
