import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './LandingPage.css';

const LandingPage = () => {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const [isExiting, setIsExiting] = React.useState(false);
  const navigate = useNavigate();

  const handleGetStarted = () => {
    setIsExiting(true);
    setTimeout(() => {
      navigate('/login');
    }, 600); // Match CSS transition duration
  };

  //   Network Canvas Background  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width, height;
    let particles = [];
    const connectionDistance = 150;
    const particleCount = 70;
    let animationFrameId;

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resize);
    resize();

    class Particle {
      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.radius = Math.random() * 1.5 + 0.5;
        this.color = Math.random() > 0.8 ? 'rgba(255, 107, 107, 0.5)' : 'rgba(244, 234, 220, 0.3)';
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
      }
    }

    const init = () => {
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
      }
    };

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      ctx.clearRect(0, 0, width, height);

      particles.forEach(p => p.update());
      particles.forEach(p => p.draw());

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < connectionDistance) {
            const opacity = (1 - (distance / connectionDistance)) * 0.2;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);

            const isSpec = particles[i].color.includes('255, 107') || particles[j].color.includes('255, 107');
            ctx.strokeStyle = isSpec ? `rgba(255, 107, 107, ${opacity * 1.5})` : `rgba(244, 234, 220, ${opacity})`;

            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    };

    init();
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  //   Procedural SVG Quill  
  useEffect(() => {
    if (!svgRef.current) return;

    let svgContent = `<defs>
        <filter id="strong-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComponentTransfer in="blur" result="glow"><feFuncA type="linear" slope="3"/></feComponentTransfer>
            <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="subtle-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
    </defs>`;

    const nodes = [];
    const topPoint = [420, 50];
    const basePoint = [120, 400];
    const nibTip = [80, 450];
    const stemDX = basePoint[0] - topPoint[0];
    const stemDY = basePoint[1] - topPoint[1];

    const getStemPoint = (t) => [
      topPoint[0] + stemDX * t,
      topPoint[1] + stemDY * t
    ];

    const len = Math.sqrt(stemDX * stemDX + stemDY * stemDY);
    const tang = [stemDX / len, stemDY / len];
    const normL = [-tang[1], tang[0]];
    const normR = [tang[1], -tang[0]];

    svgContent += `<line class="landing-quill-path landing-main-stem" x1="${topPoint[0]}" y1="${topPoint[1]}" x2="${basePoint[0]}" y2="${basePoint[1]}" filter="url(#strong-glow)" style="stroke-width: 4px;" />`;
    svgContent += `<line class="landing-quill-path landing-main-stem" x1="${topPoint[0]}" y1="${topPoint[1]}" x2="${basePoint[0]}" y2="${basePoint[1]}" style="stroke: #fff; stroke-width: 1.5px;" />`;

    for (let t = 0; t <= 1; t += 0.05) {
      nodes.push([...getStemPoint(t), 'spine']);
    }

    const innerNibBase = [basePoint[0] - tang[0] * 20, basePoint[1] - tang[1] * 20];
    const nibTopL = [basePoint[0] + normL[0] * 22 - tang[0] * 5, basePoint[1] + normL[1] * 22 - tang[1] * 5];
    const nibTopR = [basePoint[0] + normR[0] * 22 - tang[0] * 5, basePoint[1] + normR[1] * 22 - tang[1] * 5];

    const nibPath = `M ${innerNibBase[0]} ${innerNibBase[1]} L ${nibTopL[0]} ${nibTopL[1]} L ${nibTip[0]} ${nibTip[1]} L ${nibTopR[0]} ${nibTopR[1]} Z`;
    svgContent += `<path class="landing-quill-path landing-main-stem" d="${nibPath}" style="stroke-width: 2px;" filter="url(#subtle-glow)" />`;

    const rib1L = [basePoint[0] + normL[0] * 26 - tang[0] * 15, basePoint[1] + normL[1] * 26 - tang[1] * 15];
    const rib1R = [basePoint[0] + normR[0] * 26 - tang[0] * 15, basePoint[1] + normR[1] * 26 - tang[1] * 15];
    const rib2L = [basePoint[0] + normL[0] * 24 - tang[0] * 8, basePoint[1] + normL[1] * 24 - tang[1] * 8];
    const rib2R = [basePoint[0] + normR[0] * 24 - tang[0] * 8, basePoint[1] + normR[1] * 24 - tang[1] * 8];

    svgContent += `<line class="landing-quill-path landing-main-stem" x1="${rib1L[0]}" y1="${rib1L[1]}" x2="${rib1R[0]}" y2="${rib1R[1]}" style="stroke-width: 1.5px;" />`;
    svgContent += `<line class="landing-quill-path landing-main-stem" x1="${rib2L[0]}" y1="${rib2L[1]}" x2="${rib2R[0]}" y2="${rib2R[1]}" style="stroke-width: 1.5px;" />`;
    svgContent += `<line class="landing-quill-path landing-main-stem" x1="${innerNibBase[0]}" y1="${innerNibBase[1]}" x2="${nibTip[0]}" y2="${nibTip[1]}" />`;

    nodes.push([...nibTip, 'nib']);
    nodes.push([...basePoint, 'nib']);

    let barbPathStr = "";
    const numBarbs = 28;
    const barbPointsL = [];
    const barbPointsR = [];

    const getQuad = (t, p0, p1, p2) => {
      const u = 1 - t;
      return [
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
      ];
    };

    for (let i = 1; i < numBarbs; i++) {
      const t = i / numBarbs;
      const pt = getStemPoint(t);
      const envFactor = Math.pow(t, 1.2) * Math.pow(1 - t, 0.5) * 2.8;
      const maxEnvL = 110 * envFactor;
      const maxEnvR = 80 * envFactor;
      const sweepFactor = 0.4 + Math.pow(1 - t, 2.0) * 2.5;
      const sweepDir = [-tang[0] * sweepFactor, -tang[1] * sweepFactor];

      //   Left side quadratic bezier matching original  
      const startL = [pt[0], pt[1]];
      const endL = [
        pt[0] + normL[0] * maxEnvL + sweepDir[0] * maxEnvL,
        pt[1] + normL[1] * maxEnvL + sweepDir[1] * maxEnvL
      ];
      const cpL = [
        pt[0] + normL[0] * maxEnvL * 0.4 + sweepDir[0] * maxEnvL * 0.2,
        pt[1] + normL[1] * maxEnvL * 0.4 + sweepDir[1] * maxEnvL * 0.2
      ];

      barbPathStr += `<path class="landing-quill-path landing-barb" d="M ${startL[0]} ${startL[1]} Q ${cpL[0]} ${cpL[1]} ${endL[0]} ${endL[1]}" />`;

      const rowL = [];
      for (let j = 0.2; j <= 1.0; j += 0.2) {
        const bPt = getQuad(j, startL, cpL, endL);
        rowL.push(bPt);
        nodes.push([...bPt, 'barb']);
      }
      barbPointsL.push(rowL);

      //   Right side quadratic bezier matching original  
      const startR = [pt[0], pt[1]];
      const endR = [
        pt[0] + normR[0] * maxEnvR + sweepDir[0] * maxEnvR,
        pt[1] + normR[1] * maxEnvR + sweepDir[1] * maxEnvR
      ];
      const cpR = [
        pt[0] + normR[0] * maxEnvR * 0.4 + sweepDir[0] * maxEnvR * 0.2,
        pt[1] + normR[1] * maxEnvR * 0.4 + sweepDir[1] * maxEnvR * 0.2
      ];

      barbPathStr += `<path class="landing-quill-path landing-barb" d="M ${startR[0]} ${startR[1]} Q ${cpR[0]} ${cpR[1]} ${endR[0]} ${endR[1]}" />`;

      const rowR = [];
      for (let j = 0.2; j <= 1.0; j += 0.2) {
        const bPt = getQuad(j, startR, cpR, endR);
        rowR.push(bPt);
        nodes.push([...bPt, 'barb']);
      }
      barbPointsR.push(rowR);
    }
    svgContent += barbPathStr;


    let linkStr = "";
    const addPathLine = (p1, p2) => {
      linkStr += `<line class="landing-quill-path landing-network-link" x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" style="stroke:rgba(255, 107, 107, 0.4); stroke-width: 1.2px;" />`;
    };

    for (let arr of [barbPointsL, barbPointsR]) {
      for (let r = 0; r < arr.length - 1; r++) {
        let currRow = arr[r];
        let nextRow = arr[r + 1];
        for (let c = 0; c < currRow.length; c++) {
          if (c < nextRow.length) addPathLine(currRow[c], nextRow[c]);
          if (c < nextRow.length - 1) addPathLine(currRow[c], nextRow[c + 1]);
        }
      }
    }
    svgContent += linkStr;

    let nodeStr = "";
    nodes.forEach(node => {
      let type = node[2];
      let isHighlight = (Math.random() > 0.6);
      let isPulse = isHighlight && (Math.random() > 0.5);

      let radius = 2.5;
      if (type === 'nib') radius = 3.5;
      if (type === 'spine') radius = 3.0;
      if (isPulse) radius += 1.5;
      let classes = "landing-node";
      if (isHighlight) classes += " landing-highlight";
      if (isPulse) classes += " landing-pulse";

      const filterStr = isPulse ? `filter="url(#strong-glow)"` : "";
      nodeStr += `<circle class="${classes}" cx="${node[0]}" cy="${node[1]}" r="${radius}" ${filterStr} />`;
    });
    svgContent += nodeStr;
    svgRef.current.innerHTML = svgContent;
  }, []);

  //   External scroll observers  
  useEffect(() => {
    const reveals = document.querySelectorAll('.landing-reveal');
    const revealOptions = {
      threshold: 0.15,
      rootMargin: "0px 0px -50px 0px"
    };

    const revealOnScroll = new IntersectionObserver(function (entries, observer) {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('landing-active');
        observer.unobserve(entry.target);
      });
    }, revealOptions);

    reveals.forEach(reveal => revealOnScroll.observe(reveal));

    // Cleanup
    return () => reveals.forEach(reveal => revealOnScroll.unobserve(reveal));
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const navbar = document.querySelector('.landing-navbar');
      if (navbar) {
        if (window.scrollY > 50) navbar.classList.add('landing-scrolled');
        else navbar.classList.remove('landing-scrolled');
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleExploreClick = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className={`landing-page-root ${isExiting ? 'landing-exiting' : ''}`}>
      <canvas id="networkCanvas" ref={canvasRef}></canvas>

      <nav className="landing-navbar">
        <div className="landing-logo">Quill.</div>
        <div className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#showcase">How it Works</a>
          <button onClick={handleGetStarted} className="landing-nav-cta">Get Started</button>
        </div>
      </nav>

      <main>
        <section id="hero" className="landing-fullscreen-section">
          <div className="landing-container">
            <div className="landing-quill-container">
              <div className="landing-glow-effect" id="quillGlow"></div>
              <svg ref={svgRef} id="generatedQuillSvg" className="landing-quill-svg" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg"></svg>
            </div>
            <div className="landing-content-wrapper landing-reveal">
              <h1 className="landing-headline landing-reveal"> A notes app that<br />actually understands you,<br />like a Second Brain.</h1>
              <p className="landing-description landing-reveal" style={{ transitionDelay: '100ms' }}>
                Quill is a personal knowledge base where you write your thoughts, they get visualized, and you can instantly query them.
              </p>
              <button className="landing-cta-button landing-reveal" onClick={handleExploreClick} style={{ transitionDelay: '200ms' }}>
                See how it works
              </button>
            </div>
          </div>
        </section>

        <section id="features" className="landing-content-section">
          <div className="landing-section-container">
            <h2 className="landing-section-title landing-reveal">What it can do.</h2>
            <div className="landing-features-grid">
              <div className="landing-feature-card landing-reveal" style={{ transitionDelay: '100ms' }}>
                <div className="landing-feature-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                  </svg>
                </div>
                <h3 className="landing-feature-title">Semantic Search</h3>
                <p className="landing-feature-desc">You type a question, not a keyword. Quill searches your query and finds the notes that actually relate to it, then generates a conversational answer.</p>
              </div>
              <div className="landing-feature-card landing-reveal" style={{ transitionDelay: '200ms' }}>
                <div className="landing-feature-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="5" r="3"></circle>
                    <circle cx="5" cy="19" r="3"></circle>
                    <circle cx="19" cy="19" r="3"></circle>
                    <line x1="10.5" y1="7.5" x2="6.5" y2="16.5"></line>
                    <line x1="13.5" y1="7.5" x2="17.5" y2="16.5"></line>
                    <line x1="7.1" y1="19" x2="16.9" y2="19"></line>
                  </svg>
                </div>
                <h3 className="landing-feature-title">Knowledge Graph</h3>
                <p className="landing-feature-desc">Visualize your second brain. Notes organically link together, producing a fully interactive force-directed 2D map of your understanding.</p>
              </div>
              <div className="landing-feature-card landing-reveal" style={{ transitionDelay: '300ms' }}>
                <div className="landing-feature-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                </div>
                <h3 className="landing-feature-title">Instant Summaries</h3>
                <p className="landing-feature-desc">Long note you haven't opened in weeks? Hit summarize and get the gist back in a few lines without re-reading the whole thing.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="showcase" className="landing-content-section landing-alternate-bg">
          <div className="landing-section-container landing-split-layout">
            <div className="landing-split-text landing-reveal">
              <h2 className="landing-section-title">How it actually works.</h2>
              <p className="landing-description">
                Quill isn't just a basic markdown editor. It's a full-stack architecture designed for seamless retrieval.
              </p>
              <p className="landing-description">
                When you search, it finds the closest matching notes by meaning, not by word, and writes a response from them.
              </p>
              <a href="https://github.com" target="_blank" rel="noreferrer" className="landing-inline-link">View the code on GitHub →</a>
            </div>
            <div className="landing-split-visual landing-reveal" style={{ transitionDelay: '200ms' }}>
              <div className="landing-mockup-frame">
                <div className="landing-mockup-header"><span className="landing-dot"></span><span className="landing-dot"></span><span className="landing-dot"></span></div>
                <div className="landing-mockup-body">
                  <div className="landing-mock-line landing-title-line"></div>
                  <div className="landing-mock-line"></div>
                  <div className="landing-mock-line landing-short-line"></div>
                  <br />
                  <div className="landing-mock-line"></div>
                  <div className="landing-mock-line"></div>
                  <div className="landing-mock-node-link">
                    <span className="landing-mock-dot"></span> Ask: <span className="landing-mock-hl" style={{ color: 'var(--lp-text-primary)', fontWeight: 400, marginLeft: '5px' }}>What was my plan for the AI microservice?</span>
                  </div>
                  <div className="landing-mock-node-link landing-assistant-reply" style={{ marginTop: '1rem' }}>
                    <span className="landing-mock-hl">Assistant: </span> Using your note "Qdrant Integration", your plan was to deploy a FastAPI service on port 8001...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-section-container landing-footer-content">
          <div className="landing-footer-brand">
            <div className="landing-logo">Quill.</div>
            <p>Digitally thought, naturally.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
