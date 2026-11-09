// Pure helpers for checkboxes stored as GFM task lines in a note's `content`.
// The editor has its own CodeMirror-aware version; these are for static previews (note cards)
// and for the card-tick mutation.

const TASK_LINE_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)\[([ xX])\]([ \t]|$)/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

const splitLines = (content) => {
  const text = String(content || '');
  return {
    newline: text.includes('\r\n') ? '\r\n' : '\n',
    lines: text.split(/\r?\n/),
  };
};

// Task line numbers, ignoring fenced code blocks. The editor's regex also ignores fences when
// counting authored tasks; this keeps the card fallback aligned with what Markdown actually renders.
const taskLineIndexesFromLines = (lines) => {
  const indexes = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const close = FENCE_CLOSE_RE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = FENCE_OPEN_RE.exec(line);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    if (TASK_LINE_RE.test(line)) indexes.push(i);
  }
  return indexes;
};

const toggleLine = (lines, index) => {
  const match = TASK_LINE_RE.exec(lines[index] || '');
  if (!match) return false;
  const box = match[1].length + match[2].length + match[3].length + 1;
  lines[index] = `${lines[index].slice(0, box)}${match[4] === ' ' ? 'x' : ' '}${lines[index].slice(box + 1)}`;
  return true;
};

/**
 * Flip the nth rendered task (0-based), matching the card preview order.
 * Returns the new text, or null when there is no such task.
 */
export const toggleTaskAt = (content, taskIndex) => {
  const { newline, lines } = splitLines(content);
  const indexes = taskLineIndexesFromLines(lines);
  const index = indexes[taskIndex];
  if (index === undefined || !toggleLine(lines, index)) return null;
  return lines.join(newline);
};

/**
 * Flip the task on an exact source line (0-based), used when the rendered node carries its
 * Markdown position. Returns the new text, or null when that line is not a task.
 */
export const toggleTaskAtLine = (content, lineIndex) => {
  const { newline, lines } = splitLines(content);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return null;
  if (!toggleLine(lines, lineIndex)) return null;
  return lines.join(newline);
};
