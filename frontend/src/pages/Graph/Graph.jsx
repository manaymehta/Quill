 
import React, { useState, useEffect, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

const Graph = () => {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [highlightedNodes, setHighlightedNodes] = useState(new Set());
  const [highlightedLinks, setHighlightedLinks] = useState(new Set());

  useEffect(() => {
    // 1. Mock data representing user notes with tags
    const mockNotes = [
      { id: '1', name: 'Note A: Intro to React', tags: ['a', ] },
      { id: '2', name: 'Note B: State Management', tags: ['a', 'b'] },
      { id: '3', name: 'Note C: JS Fundamentals', tags: ['a'] },
      { id: '4', name: 'Note D: Advanced Hooks', tags: ['c'] },
      { id: '5', name: 'Note E: Backend with Node.js', tags: ['c', 'b'] },
      { id: '6', name: 'Note F: CSS Styling', tags: ['d'] },
      { id: '7', name: 'Note G: Redux vs. Context', tags: ['d'] },
    ];

    // 2. Transform notes into graph nodes
    const nodes = mockNotes.map(note => ({
      id: note.id,
      name: note.name,
    }));

    // 3. Generate links based on shared tags
    const tagMap = {};
    mockNotes.forEach(note => {
      note.tags.forEach(tag => {
        if (!tagMap[tag]) {
          tagMap[tag] = [];
        }
        tagMap[tag].push(note.id);
      });
    });

    const links = [];
    const linkSet = new Set(); // Use a Set to prevent duplicate links

    for (const tag in tagMap) {
      const noteIds = tagMap[tag];
      if (noteIds.length > 1) {
        for (let i = 0; i < noteIds.length; i++) {
          for (let j = i + 1; j < noteIds.length; j++) {
            const source = noteIds[i];
            const target = noteIds[j];
            // Create a unique key for each link pair to avoid duplicates
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
  }, []); // Empty dependency array ensures this runs only once

  const handleNodeHover = (node) => {
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
    <div className={'bg-[#202124b5]'} style={{ width: '100%', height: 'calc(100vh - 60px)' }}>
      <ForceGraph2D
        graphData={graphData}
        nodeLabel="name"
        nodeColor={node => highlightedNodes.has(node) ? 'white' : 'gray'}
        linkColor={link => highlightedLinks.has(link) ? 'white' : 'rgba(255, 255, 255, 0.2)'}
        linkWidth={link => highlightedLinks.has(link) ? 4 : 2}
        nodeRelSize={6}
        onNodeHover={handleNodeHover}
      />
    </div>
  );
};

export default Graph;
