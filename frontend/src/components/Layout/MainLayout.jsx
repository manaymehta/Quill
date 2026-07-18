import { useRef, useEffect } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Navbar from "../Navbar/Navbar";
import { Outlet, useLocation } from "react-router-dom";
import ConfirmModal from "../Modals/ConfirmModal";
import FolderDeleteModal from "../Modals/FolderDeleteModal";
import { useUIStore } from "../../store/useUIStore";
import { useAuthStore } from "../../store/useAuthStore";
import { useNotesStore } from "../../store/useNotesStore";
import { useTabsStore } from "../../store/useTabsStore";
import TabDock from "../TabDock/TabDock";
import { useModalStore } from "../Modals/useModalStore";

const MainLayout = () => {
    const { isSidebarOpen, toggleSidebar } = useUIStore();
    const { getUser } = useAuthStore();
    const { getAllNotes, onSearch, handleClearSearch, onAiSearch } = useNotesStore();
    const { activeTabId, setActiveTab } = useTabsStore();
    const location = useLocation();
    const { closeConfirmModal, closeFolderDeleteModal } = useModalStore();

    const isEditorActive = activeTabId !== 'home';

    const sidebarRef = useRef(null);
    const canvasRef = useRef(null);
    const isEditorActiveRef = useRef(isEditorActive);

    useEffect(() => {
        isEditorActiveRef.current = isEditorActive;
    }, [isEditorActive]);

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
        getAllNotes();
        getUser();
    }, [getAllNotes, getUser]);

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

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        let animationFrameId;

        // used for fixed resolution for the animation.
        const LOGICAL_WIDTH = 1920;
        const LOGICAL_HEIGHT = 1080;

        const MAX_DISTANCE = 180;
        const SPEED = 0.5;

        let nodes = [];
        let density;

        const resizeCanvas = () => {
            const dpr = window.devicePixelRatio || 1;

            // Set the canvas to fixed logical size.
            canvas.width = LOGICAL_WIDTH * dpr;
            canvas.height = LOGICAL_HEIGHT * dpr;

            // Scale canvas to fill the window, but run the animation at a fixed resolution.
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            ctx.scale(dpr, dpr);

            density = Math.floor((LOGICAL_WIDTH * LOGICAL_HEIGHT) / 45000);

            nodes = [];
            initNodes();
        };

        const initNodes = () => {
            for (let i = 0; i < density; i++) {
                nodes.push({
                    // Place nodes within the space.
                    x: Math.random() * LOGICAL_WIDTH,
                    y: Math.random() * LOGICAL_HEIGHT,
                    vx: (Math.random() - 0.5) * SPEED,
                    vy: (Math.random() - 0.5) * SPEED,
                    radius: Math.random() * 3 + 1,
                });
            }
        };

        const animate = () => {
            if (isEditorActiveRef.current) {
                // Pause calculations and drawing to conserve power while editing notes
                animationFrameId = requestAnimationFrame(animate);
                return;
            }

            // Clear the logical canvas
            ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

            for (const node of nodes) {
                node.x += node.vx;
                node.y += node.vy;

                // Perform boundary checks
                if (node.x - node.radius < 0 || node.x + node.radius > LOGICAL_WIDTH) {
                    node.vx *= -1;
                }
                if (node.y - node.radius < 0 || node.y + node.radius > LOGICAL_HEIGHT) {
                    node.vy *= -1;
                }

                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.fill();
            }

            for (let a = 0; a < nodes.length; a++) {
                for (let b = a + 1; b < nodes.length; b++) {
                    const dx = nodes[a].x - nodes[b].x;
                    const dy = nodes[a].y - nodes[b].y;
                    const distSq = dx * dx + dy * dy;

                    if (distSq < MAX_DISTANCE * MAX_DISTANCE) {
                        const dist = Math.sqrt(distSq); // Only calc true distance if rendering
                        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - (dist / MAX_DISTANCE)})`;
                        ctx.lineWidth = 0.9;
                        ctx.beginPath();
                        ctx.moveTo(nodes[a].x, nodes[a].y);
                        ctx.lineTo(nodes[b].x, nodes[b].y);
                        ctx.stroke();
                    }
                }
            }

            animationFrameId = requestAnimationFrame(animate);
        };

        resizeCanvas();
        animate();

        window.addEventListener('resize', resizeCanvas);
        return () => {
            window.removeEventListener('resize', resizeCanvas);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

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
            <canvas ref={canvasRef} className="fixed top-0 left-0 w-full h-screen pointer-events-none"></canvas>
            <div className="relative z-10">
                {!isEditorActive && (
                    <Navbar
                        onSearch={onSearch}
                        handleClearSearch={handleClearSearch}
                        onAiSearch={onAiSearch}
                    />
                )}
                <div className={`transition-all duration-200 ease-in-out pt-[60px] md:pt-[72px] ${isSidebarOpen ? "pl-0 sm:pl-55" : "pl-0 sm:pl-16"}`}>
                    <Outlet />
                </div>
                
                {/* Mobile Backdrop overlay (continuous transition instead of conditional rendering) */}
                <div 
                    className={`fixed inset-0 bg-black/60 z-30 sm:hidden transition-opacity duration-200 ease-in-out ${isSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
                    onClick={toggleSidebar}
                />

                <Sidebar ref={sidebarRef} />
            </div>

            <TabDock />
            <ConfirmModal />
            <FolderDeleteModal />
        </div>
    );
};

export default MainLayout;