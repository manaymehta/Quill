import { useRef, useEffect, Suspense } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Navbar from "../Navbar/Navbar";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { EASE_IN, EASE_OUT } from "../TabDock/dockMotion";
import ConfirmModal from "../Modals/ConfirmModal";
import FolderDeleteModal from "../Modals/FolderDeleteModal";
import { useUIStore } from "../../store/useUIStore";
import { useTabsStore } from "../../store/useTabsStore";
import TabDock from "../TabDock/TabDock";
import GlobalEditorOverlay from "../Editor/GlobalEditorOverlay";
import { useModalStore } from "../Modals/useModalStore";
import ParticleBackground from "../Background/ParticleBackground";
import AgentPanel from "../Agent/AgentPanel";
import { useSearchStore } from "../../store/useSearchStore";
import { useAgentToast } from "../../hooks/useAgentToast";

const MainLayout = () => {
    const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
    const toggleSidebar = useUIStore((state) => state.toggleSidebar);
    const activeTabId = useTabsStore((state) => state.activeTabId);
    const setActiveTab = useTabsStore((state) => state.setActiveTab);
    const closeConfirmModal = useModalStore((state) => state.closeConfirmModal);
    const closeFolderDeleteModal = useModalStore((state) => state.closeFolderDeleteModal);
    const isAgentMode = useSearchStore((state) => state.searchMode === 'agent');
    const location = useLocation();

    const isEditorActive = activeTabId !== 'home';
    const sidebarRef = useRef(null);

    // While the chat is off screen, the agent's state shows as a toast that opens it
    useAgentToast();

    // Agent mode shows the chat in place of the page, on every page. Navigating
    // means "show me that page", so it leaves agent mode; the conversation (and
    // any turn still running) lives on in useAgentStore.
    useEffect(() => {
        const { searchMode, setSearchMode } = useSearchStore.getState();
        if (searchMode === 'agent') setSearchMode('keyword');
    }, [location.pathname, location.search]);

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
        <div className="relative min-h-screen min-h-dvh">
            <ParticleBackground isPaused={isEditorActive || isAgentMode} />
            
            {/* Navbar rendered on normal pages at z-[100] */}
            {!isEditorActive && <Navbar />}

            {/* Main Outlet content (hidden when editor is active) */}
            <div className={`transition-[padding] ${isSidebarOpen ? "pl-0 sm:pl-55 duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]" : "pl-0 sm:pl-16 duration-200 ease-[cubic-bezier(0.2,0,0,1)]"} pt-[60px] md:pt-[72px] ${isEditorActive ? "hidden" : ""}`}>
                {/* The chat in place of the page. It opens with its own scale-up; closing, it leaves the
                    same way reversed (a slight shrink and a quick fade) and the page fades back in —
                    it used to vanish in one frame. */}
                <AnimatePresence mode="wait" initial={false}>
                    {isAgentMode ? (
                        <motion.div
                            key="agent"
                            style={{ originY: 0 }}
                            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1, ease: EASE_IN } }}
                        >
                            <AgentPanel />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="page"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1, transition: { duration: 0.12, ease: EASE_OUT } }}
                        >
                            {/* Boundary for lazily loaded routes (e.g. Graph) so the shell stays mounted */}
                            <Suspense fallback={null}>
                                <Outlet />
                            </Suspense>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Global Note Editor Overlay (z-20) */}
            <GlobalEditorOverlay />
            
            {/* Mobile Backdrop overlay (z-[75]) — minimal 0.5rem overscan (-inset-2) moves blur-kernel edge sampling outside visible viewport, eliminating the 1px line while preserving cinematic motion blur */}
            <div 
                className={`fixed -inset-2 bg-black/60 backdrop-blur-[2px] z-[75] sm:hidden transition-all ${isSidebarOpen ? "opacity-100 pointer-events-auto duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]" : "opacity-0 pointer-events-none duration-200 ease-[cubic-bezier(0.2,0,0,1)]"}`}
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
