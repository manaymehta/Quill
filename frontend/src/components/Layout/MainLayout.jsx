import React, { useState, useRef, useEffect } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Navbar from "../Navbar/Navbar";
import { Outlet, useNavigate } from "react-router-dom";
import { UserContext } from "../../context/UserContext";
import axiosInstance from "../../utils/axiosInstance";

const MainLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const sidebarRef = useRef(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isSearch, setIsSearch] = useState(false);
  const [allNotes, setAllNotes] = useState([]);

  const navigate = useNavigate();

  const getUserInfo = async () => {
    try {
      const response = await axiosInstance.get("/get-user");
      if (response.data && response.data.user) {
        setUserInfo(response.data.user);
      }

    } catch (error) {
      if (error.response.status == 401) {
        localStorage.clear();
        navigate("/login");
      }
    }
  };

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
    const handleClickOutside = (event) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target)) {
        setIsSidebarOpen(false);
      }
    };

    if (isSidebarOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isSidebarOpen]);


  return (
    <UserContext.Provider value={userInfo}>
      <div className="min-h-screen bg-neutral-200">
        <Navbar
          onSearch={onSearch}
          onLogout={() => { }}
          userInfo={userInfo}
          handleClearSearch={handleClearSearch}

          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isSidebarOpen={isSidebarOpen}
        />
        <div className={`transition-all duration-300 ease-in-out ${isSidebarOpen ? "pl-64" : "pl-0"}`}>
          <Outlet context={{ userInfo, allNotes, setAllNotes, getAllNotes, getUserInfo }} />
        </div>
        <Sidebar isOpen={isSidebarOpen} ref={sidebarRef} />
      </div>
    </UserContext.Provider>
  );
};

export default MainLayout;
