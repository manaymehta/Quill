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

    const MAX_DISTANCE = 120;
    const SPEED = 0.5;

    let nodes = [];
    let density;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.scale(dpr, dpr);

      density = Math.floor((window.innerWidth * window.innerHeight) / 11000);
      nodes = [];
      initNodes();
    };

    const initNodes = () => {
      for (let i = 0; i < density; i++) {
        nodes.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
          radius: Math.random() * 1.5 + 1,
        });
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        if (node.x - node.radius < 0 || node.x + node.radius > window.innerWidth) {
          node.vx *= -1;
        }
        if (node.y - node.radius < 0 || node.y + node.radius > window.innerHeight) {
          node.vy *= -1;
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();
      }

      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const dist = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
          if (dist < MAX_DISTANCE) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${1 - (dist / MAX_DISTANCE)})`;
            ctx.lineWidth = 0.5;
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

  return (
    <div className="relative min-h-screen">
      <canvas ref={canvasRef} className="fixed top-0 left-0 w-full h-screen "></canvas>
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