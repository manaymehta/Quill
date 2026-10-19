import { useMemo, useState } from 'react';
import { diffLines, diffWordsWithSpace } from 'diff';

// The "Changes" view of an agent edit, as track changes (not a code diff): the note shown once, in its
// own typeface, with removed words struck through in soft red and added words in soft green, inline
// where they happen. A git-style view of rows read badly for prose — removed lines in one block and
// their new versions ten lines below, raw markdown, monospace, and blank lines counted as changes.
//
// How a change is shown: the old and new lines of each changed stretch are matched by how alike they
// are (in order). A matched pair that's mostly the same reads as one line with its edits inline; a line
// rewritten beyond that shows struck through, then its replacement. Lines with no match are plain
// removals / additions. Blank-line-only changes are ignored. Unchanged stretches fold to a few lines of
// context. Markdown syntax (**, `, #, list markers) is dimmed so the words lead.

const CONTEXT = 2;          // unchanged lines kept around each change
const SAME_ENOUGH = 0.6;    // a line pair at least this alike reads as one edited line (below: a rewrite —
                            // marking the few surviving words of a reworded line read as confetti)

const splitLines = (value) => {
  const lines = value.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
};
const isBlank = (line) => line.trim() === '';
const solid = (s) => s.replace(/\s/g, '').length;

// How alike two lines are (0–1), and their word diff
const compare = (a, b) => {
  const words = diffWordsWithSpace(a, b);
  const same = words.reduce((n, w) => n + (!w.added && !w.removed ? solid(w.value) : 0), 0);
  const total = solid(a) + solid(b);
  return { words, similarity: total ? (2 * same) / total : 1 };
};

// Lines: { kind: 'same' | 'del' | 'add' | 'edit', text?, segments? } — segments: [{ value, op: 'same'|'del'|'add' }]
// Removed and added lines that aren't edits of each other are interleaved in order — each old line
// struck through right above its new version — so a reworded list reads item by item, not as a block of
// old lines with all the new ones further down.
const interleave = (out, dels, adds) => {
  for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) {
    if (k < dels.length) out.push({ kind: 'del', text: dels[k] });
    if (k < adds.length) out.push({ kind: 'add', text: adds[k] });
  }
};

const changedLines = (dels, adds) => {
  const out = [];
  let di = 0;
  let ai = 0;
  for (let i = 0; i < dels.length; i += 1) {
    // The best match for this removed line among the added lines not used yet
    let best = null;
    for (let j = ai; j < adds.length; j += 1) {
      const c = compare(dels[i], adds[j]);
      if (c.similarity >= SAME_ENOUGH && (!best || c.similarity > best.similarity)) best = { j, ...c };
    }
    if (!best) continue;
    interleave(out, dels.slice(di, i), adds.slice(ai, best.j));
    out.push({
      kind: 'edit',
      segments: best.words.map((w) => ({ value: w.value, op: w.added ? 'add' : w.removed ? 'del' : 'same' })),
    });
    di = i + 1;
    ai = best.j + 1;
  }
  interleave(out, dels.slice(di), adds.slice(ai));
  return out;
};

const buildLines = (before, after) => {
  const lines = [];
  const parts = diffLines(before, after, { ignoreNewlineAtEof: true });
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      for (const text of splitLines(part.value)) lines.push({ kind: 'same', text });
      continue;
    }
    // One changed stretch: everything removed and added until the text agrees again
    const dels = [];
    const adds = [];
    let k = i;
    for (; k < parts.length && (parts[k].added || parts[k].removed); k += 1) {
      (parts[k].added ? adds : dels).push(...splitLines(parts[k].value));
    }
    i = k - 1;
    // Blank lines that came or went say nothing: keep the new blank lines as plain spacing
    const realDels = dels.filter((l) => !isBlank(l));
    const realAdds = adds.filter((l) => !isBlank(l));
    if (!realDels.length && !realAdds.length) {
      for (const text of adds) lines.push({ kind: 'same', text });
      continue;
    }
    lines.push(...changedLines(realDels, realAdds));
  }
  return lines;
};

// Unchanged runs longer than the context around them fold into one row
const fold = (lines) => {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'same') {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === 'same') j += 1;
    const run = lines.slice(i, j);
    const head = i === 0 ? 0 : CONTEXT;
    const tail = j === lines.length ? 0 : CONTEXT;
    if (run.length > head + tail + 1) {
      out.push(...run.slice(0, head), { kind: 'fold', lines: run.slice(head, run.length - tail), key: `fold-${i}` }, ...run.slice(run.length - tail));
    } else {
      out.push(...run);
    }
    i = j;
  }
  return out;
};

// Markdown, rendered lightly the way the note looks (marks shown even dimmed were clutter): a list
// marker becomes a bullet, a heading's #s go (the line is bold), **bold** is bold, `code` is a small
// code chip. Bold and code carry across a line's pieces (an edited line is several), so the state is
// threaded through them.
const MARKS = /(\*\*|__|`)/;
const LEAD = /^(\s*)(#{1,6}\s|[*-]\s|\d+\.\s)/;

const renderLine = (pieces) => {
  // pieces: [{ value, op }] for one line; returns spans
  const out = [];
  const state = { bold: false, code: false };
  pieces.forEach((piece, pi) => {
    let rest = piece.value;
    if (pi === 0) {
      const lead = rest.match(LEAD);
      if (lead) {
        const marker = lead[2].trim();
        if (/^[*-]$/.test(marker)) out.push({ text: `${lead[1]}• `, op: piece.op, bullet: true });
        else if (/^\d+\.$/.test(marker)) out.push({ text: `${lead[1]}${marker} `, op: piece.op });
        rest = rest.slice(lead[0].length);
      }
    }
    for (const part of rest.split(MARKS)) {
      if (!part) continue;
      if (part === '`') { state.code = !state.code; continue; }
      if (part === '**' || part === '__') { if (!state.code) { state.bold = !state.bold; continue; } }
      out.push({ text: part, op: piece.op, bold: state.bold, code: state.code });
    }
  });
  return out;
};

const isHeading = (text) => /^\s*#{1,6}\s/.test(text || '');

const LINE_TONES = {
  same: 'text-stone-500',
  del: 'border-l-2 border-[#e85d56]/40 pl-3 -ml-[14px] text-[#b0473d]/85 line-through decoration-[#e85d56]/40',
  add: 'border-l-2 border-emerald-600/45 pl-3 -ml-[14px] text-[#1f5c45] bg-emerald-600/[0.07] rounded-r',
  edit: 'border-l-2 border-[#c9b593] pl-3 -ml-[14px] text-[#333]',
};
const SEGMENT_TONES = {
  same: '',
  del: 'line-through decoration-[#e85d56]/60 text-[#b0473d] bg-[#e85d56]/10 rounded-sm',
  add: 'text-[#1f5c45] bg-emerald-600/15 rounded-sm',
};

const Line = ({ line }) => {
  const pieces = line.kind === 'edit' ? line.segments : [{ value: line.text, op: 'same' }];
  const whole = pieces.map((p) => p.value).join('');
  return (
    <div className={`whitespace-pre-wrap break-words min-h-[1.7em] ${LINE_TONES[line.kind]} ${isHeading(whole) ? 'font-semibold text-[#333]' : ''}`}>
      {renderLine(pieces).map((span, idx) => (
        <span
          key={idx}
          className={[
            SEGMENT_TONES[span.op],
            span.bold ? 'font-semibold' : '',
            span.code ? 'font-mono text-[0.85em] bg-black/[0.05] rounded px-0.5' : '',
            span.bullet ? 'text-[#e85d56]/70' : '',
          ].join(' ')}
        >
          {span.text}
        </span>
      ))}
    </div>
  );
};

const AgentDiffView = ({ before, after, titleBefore, titleAfter }) => {
  const lines = useMemo(() => buildLines(before || '', after || ''), [before, after]);
  const rows = useMemo(() => fold(lines), [lines]);
  const [openFolds, setOpenFolds] = useState(() => new Set());
  // A removed line right above an added one is a rewrite (that's how they're laid out), not one of each
  let edited = 0;
  let rewritten = 0;
  let added = 0;
  let removed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const { kind } = lines[i];
    if (kind === 'edit') edited += 1;
    else if (kind === 'del' && lines[i + 1]?.kind === 'add') { rewritten += 1; i += 1; }
    else if (kind === 'del') removed += 1;
    else if (kind === 'add') added += 1;
  }
  const titleChanged = titleBefore !== undefined && titleBefore !== titleAfter;

  if (!edited && !rewritten && !added && !removed && !titleChanged) {
    return <p className="text-sm text-stone-500 py-6 font-sans">No changes from the original.</p>;
  }

  const summary = [
    rewritten && `${rewritten} rewritten`,
    edited && `${edited} edited`,
    added && `${added} added`,
    removed && `${removed} removed`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="agent-cream flex flex-col gap-3">
      <p className="font-sans text-[11px] md:text-xs font-medium tracking-[0.12em] uppercase text-stone-400">
        {summary ? `${summary} ${edited + rewritten + added + removed === 1 ? 'line' : 'lines'}` : ''}
        {summary && titleChanged ? ' · ' : ''}
        {titleChanged ? 'new title' : ''}
      </p>
      {titleChanged && (
        <p className="font-sans text-xs text-stone-500">
          Title: <span className="line-through decoration-[#e85d56]/60 text-[#b0473d]">{titleBefore || '(untitled)'}</span>
          <span className="text-stone-400"> → </span>
          <span className="text-[#1f5c45] bg-emerald-600/15 rounded-sm px-0.5">{titleAfter || '(untitled)'}</span>
        </p>
      )}
      {/* The note's own text, at the editor's size, with a margin for the change bars */}
      <div className="pl-[14px] text-[15px] leading-[1.7] md:text-[16px] md:leading-[1.75]" style={{ fontFamily: "'Lora', Georgia, serif" }}>
        {rows.map((row, idx) => {
          if (row.kind !== 'fold') return <Line key={idx} line={row} />;
          if (openFolds.has(row.key)) return row.lines.map((l, k) => <Line key={`${row.key}-${k}`} line={l} />);
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => setOpenFolds((prev) => new Set(prev).add(row.key))}
              className="my-1 -ml-[14px] inline-flex items-center rounded-full bg-black/[0.04] hover:bg-black/[0.08] px-3 py-0.5 font-sans text-xs text-stone-500 hover:text-[#333] transition-colors cursor-pointer"
            >
              ⋯ {row.lines.length} unchanged {row.lines.length === 1 ? 'line' : 'lines'}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AgentDiffView;
