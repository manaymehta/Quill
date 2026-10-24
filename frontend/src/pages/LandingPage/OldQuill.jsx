import React, { useEffect, useRef } from 'react';
import './OldQuill.css';

// The landing page's original procedural quill, kept for reference. It isn't rendered anywhere: the landing page now
// shows the quill mark from design/quill-mark (src/assets/quill). Its styles are in OldQuill.css.
const OldQuill = () => {
  const svgRef = useRef(null);

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

  return <svg ref={svgRef} id="generatedQuillSvg" className="landing-quill-svg" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg"></svg>;
};

export default OldQuill;
