// src/components/Sidebar/Sidebar.jsx
import React, { forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../../store/useUIStore';

const Sidebar = forwardRef((props, ref) => {
  const navigate = useNavigate();
  const { isSidebarOpen } = useUIStore();

  return (
    <div
      ref={ref}
      className={`
        fixed top-0 left-0 h-full w-64 bg-[#393939] shadow-md z-30
        transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
    >
      <div className="p-4 border-b">
        <h2 className="text-xl font-semibold">Menu</h2>
      </div>
      <ul className="p-4 space-y-4 mt-3 text-[#e85d56] text-xl font-medium">
        
        <li className="cursor-pointer "><button className='cursor-pointer' onClick={() => navigate("/dashboard")}>All Notes</button></li>
        <li className="cursor-pointer "><button className='cursor-pointer' onClick={() => navigate("/pinned")}>Pinned</button></li>
        <li className="cursor-pointer "><button className='cursor-pointer' onClick={() => navigate("/trash")}>Trash</button></li>
      </ul>
    </div>
  );
});

export default Sidebar;