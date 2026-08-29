import React, { useState, useEffect, useMemo, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useAllNotesQuery } from '../../hooks/useNotesQuery';
import { useUIStore } from '../../store/useUIStore';
import { forceX, forceY, forceCollide } from 'd3-force';
import { motion, AnimatePresence } from 'framer-motion';
import { MdLocalOffer, MdClose, MdCheck } from 'react-icons/md';

const Graph = () => {
  const fgRef = useRef();
  const { isSidebarOpen } = useUIStore();
  const { data: allNotes = [] } = useAllNotesQuery();
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [animTick, setAnimTick] = useState(0);
  const filterDropdownRef = useRef(null);

  // Close filter dropdown on outside click or touch
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const [dimensions, setDimensions] = useState(() => {
    if (typeof window === 'undefined') return { width: 800, height: 600 };
    const isMobile = window.innerWidth < 640;
    const sidebarWidth = !isMobile ? (isSidebarOpen ? 220 : 64) : 0;
    return {
      width: window.innerWidth - sidebarWidth,
      height: window.innerHeight,
    };
  });

  // Track the actual visible container size efficiently
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 640;
      const sidebarWidth = !isMobile ? (isSidebarOpen ? 220 : 64) : 0;
      setDimensions({
        width: window.innerWidth - sidebarWidth,
        height: window.innerHeight,
      });
    };

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarOpen]);

  const nodeAnimRef = useRef({});
  const linkAnimRef = useRef({});

  // Tune d3 force simulation dynamically based on screen dimensions
  useEffect(() => {
    if (!fgRef.current) return;
    const isMobile = dimensions.width < 640;

    // Stronger charge so nodes visibly shove each other at close range
    // (charge is inverse-square: dominant up close, falls off fast at distance)
    fgRef.current.d3Force('charge')?.strength(isMobile ? -40 : -50);

    // Link strength 1.0 keeps clusters coherent against the stronger charge —
    // linked nodes resist pulling apart without affecting isolated nodes
    fgRef.current.d3Force('link')?.distance(isMobile ? 45 : 50).strength(1.0);

    // Slightly lifted gravity to anchor isolated (unlinked) nodes that have
    // nothing to hold them in place against repulsion from the cluster
    fgRef.current.d3Force('x', forceX(dimensions.width / 2).strength(isMobile ? 0.03 : 0.015));
    fgRef.current.d3Force('y', forceY(dimensions.height / 2).strength(isMobile ? 0.03 : 0.015));

    // Short-range hard collision radius — gives the satisfying bounce/shove when
    // dragging nodes into each other; complements charge at very close distances
    fgRef.current.d3Force('collide', forceCollide(16));

    fgRef.current.d3Force('boundary', null);

    fgRef.current.d3ReheatSimulation();
  }, [dimensions.width, dimensions.height]);


  const lerp = (a, b, t) => a + (b - a) * t;
  const LERP_FACTOR = 0.5;

  const uniqueTags = useMemo(() => {
    const allTags = allNotes.flatMap(note => note.tags);
    return [...new Set(allTags)];
  }, [allNotes]);

  const graphData = useMemo(() => {
    // calculate tag frequencies to find connecting tags
    const tagFrequencies = allNotes.flatMap(note => note.tags).reduce((acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {});

    const connectingTagsSet = new Set(Object.keys(tagFrequencies).filter(tag => tagFrequencies[tag] > 1));

    // transform notes into graph nodes
    const nodes = allNotes.map(note => ({
      id: note._id,
      name: note.title,
      tags: note.tags,
      connectingTags: note.tags.filter(tag => connectingTagsSet.has(tag)),
    }));

    // generate links based on shared tags
    const tagMap = {};
    allNotes.forEach(note => {
      note.tags.forEach(tag => {
        if (connectingTagsSet.has(tag)) { // only consider connecting tags for links
          if (!tagMap[tag]) {
            tagMap[tag] = [];
          }
          tagMap[tag].push(note._id);
        }
      });
    });

    const links = [];
    const linkSet = new Set(); // set to prevent duplicate links

    for (const tag in tagMap) {
      const noteIds = tagMap[tag];
      if (noteIds.length > 1) {
        for (let i = 0; i < noteIds.length; i++) {
          for (let j = i + 1; j < noteIds.length; j++) {
            const source = noteIds[i];
            const target = noteIds[j];
            //unique key for each link pair to avoid duplicates
            const linkKey = source < target ? `${source}-${target}` : `${target}-${source}`;

            if (!linkSet.has(linkKey)) {
              links.push({ source, target });
              linkSet.add(linkKey);
            }
          }
        }
      }
    }

    return { nodes, links };
  }, [allNotes]);

  const handleTagClick = (tag) => {
    setSelectedTag(tag);
  };

  const handleNodeHover = (node) => {
    if (selectedTag) return;
    if (hoveredNode !== node) {
      setHoveredNode(node);
    }
  };

  const highlightedNodes = useMemo(() => {
    if (selectedTag) {
      const set = new Set();
      graphData.nodes.forEach(node => {
        if (node.tags.includes(selectedTag)) set.add(node);
      });
      return set;
    }
    if (hoveredNode) {
      const set = new Set();
      set.add(hoveredNode);
      graphData.links.forEach(link => {
        if (link.source === hoveredNode || link.target === hoveredNode) {
          set.add(link.source);
          set.add(link.target);
        }
      });
      return set;
    }
    return new Set();
  }, [selectedTag, hoveredNode, graphData]);

  const highlightedLinks = useMemo(() => {
    if (selectedTag) {
      const set = new Set();
      graphData.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        const sourceNode = graphData.nodes.find(n => n.id === sourceId);
        const targetNode = graphData.nodes.find(n => n.id === targetId);
        if (sourceNode && targetNode && sourceNode.tags.includes(selectedTag) && targetNode.tags.includes(selectedTag)) {
          set.add(link);
        }
      });
      return set;
    }
    if (hoveredNode) {
      const set = new Set();
      graphData.links.forEach(link => {
        if (link.source === hoveredNode || link.target === hoveredNode) {
          set.add(link);
        }
      });
      return set;
    }
    return new Set();
  }, [selectedTag, hoveredNode, graphData]);

  // Temporary frame pump to ensure canvas redraws smoothly during lerp transitions
  // even if the force graph physics engine has settled and stopped voluntarily redrawing.
  useEffect(() => {
    let frameCount = 0;
    let animationFrameId;

    const animate = () => {
      frameCount++;
      setAnimTick(t => t + 1); // trigger re-render

      if (frameCount < 15) { // ~250ms at 60fps
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrameId);
  }, [highlightedNodes, hoveredNode]);

  const isMobile = dimensions.width < 640;
  const navbarMargin = isMobile ? '-60px' : '-72px';

  return (
    <div className={'bg-[#202124b5]'} style={{ width: '100%', height: dimensions.height, marginTop: navbarMargin, overflow: 'hidden', position: 'relative', cursor: hoveredNode ? 'pointer' : 'default' }}>
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        extraRenderTick={animTick}
        graphData={graphData}
        nodeLabel={node => node.connectingTags.join(', ')}
        linkCanvasObjectMode={() => 'replace'}
        linkCanvasObject={(link, ctx) => {
          const hasHighlight = highlightedNodes.size > 0;
          const isHighlightedLink = highlightedLinks.has(link);
          const linkKey = `${link.source?.id ?? link.source}-${link.target?.id ?? link.target}`;

          // animate link opacity — snap back instantly when hover ends, smooth fade when dimming
          if (!linkAnimRef.current[linkKey]) linkAnimRef.current[linkKey] = { opacity: 0.2 };
          const targetLinkOpacity = hasHighlight ? (isHighlightedLink ? 0.8 : 0.02) : 0.2;
          if (!hasHighlight) {
            linkAnimRef.current[linkKey].opacity = 0.2;
          } else {
            linkAnimRef.current[linkKey].opacity = lerp(linkAnimRef.current[linkKey].opacity, targetLinkOpacity, LERP_FACTOR);
          }
          const op = linkAnimRef.current[linkKey].opacity;

          const src = link.source;
          const tgt = link.target;
          if (!src || !tgt || src.x == null || tgt.x == null) return;

          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(tgt.x, tgt.y);
          ctx.strokeStyle = isHighlightedLink ? `rgba(232,93,86,${op})` : `rgba(255,255,255,${op})`;
          ctx.lineWidth = isHighlightedLink ? 3.5 : 0.8;
          ctx.stroke();
        }}
        onNodeHover={handleNodeHover}
        onBackgroundClick={() => {
          if (selectedTag) handleTagClick(null);

        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 12, 0, 2 * Math.PI, false);
          ctx.fill();
        }}
        nodeCanvasObject={(node, ctx) => {
          const hasHighlight = highlightedNodes.size > 0;
          const isHighlighted = highlightedNodes.has(node);
          const isHovered = hoveredNode === node;

          // init animated state for this node
          if (!nodeAnimRef.current[node.id]) {
            nodeAnimRef.current[node.id] = { opacity: 1.0, radius: 9 };
          }
          const anim = nodeAnimRef.current[node.id];

          // target values
          const targetOpacity = hasHighlight ? (isHighlighted ? 1.0 : 0.08) : 1.0;
          const targetRadius = isHovered ? 12 : 9;

          // When returning to normal: snap opacity instantly so no node "lags behind"
          // When dimming: lerp smoothly for the spotlight effect
          if (!hasHighlight) {
            anim.opacity = 1.0;
          } else {
            anim.opacity = lerp(anim.opacity, targetOpacity, LERP_FACTOR);
          }
          anim.radius = lerp(anim.radius, targetRadius, LERP_FACTOR);

          // draw node circle
          ctx.beginPath();
          ctx.arc(node.x, node.y, anim.radius, 0, 2 * Math.PI, false);

          if (isHovered) {
            ctx.fillStyle = `rgba(232, 93, 86, ${anim.opacity})`;
          } else {
            ctx.fillStyle = `rgba(248, 236, 220, ${anim.opacity})`;
          }
          ctx.fill();

          // label below circle
          const fontSize = 5;
          ctx.font = `${fontSize}px Sans-Serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const textAlpha = hasHighlight
            ? isHovered ? anim.opacity : isHighlighted ? anim.opacity * 0.85 : anim.opacity * 0.5
            : 0.8;
          ctx.fillStyle = `rgba(255, 255, 255, ${textAlpha})`;
          ctx.fillText(node.name, node.x, node.y + anim.radius + 2);
        }}
      />

      {/* Minimal Tag Filter Control */}
      <div
        ref={filterDropdownRef}
        className="absolute top-[80px] md:top-[92px] right-4 sm:right-6 z-20"
      >
        {/* Trigger Button / Morphing Pill */}
        <motion.div
          layout
          transition={{ type: 'spring', damping: 30, stiffness: 750, mass: 0.3 }}
          className={`h-10 rounded-full flex items-center border shadow-lg backdrop-blur-md overflow-hidden ${
            selectedTag
              ? 'bg-[#202124]/90 border-[#e85d56]/60 text-white'
              : isDropdownOpen
              ? 'bg-[#e85d56] border-[#e85d56] text-white w-10 justify-center'
              : 'bg-[#202124]/80 hover:bg-[#2c2d30] border-white/15 text-stone-300 hover:text-white w-10 justify-center'
          }`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {!selectedTag ? (
              <motion.button
                key="circle-icon-btn"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.08, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => setIsDropdownOpen(prev => !prev)}
                title="Filter by Tag"
                className="w-10 h-10 flex items-center justify-center cursor-pointer shrink-0"
              >
                <MdLocalOffer className="w-4 h-4" />
              </motion.button>
            ) : (
              <motion.div
                key="pill-content-box"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.09, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-2 text-sm font-medium whitespace-nowrap pl-3.5 pr-2 h-full"
              >
                <button
                  onClick={() => setIsDropdownOpen(prev => !prev)}
                  className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity"
                >
                  <span className="w-2 h-2 rounded-full bg-[#e85d56] shrink-0" />
                  <span className="max-w-[140px] truncate">#{selectedTag}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTagClick(null);
                  }}
                  title="Clear Filter"
                  className="p-1 hover:bg-white/10 rounded-full text-stone-400 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <MdClose className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Popover Menu with smooth sliding unfolding/tucking */}
        <AnimatePresence>
          {isDropdownOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -6 }}
              transition={{ type: 'spring', damping: 28, stiffness: 500, mass: 0.45 }}
              style={{ transformOrigin: 'top right' }}
              className="absolute top-12 right-0 min-w-[130px] max-w-[220px] w-max bg-[#202124]/95 backdrop-blur-xl border border-white/15 rounded-2xl p-1.5 shadow-2xl z-30 flex flex-col"
            >
              <div className="flex flex-col gap-1 max-h-[min(50vh,300px)] overflow-y-auto editor-scrollbar">
                {uniqueTags.length === 0 ? (
                  <div className="py-3 px-4 text-center text-xs text-stone-500">
                    No tags
                  </div>
                ) : (
                  uniqueTags.map(tag => {
                    const isSelected = selectedTag === tag;
                    return (
                      <button
                        key={tag}
                        onClick={() => {
                          handleTagClick(isSelected ? null : tag);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-sm font-medium rounded-xl flex items-center justify-between gap-3 transition-all cursor-pointer text-left ${
                          isSelected
                            ? 'bg-[#e85d56] text-white shadow-sm font-semibold'
                            : 'text-stone-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate">#{tag}</span>
                        {isSelected && <MdCheck className="w-4 h-4 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Graph;
