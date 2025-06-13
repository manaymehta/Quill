// src/components/Sidebar/Sidebar.jsx
import React from 'react';

const Sidebar = ({ isOpen }) => {
  return (
    <div
      className={`fixed top-0 left-0 h-full w-64 bg-white shadow-md z-30 transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="p-4 border-b">
        <h2 className="text-xl font-semibold">Menu</h2>
      </div>
      <ul className="p-4 space-y-4">
        <li className="cursor-pointer hover:text-blue-500">All Notes</li>
        <li className="cursor-pointer hover:text-blue-500">Pinned</li>
        <li className="cursor-pointer hover:text-blue-500">Trash</li>
      </ul>
    </div>
  );
};

export default Sidebar;
