import React, { useState, useEffect } from 'react';
import { ForceGraph2D } from 'react-force-graph';

function NoteGraph({ notesData }) {
  {/*const [graphData, setGraphData] = useState({ nodes: [], links: [] });

  // This effect runs when your notes data changes
  useEffect(() => {
    // 1. Your logic to process `notesData` into a `nodes` array
    // and a `links` (edges) array goes here.
    const processedNodes = notesData.map(note => ({ id: note.id, name: note.title }));
    const processedLinks = generateLinksFromTags(notesData); // Your helper function

    setGraphData({ nodes: processedNodes, links: processedLinks });
  }, [notesData]);

  const handleNodeClick = node => {
    // 2. Logic to open the note when its node is clicked
    console.log('Opening note:', node.id);
    // e.g., window.location.href = `/notes/${node.id}`;
  };*/}

  return (
    {/*<ForceGraph2D
      graphData={graphData}
      nodeLabel="name" // Property to display on hover
      onNodeClick={handleNodeClick}
      linkColor={() => 'rgba(255,255,255,0.2)'}
    />*/}
  );
}