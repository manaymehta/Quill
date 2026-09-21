import React, { useState, useEffect, useRef } from 'react';
import ProfileInfo from '../Cards/ProfileInfo';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../Cards/SearchBar';
import { FiMenu } from 'react-icons/fi';
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useSearchStore } from '../../store/useSearchStore';

const Navbar = () => {
  const navigate = useNavigate();
  const { logout, isLoggedIn } = useAuthStore();
  const { isNavbarVisible, toggleSidebar, isSidebarOpen } = useUIStore();
  const searchQuery = useSearchStore((state) => state.searchQuery);

  const [isScrolledVisible, setIsScrolledVisible] = useState(true);
  const navbarRef = useRef(null);

  // Mobile scroll direction listener (Quick Return / Headroom pattern).
  // Desktop/tablet pinning is handled purely in CSS via sm:translate-y-0.
  useEffect(() => {
    let lastY = window.scrollY;

    const handleScroll = () => {
      // Keep visible if sidebar is open or search is active
      if (useUIStore.getState().isSidebarOpen || useSearchStore.getState().searchQuery.trim()) {
        return;
      }

      // Do not hide while user is typing or focused on an input inside the navbar
      if (navbarRef.current && navbarRef.current.contains(document.activeElement)) {
        return;
      }

      // Dynamically measure runtime element height to avoid hardcoded pixel constants
      const navHeight = navbarRef.current ? navbarRef.current.offsetHeight : 0;
      const currentY = Math.max(0, window.scrollY);

      // Always visible within the navbar's own height from top
      if (currentY <= navHeight) {
        setIsScrolledVisible(true);
        lastY = currentY;
        return;
      }

      // Suppress false down-scroll triggers from iOS elastic overscroll bounce at page bottom
      const maxScrollY = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScrollY > 0 && currentY >= maxScrollY - (navHeight / 4)) {
        return;
      }

      const delta = currentY - lastY;
      // Use dynamic sensitivity threshold proportional to navbar height (~15%)
      const threshold = navHeight > 0 ? Math.round(navHeight * 0.15) : 8;

      if (delta > threshold) {
        setIsScrolledVisible(false);
        lastY = currentY;
      } else if (delta < -threshold) {
        setIsScrolledVisible(true);
        lastY = currentY;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const onLogout = () => {
    useTabsStore.getState().resetTabs();
    logout();
    navigate('/');
  };

  if (!isNavbarVisible) {
    return null;
  }

  // Derive effective visibility during render (React 19 compliant):
  // Always remains visible if sidebar is open or search query exists, avoiding cascading effects
  const isEffectiveVisible = isScrolledVisible || isSidebarOpen || Boolean(searchQuery && searchQuery.trim());

  return (
    <div
      ref={navbarRef}
      className={`bg-[#202124]/80 backdrop-blur-sm px-5 py-2 flex items-center justify-between z-[100] fixed top-0 left-0 w-full transition-transform duration-300 ease-out will-change-transform ${
        isEffectiveVisible ? 'translate-y-0' : '-translate-y-full'
      } sm:translate-y-0`}
    >
      <div className="flex items-center gap-4 text-[#dd5e57]">
        {isLoggedIn && (
          <FiMenu
            className="text-2xl cursor-pointer sidebar-toggle-btn"
            onClick={toggleSidebar}
          />
        )}

        <h2 className="hidden sm:block text-3xl text-white font-bold cursor-pointer py-2">
          Quill
        </h2>
      </div>

      {isLoggedIn && (
        <div className="flex-1 flex justify-center">
          <SearchBar />
        </div>
      )}

      {isLoggedIn && (
        <div className="flex items-center">
          <ProfileInfo onLogout={onLogout} />
        </div>
      )}
    </div>
  );
};

export default Navbar;