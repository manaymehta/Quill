import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../../utils/axiosInstance';
import { useGraphNotesQuery } from '../../hooks/useNotesQuery';
import { useUIStore } from '../../store/useUIStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useToastStore } from '../../store/useToastStore';
import { useDeleteNoteMutation, useArchiveNoteMutation } from '../../hooks/useNoteMutations';
import { forceX, forceY, forceCollide } from 'd3-force';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MdLocalOffer, MdClose, MdCheck, MdOutlineArchive, 
  MdOutlineUnarchive, MdEdit, MdDelete 
} from 'react-icons/md';

const shutterMenuVariants = {
  closed: {
    opacity: 0,
    scaleY: 0.92,
    y: -6,
    transition: {
      duration: 0.14,
      ease: [0.16, 1, 0.3, 1],
    },
  },
  open: {
    opacity: 1,
    scaleY: 1,
    y: 0,
    transition: {
      duration: 0.16,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

const shutterItemVariants = {
  closed: {
    opacity: 0,
    y: -4,
    transition: {
      duration: 0.14,
      ease: [0.16, 1, 0.3, 1],
    },
  },
  open: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.16,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

const Graph = () => {
  const fgRef = useRef();
  const containerRef = useRef(null);
  const queryClient = useQueryClient();
  const { openTab } = useTabsStore();
  const { showToast } = useToastStore();
  const { activeDropdownNoteId, setActiveDropdownNoteId } = useFoldersStore();

  const deleteNoteMutation = useDeleteNoteMutation();
  const archiveNoteMutation = useArchiveNoteMutation();

  const [graphMenuCoords, setGraphMenuCoords] = useState(null);
  const [selectedMenuNode, setSelectedMenuNode] = useState(null);
  const hoveredNodeRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const touchStartPosRef = useRef({ x: 0, y: 0 });
  const isOpeningNodeRef = useRef(new Set());
  const isLongPressJustEndedRef = useRef(false);

  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: graphNotes = [] } = useGraphNotesQuery(includeArchived);
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

  // Close node context menu on outside click or contextmenu
  useEffect(() => {
    if (!activeDropdownNoteId) return;
    const handleOutside = (e) => {
      if (isLongPressJustEndedRef.current) return;
      if (e.target.closest('.no-card-click')) return;
      setActiveDropdownNoteId(null);
    };
    document.addEventListener('click', handleOutside);
    document.addEventListener('contextmenu', handleOutside);
    return () => {
      document.removeEventListener('click', handleOutside);
      document.removeEventListener('contextmenu', handleOutside);
    };
  }, [activeDropdownNoteId, setActiveDropdownNoteId]);

  // Cleanup mobile long-press timer and reset dropdown on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      useFoldersStore.getState().setActiveDropdownNoteId(null);
    };
  }, []);

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
    const allTags = graphNotes.flatMap(note => note.tags || []);
    return [...new Set(allTags)];
  }, [graphNotes]);

  const activeSelectedTag = (selectedTag && uniqueTags.includes(selectedTag)) ? selectedTag : null;

  const graphData = useMemo(() => {
    // calculate tag frequencies to find connecting tags
    const tagFrequencies = graphNotes.flatMap(note => note.tags || []).reduce((acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {});

    const connectingTagsSet = new Set(Object.keys(tagFrequencies).filter(tag => tagFrequencies[tag] > 1));

    // transform notes into graph nodes
    const nodes = graphNotes.map(note => ({
      id: note._id,
      name: note.title,
      tags: note.tags || [],
      isArchived: Boolean(note.isArchived),
      connectingTags: (note.tags || []).filter(tag => connectingTagsSet.has(tag)),
    }));

    // generate links based on shared tags
    const tagMap = {};
    graphNotes.forEach(note => {
      (note.tags || []).forEach(tag => {
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
  }, [graphNotes]);

  const handleTagClick = (tag) => {
    setSelectedTag(tag);
  };

  const handleNodeHover = (node) => {
    hoveredNodeRef.current = node;
    if (activeSelectedTag) return;
    if (hoveredNode !== node) {
      setHoveredNode(node);
    }
  };

  const handleOpenInEditor = async (node) => {
    setActiveDropdownNoteId(null);

    // Fast-path: check if note is already open in an active tab
    const existingTab = useTabsStore.getState().openTabs.find((t) => t._id === node.id);
    if (existingTab) {
      openTab(existingTab);
      return;
    }

    // 1. Search TanStack query cache for full note
    const noteQueries = queryClient.getQueriesData({ queryKey: ['notes'] });
    let fullNote = null;
    for (const [, data] of noteQueries) {
      if (Array.isArray(data)) {
        const found = data.find((n) => n._id === node.id);
        if (found && (found.content !== undefined || found.checklist !== undefined)) {
          fullNote = found;
          break;
        }
      }
    }

    if (fullNote) {
      openTab(fullNote);
      return;
    }

    // Guard against duplicate in-flight network requests on rapid clicks
    if (isOpeningNodeRef.current.has(node.id)) return;
    isOpeningNodeRef.current.add(node.id);

    // 2. Fallback: fetch from GET /get-note/:nodeId
    try {
      const res = await axiosInstance.get(`/get-note/${node.id}`);
      if (res.data && res.data.note) {
        openTab(res.data.note);
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to open note", "error");
    } finally {
      isOpeningNodeRef.current.delete(node.id);
    }
  };

  const handleArchiveNote = (node) => {
    setActiveDropdownNoteId(null);
    archiveNoteMutation.mutate({ noteId: node.id, isArchived: !node.isArchived });
  };

  const handleDeleteNote = (node) => {
    setActiveDropdownNoteId(null);
    if (useTabsStore.getState().isTabOpen(node.id)) {
      showToast({
        message: "Close the editor tab for this note before deleting.",
        type: "warning",
      });
      return;
    }
    deleteNoteMutation.mutate(node.id);
  };

  // Mobile touch-and-hold (long-press) and desktop right-click on graph nodes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerDown = (e) => {
      // Reset the long-press guard on ANY pointer down (touch or mouse) so outside-click works reliably
      isLongPressJustEndedRef.current = false;

      // Mouse right-click is handled natively by container contextmenu listener; only listen for touch/pen
      if (e.pointerType === 'mouse') return;

      touchStartPosRef.current = { x: e.clientX, y: e.clientY };

      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        if (!fgRef.current?.graph2ScreenCoords) return;

        const canvas = container.querySelector('canvas') || container;
        const rect = canvas.getBoundingClientRect();
        const touchCanvasX = touchStartPosRef.current.x - rect.left;
        const touchCanvasY = touchStartPosRef.current.y - rect.top;

        // Find target node whose projected screen position is closest to touch point
        let closestNode = null;
        let minDistance = Infinity;
        const HIT_RADIUS = 28; // Comfortable touch target radius in screen pixels

        for (const node of graphData.nodes) {
          if (node.x == null || node.y == null) continue;
          const screenCoords = fgRef.current.graph2ScreenCoords(node.x, node.y);
          if (!screenCoords) continue;
          const dist = Math.hypot(screenCoords.x - touchCanvasX, screenCoords.y - touchCanvasY);
          if (dist <= HIT_RADIUS && dist < minDistance) {
            minDistance = dist;
            closestNode = node;
          }
        }

        if (closestNode) {
          flushSync(() => {
            setGraphMenuCoords({ x: touchStartPosRef.current.x, y: touchStartPosRef.current.y });
            setSelectedMenuNode(closestNode);
            setActiveDropdownNoteId(closestNode.id);
          });
          // Mark that a long-press just opened the menu. Both onBackgroundClick (fired by
          // ForceGraph2D's internal pointerup listener) and the document 'click' outside-listener
          // will see this flag and bail out. The flag is reset on the NEXT pointerdown — the
          // user's next actual touch — instead of an arbitrary timer, matching NoteCard's philosophy.
          isLongPressJustEndedRef.current = true;
        }
      }, 500);
    };

    const handlePointerMove = (e) => {
      if (!longPressTimerRef.current) return;
      const dx = Math.abs(e.clientX - touchStartPosRef.current.x);
      const dy = Math.abs(e.clientY - touchStartPosRef.current.y);
      // Abort pending long-press if finger moves more than 10px (user is dragging/panning, not holding)
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const handlePointerUp = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    // Native desktop right-click on graph canvas:
    // Only intercepts when clicking on a node. On empty canvas, default browser context menu appears naturally!
    const handleContextMenu = (e) => {
      if (e.target.closest('.no-card-click')) return;
      if (!fgRef.current?.graph2ScreenCoords) return;

      const canvas = container.querySelector('canvas') || container;
      const rect = canvas.getBoundingClientRect();
      const clickCanvasX = e.clientX - rect.left;
      const clickCanvasY = e.clientY - rect.top;

      let closestNode = null;
      let minDistance = Infinity;
      const HIT_RADIUS = 28;

      for (const node of graphData.nodes) {
        if (node.x == null || node.y == null) continue;
        const screenCoords = fgRef.current.graph2ScreenCoords(node.x, node.y);
        if (!screenCoords) continue;
        const dist = Math.hypot(screenCoords.x - clickCanvasX, screenCoords.y - clickCanvasY);
        if (dist <= HIT_RADIUS && dist < minDistance) {
          minDistance = dist;
          closestNode = node;
        }
      }

      if (closestNode) {
        e.preventDefault();
        e.stopPropagation();
        setGraphMenuCoords({ x: e.clientX, y: e.clientY });
        setSelectedMenuNode(closestNode);
        setActiveDropdownNoteId(closestNode.id);
      } else {
        // Empty canvas right-click: close dropdown if open, but do NOT preventDefault
        // This preserves native browser contextmenu everywhere by default.
        if (useFoldersStore.getState().activeDropdownNoteId) {
          setActiveDropdownNoteId(null);
        }
      }
    };

    container.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerUp, { passive: true });
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      container.removeEventListener('contextmenu', handleContextMenu);
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, [graphData.nodes, setActiveDropdownNoteId]);

  const activeNodeInGraph = selectedMenuNode ? graphData.nodes.find((n) => n.id === selectedMenuNode.id) : null;
  const currentMenuNode = activeNodeInGraph || selectedMenuNode;
  const isMenuOpen = Boolean(activeDropdownNoteId && currentMenuNode && activeDropdownNoteId === currentMenuNode.id);

  const menuTargetNode = (graphMenuCoords && activeNodeInGraph) ? activeNodeInGraph : null;
  const activeHoveredNode = menuTargetNode || ((hoveredNode && graphData.nodes.some(n => n.id === hoveredNode.id)) ? hoveredNode : null);

  const menuStyle = useMemo(() => {
    if (!graphMenuCoords) return null;

    const menuWidth = 160;
    const menuHeight = 155;
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : dimensions.width;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : dimensions.height;
    const isMobile = screenWidth < 640;
    const bottomMargin = isMobile ? 76 : 16;

    let finalX = Math.round(graphMenuCoords.x);
    if (finalX + menuWidth > screenWidth - 8) {
      finalX = Math.max(8, screenWidth - menuWidth - 8);
    }
    finalX = Math.max(8, finalX);

    let finalY = Math.round(graphMenuCoords.y);
    if (finalY + menuHeight > screenHeight - bottomMargin) {
      finalY = Math.max(8, Math.round(graphMenuCoords.y) - menuHeight - 12);
    }
    finalY = Math.max(8, finalY);

    return {
      position: 'fixed',
      left: `${finalX}px`,
      top: `${finalY}px`,
      zIndex: 9999,
      transformOrigin: 'top',
      willChange: 'transform, opacity',
      backfaceVisibility: 'hidden',
    };
  }, [graphMenuCoords, dimensions.width, dimensions.height]);

  const nodesById = useMemo(() => {
    const map = new Map();
    for (const node of graphData.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [graphData.nodes]);

  const highlightedNodes = useMemo(() => {
    if (activeSelectedTag) {
      const set = new Set();
      graphData.nodes.forEach(node => {
        if (node.tags.includes(activeSelectedTag)) set.add(node);
      });
      return set;
    }
    if (activeHoveredNode) {
      const set = new Set();
      set.add(activeHoveredNode);
      graphData.links.forEach(link => {
        const sId = link.source?.id ?? link.source;
        const tId = link.target?.id ?? link.target;
        if (sId === activeHoveredNode.id || tId === activeHoveredNode.id) {
          const sNode = typeof link.source === 'object' ? link.source : nodesById.get(sId);
          const tNode = typeof link.target === 'object' ? link.target : nodesById.get(tId);
          if (sNode) set.add(sNode);
          if (tNode) set.add(tNode);
        }
      });
      return set;
    }
    return new Set();
  }, [activeSelectedTag, activeHoveredNode, graphData, nodesById]);

  const highlightedLinks = useMemo(() => {
    if (activeSelectedTag) {
      const set = new Set();
      graphData.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        const sourceNode = nodesById.get(sourceId);
        const targetNode = nodesById.get(targetId);
        if (sourceNode && targetNode && sourceNode.tags.includes(activeSelectedTag) && targetNode.tags.includes(activeSelectedTag)) {
          set.add(link);
        }
      });
      return set;
    }
    if (activeHoveredNode) {
      const set = new Set();
      graphData.links.forEach(link => {
        const sId = link.source?.id ?? link.source;
        const tId = link.target?.id ?? link.target;
        if (sId === activeHoveredNode.id || tId === activeHoveredNode.id) {
          set.add(link);
        }
      });
      return set;
    }
    return new Set();
  }, [activeSelectedTag, activeHoveredNode, graphData.links, nodesById]);

  // Prune stale animation records when graph data changes to prevent memory leaks
  useEffect(() => {
    const validNodeIds = new Set(graphData.nodes.map(n => String(n.id)));
    for (const key of Object.keys(nodeAnimRef.current)) {
      if (!validNodeIds.has(String(key))) {
        delete nodeAnimRef.current[key];
      }
    }

    const validLinkKeys = new Set(
      graphData.links.map(l => {
        const s = l.source?.id ?? l.source;
        const t = l.target?.id ?? l.target;
        return `${s}-${t}`;
      })
    );
    for (const key of Object.keys(linkAnimRef.current)) {
      if (!validLinkKeys.has(key)) {
        delete linkAnimRef.current[key];
      }
    }
  }, [graphData]);

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
  }, [highlightedNodes, activeHoveredNode]);

  const isMobile = dimensions.width < 640;
  const navbarMargin = isMobile ? '-60px' : '-72px';

  return (
    <div
      ref={containerRef}
      className={'bg-[#202124b5]'}
      style={{ width: '100%', height: dimensions.height, marginTop: navbarMargin, overflow: 'hidden', position: 'relative', cursor: activeHoveredNode ? 'pointer' : 'default' }}
    >
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        extraRenderTick={animTick}
        graphData={graphData}
        nodeLabel={node => {
          const tags = (node.connectingTags && node.connectingTags.length > 0)
            ? node.connectingTags
            : (node.tags || []);
          const tagsStr = tags.join(', ');
          if (node.isArchived) {
            return tagsStr ? `${tagsStr} (Archived)` : 'Archived';
          }
          return tagsStr;
        }}
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
        // Canvas interactions dismiss the menu by clearing activeDropdownNoteId.
        // Coordinate cleanup (graphMenuCoords, selectedMenuNode) is deferred to
        // AnimatePresence.onExitComplete to allow the shutter closing animation to finish.
        onZoom={() => {
          if (useFoldersStore.getState().activeDropdownNoteId) {
            queueMicrotask(() => {
              if (useFoldersStore.getState().activeDropdownNoteId) {
                setActiveDropdownNoteId(null);
              }
            });
          }
        }}
        onNodeHover={handleNodeHover}
        onNodeClick={() => {
          // Left click does nothing (per user requirement)
        }}
        onNodeDrag={() => {
          if (isLongPressJustEndedRef.current) return;
          if (activeDropdownNoteId) {
            setActiveDropdownNoteId(null);
          }
        }}
        onBackgroundClick={() => {
          if (isLongPressJustEndedRef.current) return;
          setActiveDropdownNoteId(null);
          if (activeSelectedTag) handleTagClick(null);
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
          const isHovered = activeHoveredNode === node;

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
          if (activeDropdownNoteId !== node.id) {
            ctx.fillStyle = `rgba(255, 255, 255, ${textAlpha})`;
            ctx.fillText(node.name, node.x, node.y + anim.radius + 2);
          }
        }}
      />

      {/* Minimal Controls Container: Dynamic Pills & Tag Filter */}
      <div className="absolute top-[80px] md:top-[92px] right-4 sm:right-6 z-20 flex items-center gap-2.5">
        {/* Dynamic Archived Pill (shows only when includeArchived is active) */}
        <AnimatePresence>
          {includeArchived && (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.85, x: 10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.85, x: 10 }}
              transition={{ type: 'spring', damping: 30, stiffness: 750, mass: 0.3 }}
              className="h-10 rounded-full flex items-center border shadow-lg backdrop-blur-md overflow-hidden bg-[#202124]/90 border-[#e85d56]/60 text-white pl-3.5 pr-2 gap-2 text-sm font-medium whitespace-nowrap"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#e85d56] shrink-0" />
                <span>Archived</span>
              </div>
              <button
                type="button"
                onClick={() => setIncludeArchived(false)}
                title="Hide Archived Notes"
                className="p-1 hover:bg-white/10 rounded-full text-stone-400 hover:text-white transition-colors cursor-pointer shrink-0"
              >
                <MdClose className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Minimal Tag Filter Control */}
        <div
          ref={filterDropdownRef}
          className="relative"
        >
          {/* Trigger Button / Morphing Pill */}
          <motion.div
            layout
            transition={{ type: 'spring', damping: 30, stiffness: 750, mass: 0.3 }}
            className={`h-10 rounded-full flex items-center border shadow-lg backdrop-blur-md overflow-hidden ${
              activeSelectedTag
                ? 'bg-[#202124]/90 border-[#e85d56]/60 text-white'
                : isDropdownOpen
                ? 'bg-[#e85d56] border-[#e85d56] text-white w-10 justify-center'
                : 'bg-[#202124]/80 hover:bg-[#2c2d30] border-white/15 text-stone-300 hover:text-white w-10 justify-center'
            }`}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {!activeSelectedTag ? (
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
                    <span className="max-w-[140px] truncate">#{activeSelectedTag}</span>
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
                className="absolute top-12 right-0 min-w-[160px] max-w-[240px] w-max max-h-[calc(100vh-140px)] md:max-h-[calc(100vh-150px)] bg-[#202124]/95 backdrop-blur-xl border border-white/15 rounded-2xl p-1.5 shadow-2xl z-30 flex flex-col"
              >
                {/* Archive Option Toggle */}
                <button
                  type="button"
                  onClick={() => setIncludeArchived(prev => !prev)}
                  className={`shrink-0 w-full px-3 py-2 text-sm font-medium rounded-xl flex items-center justify-between gap-3 transition-all cursor-pointer text-left ${
                    includeArchived
                      ? 'bg-[#e85d56]/15 text-[#e85d56] font-semibold border border-[#e85d56]/30'
                      : 'text-stone-300 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MdOutlineArchive className={`w-4 h-4 shrink-0 ${includeArchived ? 'text-[#e85d56]' : 'text-stone-400'}`} />
                    <span>Archived</span>
                  </div>
                  {includeArchived && <MdCheck className="w-4 h-4 shrink-0 text-[#e85d56]" />}
                </button>

                <div className="shrink-0 my-1 border-t border-white/10" />

                <div className="flex-1 min-h-0 flex flex-col gap-1 overflow-y-auto editor-scrollbar">
                  {uniqueTags.length === 0 ? (
                    <div className="py-3 px-4 text-center text-xs text-stone-500">
                      No tags
                    </div>
                  ) : (
                    uniqueTags.map(tag => {
                      const isSelected = activeSelectedTag === tag;
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

      {(isMenuOpen || graphMenuCoords) && graphMenuCoords && currentMenuNode && createPortal(
        <AnimatePresence onExitComplete={() => { setGraphMenuCoords(null); setSelectedMenuNode(null); }}>
          {isMenuOpen && (
            <motion.div
              key="graph-context-menu"
              initial="closed"
              animate="open"
              exit="closed"
              variants={shutterMenuVariants}
              style={menuStyle}
              className="bg-[#1e1e20] p-1 rounded-2xl shadow-2xl flex flex-col gap-[5px] w-[160px] min-w-[160px] max-w-[160px] no-card-click select-none border-0 outline-none overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Node name on top */}
              <motion.div
                variants={shutterItemVariants}
                title={currentMenuNode.name || 'Untitled Note'}
                className="px-2 pt-1 pb-0.5 text-[13px] font-medium text-stone-400 truncate w-full"
              >
                {currentMenuNode.name || 'Untitled Note'}
              </motion.div>

              <motion.div variants={shutterItemVariants} className="h-[1px] bg-white/[0.05] -my-[2px] mx-1" />

              <motion.button
                variants={shutterItemVariants}
                type="button"
                onClick={() => handleOpenInEditor(currentMenuNode)}
                className="flex items-center justify-between gap-3 px-2 py-[6px] rounded-xl cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-full hover:bg-white/[0.15] hover:text-white text-stone-300"
              >
                <span>Open Note</span>
                <MdEdit size={14} className="shrink-0" />
              </motion.button>

              <motion.button
                variants={shutterItemVariants}
                type="button"
                onClick={() => handleArchiveNote(currentMenuNode)}
                className="flex items-center justify-between gap-3 px-2 py-[6px] rounded-xl cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-full hover:bg-white/[0.15] hover:text-white text-stone-300"
              >
                <span>{currentMenuNode.isArchived ? 'Unarchive' : 'Archive'}</span>
                {currentMenuNode.isArchived ? (
                  <MdOutlineUnarchive size={14} className="shrink-0" />
                ) : (
                  <MdOutlineArchive size={14} className="shrink-0" />
                )}
              </motion.button>

              <motion.button
                variants={shutterItemVariants}
                type="button"
                onClick={() => handleDeleteNote(currentMenuNode)}
                className="flex items-center justify-between gap-3 px-2 py-[6px] rounded-xl cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-full hover:bg-red-500/20 hover:text-red-400 text-red-400"
              >
                <span>Trash</span>
                <MdDelete size={14} className="shrink-0" />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default Graph;
