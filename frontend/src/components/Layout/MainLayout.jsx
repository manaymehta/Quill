import React, { useState, useRef, useEffect } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Navbar from "../Navbar/Navbar";
import { Outlet, useNavigate } from "react-router-dom";
import axiosInstance from "../../utils/axiosInstance";
import { useUIStore } from "../../store/useUIStore";
import { useAuthStore } from "../../store/useAuthStore";

const MainLayout = () => {
  const { isSidebarOpen, toggleSidebar } = useUIStore();
  const { getUser } = useAuthStore();
  const sidebarRef = useRef(null);
  const [isSearch, setIsSearch] = useState(false);
  const [allNotes, setAllNotes] = useState([]);

  const navigate = useNavigate();

  const onSearch = async (query) => {
    try {
      const response = await axiosInstance("/search-notes", {
        params: { query }
      });

      if (response.data && response.data.notes) {
        setIsSearch(true);
        setAllNotes(response.data.notes)
      }
    } catch (error) {
      console.log(error);
    }
  }

  const handleClearSearch = () => {
    setIsSearch(false);
    getAllNotes();
  }

  const getAllNotes = async () => {
    try {
      const response = await axiosInstance.get("/get-all-notes")
      if (response.data && response.data.notes) {
        setAllNotes(response.data.notes);
      }
    }
    catch (error) {
      console.log("Unexpected error. Please try again");
    }
  }

  useEffect(() => {
    getAllNotes();
    getUser();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isSidebarOpen && sidebarRef.current && !sidebarRef.current.contains(event.target)) {
        toggleSidebar();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isSidebarOpen, toggleSidebar, sidebarRef]);


  return (
    <div className="min-h-screen">
      <Navbar
        onSearch={onSearch}
        handleClearSearch={handleClearSearch}
      />
      <div className={`transition-all duration-300 ease-in-out ${isSidebarOpen ? "pl-64" : "pl-0"}`}>
        <Outlet context={{ allNotes, setAllNotes, getAllNotes }} />
      </div>
      <Sidebar ref={sidebarRef} />
    </div>
  );
};

export default MainLayout;
