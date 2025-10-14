import React, { useState, useEffect, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useNotesStore } from '../../store/useNotesStore';

// Mock data representing user notes with tags
const mockNotes = [
  { id: '1', name: 'Intro to React', tags: ['a', ] },
  { id: '2', name: 'State Management', tags: ['a', 'b'] },
  { id: '3', name: 'JS Fundamentals', tags: ['a'] },
  { id: '4', name: 'Advanced Hooks', tags: ['c'] },
  { id: '5', name: 'Backend with Node.js', tags: ['c', 'b'] },
  { id: '6', name: 'CSS Styling', tags: ['d'] },
  { id: '7', name: 'Redux vs. Context', tags: ['d'] },
];

const Graph = () => {
  const { allNotes } = useNotesStore();
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [highlightedNodes, setHighlightedNodes] = useState(new Set());
  const [highlightedLinks, setHighlightedLinks] = useState(new Set());
  const [selectedTag, setSelectedTag] = useState(null);

  // unique tags from all notes
  const uniqueTags = useMemo(() => {
    const allTags = allNotes.flatMap(note => note.tags);
    return [...new Set(allTags)];
  }, [allNotes]);

  useEffect(() => {
    // 1. Calculate tag frequencies to find connecting tags
    const tagFrequencies = allNotes.flatMap(note => note.tags).reduce((acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {});

    const connectingTagsSet = new Set(Object.keys(tagFrequencies).filter(tag => tagFrequencies[tag] > 1));

    // 2. Transform notes into graph nodes
    const nodes = allNotes.map(note => ({
      id: note._id,
      name: note.title,
      tags: note.tags,
      connectingTags: note.tags.filter(tag => connectingTagsSet.has(tag)),
    }));

    // 3. Generate links based on shared tags
    const tagMap = {};
    allNotes.forEach(note => {
      note.tags.forEach(tag => {
        if (connectingTagsSet.has(tag)) { // Only consider connecting tags for links
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
    setSelectedTag(prevSelectedTag => (prevSelectedTag === tag ? null : tag));
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

  return (
    <div className={'bg-[#202124b5]'} style={{ width: '100%', height: 'calc(100vh - 70px)', overflow: 'hidden', position: 'relative' }}>
      <ForceGraph2D
        graphData={graphData}
        nodeLabel={node => node.connectingTags.join(', ')}
        linkColor={link => highlightedLinks.has(link) ? '#e7aeab' : 'rgba(255, 255, 255, 0.6)'}
        linkWidth={link => highlightedLinks.has(link) ? 6 : 1}
        onNodeHover={handleNodeHover}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI, false);
          ctx.fill();
        }}
        nodeCanvasObject={(node, ctx) => {
          // node circle
          ctx.beginPath();
          ctx.arc(node.x, node.y, 9, 0, 2 * Math.PI, false);
          ctx.fillStyle = highlightedNodes.has(node) ? '#e85d56' : '#f8ecdc';
          ctx.fill();

          // node name below the circle
          const label = node.name;
          const fontSize = 6;
          ctx.font = `${fontSize}px Sans-Serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = 'white';
          ctx.fillText(label, node.x, node.y + 8);
        }}
      />

      {/* Tags Display Box */}
      <div className="absolute top-5 right-5 z-10 bg-[#202124]/80 backdrop-blur-lg rounded-xl border border-white/20 p-4 max-w-xs text-white max-h-[calc(100%-2.5rem)] overflow-y-auto">
        <h3 className="font-semibold text-lg mb-3 border-b border-white/20 pb-2">
            Tags
        </h3>
        <div className="flex flex-col gap-2">
            {uniqueTags.map(tag => (
                <button 
                  key={tag} 
                  onClick={() => handleTagClick(tag)} 
                  className={`border text-[#EAEAEA] rounded-full px-3 py-1.5 text-sm cursor-pointer transition-colors text-left ${selectedTag === tag ? 'bg-white/20 border-white/40' : 'bg-[#333] border-[#424242] hover:bg-[#444]'}`}
                >
                    {tag}
                </button>
            ))}
        </div>
      </div>
    </div>
  );
};

export default Graph;