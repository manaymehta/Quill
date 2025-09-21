import React, { useRef, useEffect } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Navbar from "../Navbar/Navbar";
import { Outlet, useLocation } from "react-router-dom";
import { useUIStore } from "../../store/useUIStore";
import { useAuthStore } from "../../store/useAuthStore";
import { useNotesStore } from "../../store/useNotesStore";

const MainLayout = () => {
  const { isSidebarOpen, toggleSidebar } = useUIStore();
  const { getUser } = useAuthStore();
  const { getAllNotes, onSearch, handleClearSearch } = useNotesStore();
  const location = useLocation();

  const sidebarRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    getAllNotes();
    getUser();
  }, [getAllNotes, getUser]);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const DENSITY = 50; // Adjusted for a larger area
    const MAX_DISTANCE = 120;
    const SPEED = 0.5;

    let nodes = [];

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      nodes = [];
      initNodes();
    };

    const initNodes = () => {
      for (let i = 0; i < DENSITY; i++) {
        nodes.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
          radius: Math.random() * 2 + 1,
        });
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const node of nodes) {
        if (node.x + node.radius > canvas.width || node.x - node.radius < 0) {
          node.vx *= -1;
        }
        if (node.y + node.radius > canvas.height || node.y - node.radius < 0) {
          node.vy *= -1;
        }
        node.x += node.vx;
        node.y += node.vy;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; // More subtle nodes
        ctx.fill();
      }

      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const dist = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
          if (dist < MAX_DISTANCE) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${1 - (dist / MAX_DISTANCE)})`; // More subtle lines
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    // Use a timeout to ensure layout is stable before sizing canvas
    setTimeout(resizeCanvas, 0);
    animate();

    window.addEventListener('resize', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="relative min-h-screen">
      <canvas ref={canvasRef} className="fixed top-0 left-0 w-full h-screen z-[-1]"></canvas>
      <div className="relative z-10">
        <Navbar
          onSearch={onSearch}
          handleClearSearch={handleClearSearch}
        />
        <div className={`transition-all duration-300 ease-in-out ${isSidebarOpen ? "pl-64" : "pl-0"}`}>
          <Outlet />
        </div>
        <Sidebar ref={sidebarRef} />
      </div>
    </div>
  );
};

export default MainLayout;