import { useRef, useEffect } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Navbar from "../Navbar/Navbar";
import { Outlet, useLocation } from "react-router-dom";
import ConfirmModal from "../Modals/ConfirmModal";
import FolderDeleteModal from "../Modals/FolderDeleteModal";
import { useUIStore } from "../../store/useUIStore";
import { useTabsStore } from "../../store/useTabsStore";
import TabDock from "../TabDock/TabDock";
import GlobalEditorOverlay from "../Editor/GlobalEditorOverlay";
import { useModalStore } from "../Modals/useModalStore";
import ParticleBackground from "../Background/ParticleBackground";

const MainLayout = () => {
    const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
    const toggleSidebar = useUIStore((state) => state.toggleSidebar);
    const activeTabId = useTabsStore((state) => state.activeTabId);
    const setActiveTab = useTabsStore((state) => state.setActiveTab);
    const closeConfirmModal = useModalStore((state) => state.closeConfirmModal);
    const closeFolderDeleteModal = useModalStore((state) => state.closeFolderDeleteModal);
    const location = useLocation();

    const isEditorActive = activeTabId !== 'home';
    const sidebarRef = useRef(null);

    // Unify scroll restoration, modal closing, and resetting editor tabs to home across page transitions
    useEffect(() => {
        window.scrollTo(0, 0);
        closeConfirmModal();
        closeFolderDeleteModal();
        if (!location.state?.preserveTab) {
            setActiveTab('home');
        }
    }, [location.pathname, location.search, location.state, closeConfirmModal, closeFolderDeleteModal, setActiveTab]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (isSidebarOpen && sidebarRef.current && !sidebarRef.current.contains(event.target)) {
                if (event.target.closest('.sidebar-toggle-btn')) return;
                toggleSidebar();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isSidebarOpen, toggleSidebar, sidebarRef]);

    // Lock body scrolling when the editor is active to prevent outer scrollbars
    useEffect(() => {
        if (isEditorActive) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isEditorActive]);

    return (
        <div className="relative min-h-screen">
            <ParticleBackground isPaused={isEditorActive} />
            
            {/* Navbar rendered on normal pages at z-[100] */}
            {!isEditorActive && <Navbar />}

            {/* Main Outlet content (hidden when editor is active) */}
            <div className={`transition-all duration-200 ease-in-out pt-[60px] md:pt-[72px] ${isSidebarOpen ? "pl-0 sm:pl-55" : "pl-0 sm:pl-16"} ${isEditorActive ? "hidden" : ""}`}>
                <Outlet />
            </div>

            {/* Global Note Editor Overlay (z-20) */}
            <GlobalEditorOverlay />
            
            {/* Mobile Backdrop overlay (z-[75]) */}
            <div 
                className={`fixed inset-0 bg-black/60 z-[75] sm:hidden transition-opacity duration-200 ease-in-out ${isSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
                onClick={toggleSidebar}
            />

            {/* Sidebar (z-[80] — above editor z-20, under Navbar z-[100]) */}
            <Sidebar ref={sidebarRef} />

            <TabDock />
            <ConfirmModal />
            <FolderDeleteModal />
        </div>
    );
};

export default MainLayout;
