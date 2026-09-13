import React, { useEffect, useRef } from 'react';

const PARTICLE_CONFIG = {
  MOBILE_BREAKPOINT: 768,

  // Responsive connection distance (balanced reach for elegant polygons without over-clustering)
  MAX_DISTANCE_DESKTOP: 165,
  MAX_DISTANCE_MOBILE: 115,

  // Responsive drift speed (calibrated so screen traversal feels calm and serene on all sizes)
  SPEED_DESKTOP: 0.5,
  SPEED_MOBILE: 0.28,

  LINE_WIDTH: 0.75,
  AREA_PER_NODE: 35000,
  MIN_NODES: 15,
  MAX_NODES: 50,

  LANDING_ACCENT_CHANCE: 0.2,
  LANDING_ACCENT_COLOR: 'rgba(255, 107, 107, 0.5)',
  LANDING_DEFAULT_COLOR: 'rgba(244, 234, 220, 0.3)',
  MONOCHROME_COLOR: 'rgba(255, 255, 255, 0.5)',

  // Alpha multipliers for connecting lines (crisp visibility without harsh glare)
  LINE_ALPHA_DESKTOP: 0.7,
  LINE_ALPHA_MOBILE: 0.55,

  LANDING_LINE_ACCENT_ALPHA_DESKTOP: 0.65,
  LANDING_LINE_ACCENT_ALPHA_MOBILE: 0.45,
  LANDING_LINE_DEFAULT_ALPHA_DESKTOP: 0.35,
  LANDING_LINE_DEFAULT_ALPHA_MOBILE: 0.25,
};

const getResponsiveParams = (w) => {
  const isMobile = w > 0 ? w < PARTICLE_CONFIG.MOBILE_BREAKPOINT : false;
  return {
    isMobile,
    maxDistance: isMobile ? PARTICLE_CONFIG.MAX_DISTANCE_MOBILE : PARTICLE_CONFIG.MAX_DISTANCE_DESKTOP,
    speed: isMobile ? PARTICLE_CONFIG.SPEED_MOBILE : PARTICLE_CONFIG.SPEED_DESKTOP,
    lineAlpha: isMobile ? PARTICLE_CONFIG.LINE_ALPHA_MOBILE : PARTICLE_CONFIG.LINE_ALPHA_DESKTOP,
    landingAccentAlpha: isMobile
      ? PARTICLE_CONFIG.LANDING_LINE_ACCENT_ALPHA_MOBILE
      : PARTICLE_CONFIG.LANDING_LINE_ACCENT_ALPHA_DESKTOP,
    landingDefaultAlpha: isMobile
      ? PARTICLE_CONFIG.LANDING_LINE_DEFAULT_ALPHA_MOBILE
      : PARTICLE_CONFIG.LANDING_LINE_DEFAULT_ALPHA_DESKTOP,
  };
};

const ParticleBackground = ({
  isPaused = false,
  className = "fixed inset-0 w-full h-full pointer-events-none",
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

    let width = canvas.clientWidth || window.innerWidth || 0;
    let height = canvas.clientHeight || window.innerHeight || 0;
    let currentParams = getResponsiveParams(width);

    const calculateDensity = (w, h) => {
      if (w <= 0 || h <= 0) return PARTICLE_CONFIG.MIN_NODES;
      return Math.max(
        PARTICLE_CONFIG.MIN_NODES,
        Math.min(PARTICLE_CONFIG.MAX_NODES, Math.floor((w * h) / PARTICLE_CONFIG.AREA_PER_NODE))
      );
    };

    const createNode = (w, h, speed) => {
      const isLanding = variant === 'landing';
      const isAccent = isLanding && Math.random() < PARTICLE_CONFIG.LANDING_ACCENT_CHANCE;
      const color = isLanding
        ? (isAccent ? PARTICLE_CONFIG.LANDING_ACCENT_COLOR : PARTICLE_CONFIG.LANDING_DEFAULT_COLOR)
        : PARTICLE_CONFIG.MONOCHROME_COLOR;

      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        radius: isLanding ? Math.random() * 1.2 + 0.5 : Math.random() * 1.8 + 1.0,
        color,
      };
    };

    let nodes = [];

    const initNodes = (w, h) => {
      const count = calculateDensity(w, h);
      nodes = [];
      for (let i = 0; i < count; i++) {
        nodes.push(createNode(w, h, currentParams.speed));
      }
    };

    const setupCanvasDimensions = (w, h) => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const resizeCanvas = () => {
      const newWidth = canvas.clientWidth || window.innerWidth || 0;
      const newHeight = canvas.clientHeight || window.innerHeight || 0;

      // On touch devices, vertical-only dimension fluctuations are triggered exclusively by browser UI
      // chrome (such as the mobile URL address bar or navigation toolbar expanding/collapsing on scroll).
      // True orientation changes (portrait <-> landscape) or split-screen adjustments always change width.
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (isTouch && newWidth === width) {
        return;
      }

      const oldWidth = width;
      const oldHeight = height;
      const prevSpeed = currentParams.speed;

      width = newWidth;
      height = newHeight;
      currentParams = getResponsiveParams(width);

      setupCanvasDimensions(width, height);

      // Proportional repositioning: smoothly adapt existing node coordinates without teleporting
      if (oldWidth > 0 && oldHeight > 0) {
        const scaleX = width / oldWidth;
        const scaleY = height / oldHeight;
        const speedScale = prevSpeed > 0 ? currentParams.speed / prevSpeed : 1;

        for (const node of nodes) {
          node.x *= scaleX;
          node.y *= scaleY;
          node.vx *= speedScale;
          node.vy *= speedScale;
        }
      }

      // Adjust density smoothly if screen area changed significantly
      const targetDensity = calculateDensity(width, height);
      if (nodes.length < targetDensity) {
        for (let i = nodes.length; i < targetDensity; i++) {
          nodes.push(createNode(width, height, currentParams.speed));
        }
      } else if (nodes.length > targetDensity) {
        nodes.length = targetDensity;
      }

      drawFrame();
    };

    const drawFrame = () => {
      ctx.clearRect(0, 0, width, height);

      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
      }

      const maxDist = currentParams.maxDistance;
      const maxDistSq = maxDist * maxDist;

      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const dx = nodes[a].x - nodes[b].x;
          const dy = nodes[a].y - nodes[b].y;
          const distSq = dx * dx + dy * dy;

          if (distSq < maxDistSq) {
            const dist = Math.sqrt(distSq);
            const opacity = 1 - (dist / maxDist);
            ctx.lineWidth = PARTICLE_CONFIG.LINE_WIDTH;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);

            if (variant === 'landing') {
              const isAccent =
                nodes[a].color === PARTICLE_CONFIG.LANDING_ACCENT_COLOR ||
                nodes[b].color === PARTICLE_CONFIG.LANDING_ACCENT_COLOR;
              ctx.strokeStyle = isAccent
                ? `rgba(255, 107, 107, ${opacity * currentParams.landingAccentAlpha})`
                : `rgba(244, 234, 220, ${opacity * currentParams.landingDefaultAlpha})`;
            } else {
              ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * currentParams.lineAlpha})`;
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

        if (node.x - node.radius < 0) {
          node.x = node.radius;
          node.vx *= -1;
        } else if (node.x + node.radius > width) {
          node.x = width - node.radius;
          node.vx *= -1;
        }

        if (node.y - node.radius < 0) {
          node.y = node.radius;
          node.vy *= -1;
        } else if (node.y + node.radius > height) {
          node.y = height - node.radius;
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

    // Initialize dimensions and populate nodes once
    setupCanvasDimensions(width, height);
    initNodes(width, height);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', resizeCanvas);

    if (!prefersReducedMotion && isTabVisible && !isPausedRef.current) {
      animationFrameId = requestAnimationFrame(loop);
    } else {
      drawFrame();
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
