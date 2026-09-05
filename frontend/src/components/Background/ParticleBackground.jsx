import React, { useEffect, useRef } from 'react';

const ParticleBackground = ({
  isPaused = false,
  className = "fixed top-0 left-0 w-full h-screen pointer-events-none",
  variant = "monochrome"
}) => {
  const canvasRef = useRef(null);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    let isTabVisible = !document.hidden;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const LOGICAL_WIDTH = 1920;
    const LOGICAL_HEIGHT = 1080;
    const MAX_DISTANCE = 180;
    const SPEED = 0.5;

    let nodes = [];
    let density = Math.floor((LOGICAL_WIDTH * LOGICAL_HEIGHT) / 45000);

    const initNodes = () => {
      nodes = [];
      for (let i = 0; i < density; i++) {
        nodes.push({
          x: Math.random() * LOGICAL_WIDTH,
          y: Math.random() * LOGICAL_HEIGHT,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
          radius: variant === 'landing' ? Math.random() * 1.5 + 0.5 : Math.random() * 3 + 1,
          color: variant === 'landing'
            ? (Math.random() > 0.8 ? 'rgba(255, 107, 107, 0.5)' : 'rgba(244, 234, 220, 0.3)')
            : 'rgba(255, 255, 255, 0.5)',
        });
      }
    };

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = LOGICAL_WIDTH * dpr;
      canvas.height = LOGICAL_HEIGHT * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      density = Math.floor((LOGICAL_WIDTH * LOGICAL_HEIGHT) / 45000);
      initNodes();
      drawFrame();
    };

    const drawFrame = () => {
      ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
      }

      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const dx = nodes[a].x - nodes[b].x;
          const dy = nodes[a].y - nodes[b].y;
          const distSq = dx * dx + dy * dy;

          if (distSq < MAX_DISTANCE * MAX_DISTANCE) {
            const dist = Math.sqrt(distSq);
            const opacity = 1 - (dist / MAX_DISTANCE);
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);

            if (variant === 'landing') {
              const isAccent = nodes[a].color.includes('255, 107') || nodes[b].color.includes('255, 107');
              ctx.strokeStyle = isAccent
                ? `rgba(255, 107, 107, ${opacity * 0.75})`
                : `rgba(244, 234, 220, ${opacity * 0.4})`;
            } else {
              ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            }
            ctx.stroke();
          }
        }
      }
    };

    const updateNodes = () => {
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        if (node.x - node.radius < 0 || node.x + node.radius > LOGICAL_WIDTH) {
          node.vx *= -1;
        }
        if (node.y - node.radius < 0 || node.y + node.radius > LOGICAL_HEIGHT) {
          node.vy *= -1;
        }
      }
    };

    const loop = () => {
      if (prefersReducedMotion) {
        drawFrame();
        return;
      }

      if (!isTabVisible || isPausedRef.current) {
        animationFrameId = null;
        return;
      }

      updateNodes();
      drawFrame();
      animationFrameId = requestAnimationFrame(loop);
    };

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (isTabVisible && !isPausedRef.current && !animationFrameId && !prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(loop);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', resizeCanvas);

    resizeCanvas();

    if (!prefersReducedMotion && isTabVisible && !isPausedRef.current) {
      animationFrameId = requestAnimationFrame(loop);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [variant]);

  useEffect(() => {
    if (!isPaused && !document.hidden && canvasRef.current) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!prefersReducedMotion) {
        const event = new Event('visibilitychange');
        document.dispatchEvent(event);
      }
    }
  }, [isPaused]);

  return <canvas ref={canvasRef} className={className} />;
};

export default React.memo(ParticleBackground);
