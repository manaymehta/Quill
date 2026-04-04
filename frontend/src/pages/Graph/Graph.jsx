import React, { useState, useEffect, useMemo, useRef } from 'react';
import { forceCollide } from 'd3-force';
import ForceGraph2D from 'react-force-graph-2d';
import { useNotesStore } from '../../store/useNotesStore';

// Mock data removed

const Graph = () => {
  const fgRef = useRef();
  const { allNotes } = useNotesStore();
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [highlightedNodes, setHighlightedNodes] = useState(new Set());
  const [highlightedLinks, setHighlightedLinks] = useState(new Set());
  const [selectedTag, setSelectedTag] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [animTick, setAnimTick] = useState(0);

  // Stores animated values per node: { [nodeId]: { opacity, radius } }
  const nodeAnimRef = useRef({});
  // Stores animated link opacity per link key
  const linkAnimRef = useRef({});

  // Helper: lerp a → b with factor t (higher t = snappier)
  const lerp = (a, b, t) => a + (b - a) * t;
  const LERP_FACTOR = 0.5; // snappy: ~98% in ~5 frames

  // unique tags from all notes
  const uniqueTags = useMemo(() => {
    const allTags = allNotes.flatMap(note => note.tags);
    return [...new Set(allTags)];
  }, [allNotes]);

  useEffect(() => {
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

    setGraphData({ nodes, links });
  }, [allNotes]); // runs when allNotes changes

  const handleTagClick = (tag) => {
    setSelectedTag(tag);
  };

  useEffect(() => {
    if (selectedTag) {
      const newHighlightedNodes = new Set();
      const newHighlightedLinks = new Set();

      graphData.nodes.forEach(node => {
        if (node.tags.includes(selectedTag)) {
          newHighlightedNodes.add(node);
        }
      });

      graphData.links.forEach(link => {
        const sourceNode = graphData.nodes.find(n => n.id === link.source.id);
        const targetNode = graphData.nodes.find(n => n.id === link.target.id);
        if (sourceNode && targetNode && sourceNode.tags.includes(selectedTag) && targetNode.tags.includes(selectedTag)) {
          newHighlightedLinks.add(link);
        }
      });

      setHighlightedNodes(newHighlightedNodes);
      setHighlightedLinks(newHighlightedLinks);
    } else {
      setHighlightedNodes(new Set());
      setHighlightedLinks(new Set());
    }
  }, [selectedTag, graphData]);

  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(-12);
      fgRef.current.d3Force('collide', forceCollide(19));
    }
  }, []);

  const handleNodeHover = (node) => {
    if (selectedTag) return; // Disable hover effect if a tag is selected

    if (hoveredNode !== node) {
      setHoveredNode(node);
      if (node) {
        const newHighlightedNodes = new Set();
        newHighlightedNodes.add(node);
        const newHighlightedLinks = new Set();
        graphData.links.forEach(link => {
          if (link.source === node || link.target === node) {
            newHighlightedLinks.add(link);
            newHighlightedNodes.add(link.source);
            newHighlightedNodes.add(link.target);
          }
        });
        setHighlightedNodes(newHighlightedNodes);
        setHighlightedLinks(newHighlightedLinks);
      } else {
        setHighlightedNodes(new Set());
        setHighlightedLinks(new Set());
      }
    }
  };

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

  return (
    <div className={'bg-[#202124b5]'} style={{ width: '100%', height: 'calc(100vh - 70px)', overflow: 'hidden', position: 'relative', cursor: hoveredNode ? 'pointer' : 'default' }}>
      <ForceGraph2D
        ref={fgRef}
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

      {/* tags display custom dropdown */}
      <div className="absolute top-5 right-5 z-10 bg-[#202124]/90 backdrop-blur-lg rounded-xl border border-white/20 p-4 min-w-[200px] max-w-xs text-white shadow-xl transition-all">
        <div
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex justify-between items-center w-full cursor-pointer group"
        >
          <h3 className="font-semibold text-sm text-stone-300 uppercase tracking-wider group-hover:text-white transition-colors">
            {selectedTag ? `Tag: ${selectedTag}` : 'Filter by Tag'}
          </h3>
          <svg className={`w-4 h-4 text-stone-400 group-hover:text-white transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
        </div>

        {isDropdownOpen && (
          <div className="flex flex-col gap-2 mt-4 max-h-[60vh] overflow-y-auto editor-scrollbar pr-2 border-t border-white/10 pt-3">
            <button
              onClick={() => { handleTagClick(null); }}
              className={`border text-[#EAEAEA] rounded-full px-3 py-1.5 text-sm cursor-pointer transition-colors text-left ${!selectedTag ? 'bg-[#e85d56] border-[#e85d56] text-white shadow-md' : 'bg-[#333] border-[#424242] hover:bg-[#444]'}`}
            >
              All Notes
            </button>
            {uniqueTags.map(tag => (
              <button
                key={tag}
                onClick={() => { handleTagClick(tag); }}
                className={`border text-[#EAEAEA] rounded-full px-3 py-1.5 text-sm cursor-pointer transition-colors text-left ${selectedTag === tag ? 'bg-[#e85d56] border-[#e85d56] text-white shadow-md' : 'bg-[#333] border-[#424242] hover:bg-[#444]'}`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Graph;
