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
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { MOBILE_QUERY } from "../../constants/breakpoints";
import { setKeyboardOverlaysContent } from "../../utils/virtualKeyboard";

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

    // Lock body scrolling when the editor or the agent chat is open: the chat fills the screen
    // between the navbar and the dock, and on phones the page could otherwise be scrolled (by hand,
    // or by the browser keeping the message box above the keyboard), sliding the card off the dock.
    // Also while the sidebar covers the page on phones: a swipe on it scrolled the page behind
    // (straight through when the sidebar was too short to scroll, or once it reached its end).
    const isPhone = useMediaQuery(MOBILE_QUERY);
    const isPhoneSidebarOpen = isPhone && isSidebarOpen;
    useEffect(() => {
        if (isEditorActive || isAgentMode || isPhoneSidebarOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isEditorActive, isAgentMode, isPhoneSidebarOpen]);

    // While a note or the agent chat is open, the on-screen keyboard covers the page instead of
    // resizing or dragging it; those screens make room for it themselves (utils/virtualKeyboard)
    const isKeyboardOverlay = isEditorActive || isAgentMode;
    useEffect(() => {
        setKeyboardOverlaysContent(isKeyboardOverlay);
        return () => setKeyboardOverlaysContent(false);
    }, [isKeyboardOverlay]);

    return (
        <div className="relative min-h-screen min-h-dvh">
            <ParticleBackground isPaused={isEditorActive || isAgentMode} />
            
            {/* Navbar rendered on normal pages at z-[100]; hidden while a note or the agent chat is
                open, with a floating ☰ in its place (GlobalEditorOverlay) */}
            {!isEditorActive && !isAgentMode && <Navbar />}

            {/* Main Outlet content (hidden when editor is active) */}
            <div className={`transition-[padding] ${isSidebarOpen ? "pl-0 sm:pl-55 duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]" : "pl-0 sm:pl-16 duration-200 ease-[cubic-bezier(0.2,0,0,1)]"} pt-[60px] md:pt-[72px] ${isEditorActive ? "hidden" : ""}`}>
                {/* The chat in place of the page. It opens with its own scale-up; closing, it leaves the
                    same way reversed (a slight shrink and a quick fade) and the page fades back in —
                    it used to vanish in one frame. The page stays mounted underneath, only hidden, as
                    it does behind the editor: it was unmounted for the chat and rebuilt on the way
                    back (every card and its text), and only after the chat's exit animation had run,
                    so returning could take long or show nothing until the browser drew frames again.
                    Same timing as before: the chat leaves (0.1s), then the page fades in (0.12s). */}
                <div className="relative">
                    <motion.div
                        initial={false}
                        animate={isAgentMode
                            ? { opacity: 0, transition: { duration: 0 } }
                            : { opacity: 1, transition: { duration: 0.12, delay: 0.1, ease: EASE_OUT } }}
                        className={isAgentMode ? "hidden" : ""}
                    >
                        {/* Boundary for lazily loaded routes (e.g. Graph) so the shell stays mounted */}
                        <Suspense fallback={null}>
                            <Outlet />
                        </Suspense>
                    </motion.div>
                    <AnimatePresence initial={false}>
                        {isAgentMode && (
                            <motion.div
                                key="agent"
                                style={{ originY: 0 }}
                                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1, ease: EASE_IN } }}
                                // Out of the page's flow (it sits where the page's content starts), so
                                // while it leaves, the page below doesn't get pushed down. The margin
                                // cancels the sidebar's padding above (same widths, timing and curve),
                                // so the chat stays centred on the screen while the sidebar slides over
                                // it, as the editor does; in the padded column it re-centred and shifted
                                className={`absolute inset-x-0 top-0 transition-[margin] ${isSidebarOpen ? "ml-0 sm:-ml-55 duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]" : "ml-0 sm:-ml-16 duration-200 ease-[cubic-bezier(0.2,0,0,1)]"}`}
                            >
                                <AgentPanel />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
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
