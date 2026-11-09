/**
 * markdownTaskList.js
 * Inline checkboxes for task-list lines (`- [ ] text` / `- [x] text`) in the note editor.
 *
 * The checkbox is only a rendering of plain markdown: the document keeps the `- [ ]` text, so the
 * note card, the search index and the agent read the same content as before. Every action is a
 * normal CodeMirror transaction, which means undo/redo (the toolbar pill and Mod-z), tab snapshots
 * and the editor's own history all cover it:
 *  - click the box                         → toggle  (`input.checkbox`)
 *  - drag the grip between blocks          → move    (`move.drop`, one transaction)
 *  - the toolbar's checkbox button         → insert  (`input.insert`)
 *
 * A task is always a whole line, so it can only be dropped in the gaps between blocks, never
 * inside a paragraph: see `collectGaps` / `moveTaskBlock`.
 */

import { Annotation, EditorState, Facet, Prec, RangeSetBuilder, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';

// ─── Drag choreography (per-editor switch; 'row' is the shipped default) ─────
//  - 'line'    : only a thin insertion line marks the drop (the original behaviour)
//  - 'reorder' : live reorder, the source row dimmed; no floating copy
//  - 'row'     : live reorder with the row itself lifted (a pixel copy of it, no card chrome,
//                source invisible as the landing hole) and the other rows sliding into place
// Facet values come from the extension tree, so a Compartment can switch it per editor.
export const taskDragMode = Facet.define({
  combine: (values) => (values.length ? values[values.length - 1] : 'row'),
});

// Tags the drag's own transactions, so the plugin does not tear down its drag halfway through
const taskDragInternal = Annotation.define();

// `- [ ] text` / `- [x] text`, the GFM task form (bullets and ordered items). A task needs a space
// (or the line end) after the closing bracket: `- [ ]word` is not a checkbox, same as GFM.
const TASK_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)\[([ xX])\](?:([ \t])|$)/;

const TASK_PREFIX = '- [ ] ';

// A line that starts a block of its own: task continuations stop here (a heading, a new list item,
// a quote, a fence…). Indentation is allowed, or a nested `- [ ]` would be swallowed by the task
// above it and the two would drag around as one block.
const BLOCK_START_RE = /^[ \t]*(?:#{1,6}(?:[ \t]|$)|>|`{3,}|~{3,}|(?:[-*+]|\d+[.)])(?:[ \t]|$))/;

/** Info about a task-list line, or null when the line is not one. */
export const taskLineInfo = (text) => {
  const match = TASK_RE.exec(text);
  if (!match) return null;
  const [whole, indent, bullet, gap, mark] = match;
  return {
    indent,
    bullet,
    checked: mark !== ' ',
    prefixEnd: whole.length, // characters the `- [ ] ` marker occupies at the line start
    checkPos: indent.length + bullet.length + gap.length + 1, // the ` `/`x` inside the brackets
  };
};

// True for a `- [ ] text` line (used to keep the markdown-syntax hider out of the marker)
const isTaskLine = (text) => TASK_RE.test(text);

// The rendered `.cm-line` elements of a task block, in document order. Used to lift a pixel copy of
// the row out of the text (the row itself is an editor-owned DOM node and must stay in the flow).
const blockLineElements = (view, block) => {
  const lines = [];
  for (const el of view.contentDOM.querySelectorAll('.cm-line')) {
    const pos = view.posAtDOM(el, 0);
    if (pos >= block.from && pos <= block.to) lines.push(el);
  }
  return lines;
};

// ─── Widget: grip + checkbox ─────────────────────────────────────────────────

class TaskCheckbox extends WidgetType {
  constructor(info) {
    super();
    this.info = info;
  }

  // Only the tick can differ: the row it sits on is the editor's job, so the DOM survives every
  // edit (typing above the viewport, a live reorder) instead of being rebuilt for every checkbox
  // on screen. Positions are therefore resolved at event time, never captured here.
  eq(other) {
    return other.info.checked === this.info.checked;
  }

  toDOM(view) {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-task-widget';
    wrapper.contentEditable = 'false';

    const lineStart = (element) => {
      const line = element.closest('.cm-line');
      return line ? view.posAtDOM(line, 0) : null;
    };

    const grip = document.createElement('span');
    grip.className = 'cm-task-grip';
    grip.title = 'Drag to move this checkbox';
    grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('pointerdown', (event) => {
      const from = lineStart(grip);
      if (from !== null) view.plugin(taskListPlugin)?.startDrag(from, event);
    });

    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'cm-task-check';
    if (this.info.checked) box.classList.add('is-checked');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.info.checked));
    box.title = this.info.checked ? 'Mark as not done' : 'Mark as done';
    // Keep the caret in the text: clicking the box must not move it or blur the editor
    box.addEventListener('mousedown', (event) => event.preventDefault());
    box.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const from = lineStart(box);
      if (from !== null) toggleTask(view, from);
    });

    // A read-only view (the agent's "Before" note) gets the box, not a draggable-looking grip
    if (!view.state.readOnly) wrapper.append(grip);
    wrapper.append(box);
    return wrapper;
  }

  // The widget owns its pointer events (click toggles, drag moves); the editor must not move
  // the cursor or start a text selection from them.
  ignoreEvent() { return true; }
}

// ─── Decorations ─────────────────────────────────────────────────────────────

const doneLine = Decoration.line({ class: 'cm-task-done' });
const dragSourceLine = Decoration.line({ class: 'cm-task-drag-source' });

// A line inside fenced/indented code is not a checkbox, even when its text looks like `- [ ]`.
// The syntax tree distinguishes it from a nested list item, which a line regex cannot.
const isCodeLine = (state, pos) => {
  let node = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
  }
  return false;
};

const buildTaskDecorations = (view) => {
  const { state } = view;
  const builder = new RangeSetBuilder();
  const first = state.doc.lineAt(view.viewport.from).number;
  const last = state.doc.lineAt(view.viewport.to).number;

  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    const info = taskLineInfo(line.text);
    if (!info || isCodeLine(state, line.from)) continue;

    const markerFrom = line.from + info.indent.length;
    const markerTo = line.from + info.prefixEnd;

    // Line decoration first: it is a point at line.from and sorts before the replace range
    if (info.checked) builder.add(line.from, line.from, doneLine);
    builder.add(markerFrom, markerTo, Decoration.replace({
      widget: new TaskCheckbox(info),
    }));
  }

  return builder.finish();
};

// Once a gap is taken, the pointer must pass the midpoint between the two gaps and keep going for
// this much before the rows move again. A hand that wobbles on a boundary should not make the list
// flip back and forth, but the margin has to stay small: rows are ~23 px, so a large value would
// make the next row only reachable from its very top edge.
const GAP_HYSTERESIS_PX = 3;

// Row slide: long enough to read as movement, short enough to keep up with the pointer
const SLIDE_MS = 220;
const SLIDE_EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

const taskListPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.decorations = buildTaskDecorations(view);
    this.drag = null;
    this.scroller = null;
    this.frame = 0;
    this.gapGeom = null;
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onPointerCancel = () => this.cancelDrag();
    this.onDragKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelDrag();
        return;
      }
      // Undo/redo mid-drag would rewind text the preview has not written to history yet
      if ((event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key)) event.preventDefault();
    };
  }

  update(update) {
    if (update.docChanged || update.viewportChanged
        || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = buildTaskDecorations(update.view);
    }
    // An outside change (undo, agent edit) invalidates the block being dragged. The drag's own
    // transactions (live reorder) must not cancel it.
    if (this.drag && update.docChanged
        && !update.transactions.some((tr) => tr.annotation(taskDragInternal))) {
      this.clearDragDom();
    }
  }

  destroy() {
    this.clearDragDom();
  }

  // ── dragging ──

  startDrag(lineFrom, event) {
    if (this.drag || this.view.state.readOnly) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    const mode = this.view.state.facet(taskDragMode);
    const block = getTaskBlock(this.view.state, lineFrom);
    if (!block) return;
    const gaps = collectGaps(this.view.state);
    if (gaps.length < 2) return;
    this.gapGeom = null;

    const marker = document.createElement('div');
    marker.className = 'cm-task-drop-line';
    marker.style.cssText = 'position:absolute;border-radius:999px;background:#e85d56;'
      + `height:${mode === 'line' ? 2 : 3}px;`
      + 'box-shadow:0 0 0 1px rgba(232,93,86,0.18);pointer-events:none;z-index:20;display:none;';
    this.view.dom.appendChild(marker);

    this.drag = {
      mode,
      block,
      gaps,
      gapsDoc: this.view.state.doc,
      gapNow: null,
      originText: mode === 'line' ? null : this.view.state.doc.toString(),
      originState: mode === 'line' ? null : this.view.state,
      marker,
      ghost: null,
      grab: null,
      firstLineText: null,
      slides: [],
      pointer: { y: event.clientY },
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      prevCursor: document.body.style.cursor,
      prevUserSelect: document.body.style.userSelect,
    };
    // B has no floating copy at all: the dimmed row and the rows making room are the feedback
    if (mode === 'row') this.drag.ghost = this.buildRowClone(block, event);

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    this.view.dom.classList.add('cm-task-dragging');
    document.addEventListener('pointermove', this.onPointerMove, { passive: false });
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.onPointerCancel);
    document.addEventListener('keydown', this.onDragKeyDown);

    // 'row' lifts the row only once it really moves: pressing the grip must not blank it out
    if (mode !== 'row') this.view.dispatch({ effects: setTaskDrag.of(block) });
  }

  // Raw pointer events arrive faster than the screen refreshes, and the work below is geometry +
  // text: remember the newest position and do it once per frame instead of once per event.
  handlePointerMove(event) {
    const drag = this.drag;
    if (!drag) return;
    if (drag.pointerId !== undefined && event.pointerId !== drag.pointerId) return;

    drag.pointer = { y: event.clientY };
    if (!drag.moved) {
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (dx < 3 && dy < 3) return;
      drag.moved = true;
      // A press alone changes nothing; the row is only lifted once the pointer really travels
      if (drag.mode === 'row') {
        this.view.dom.classList.add('cm-task-lifting');
        this.view.dispatch({ effects: setTaskDrag.of(drag.block) });
      }
    }

    event.preventDefault();
    this.scheduleFrame();
  }

  scheduleFrame() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.tick();
    });
  }

  // One pass over the current pointer position. Called on drop too, so the pointer's last position
  // always wins even if the rows have not caught up with it yet.
  tick() {
    const drag = this.drag;
    if (!drag || !drag.moved || this.view.destroyed) return;

    const { y } = drag.pointer;
    const scroll = this.autoScroll(y);
    // Only now is there a drag to show: on a plain press the copy stays hidden instead of
    // flashing at the editor's top-left corner
    if (drag.ghost) this.positionRowClone(y);

    let target = this.gapTarget(y);
    // Hysteresis: once a gap is taken, the pointer must pass the midpoint between the two gaps and
    // keep going for GAP_HYSTERESIS_PX before the rows move again. A hand that wobbles on the
    // boundary therefore cannot make the list flip back and forth. Scrolling re-targets at once.
    if (target && drag.gapNow && target.gap.pos !== drag.gapNow.pos && !scroll.scrolled) {
      const currentY = this.gapNowScreenY();
      if (currentY !== null && Math.abs(y - target.y) + 2 * GAP_HYSTERESIS_PX > Math.abs(y - currentY)) {
        target = null;
      }
    }
    const gap = target ? target.gap : null;

    if (drag.mode !== 'line') {
      // Move the text as the pointer crosses a gap: the rows themselves make room. No travel
      // threshold here: a move shifts the rows, which can put the next gap under a pointer that is
      // holding still, and waiting for 8 px of motion then made the list look frozen until drop.
      // The gap hysteresis above is what keeps a hand wobbling on a boundary from flapping.
      const changed = gap && (!drag.gapNow || gap.pos !== drag.gapNow.pos);
      // Only remember a gap that actually moved something; a gap the block already occupies would
      // otherwise stick and freeze the drag on its next hop
      if (changed && this.applyLiveMove(drag, gap)) {
        drag.gapNow = gap;
      }
      drag.marker.style.display = 'none';
    } else {
      this.positionDropLine(gap);
    }

    // Keep scrolling while the pointer rests near an edge, and re-target as the rows slide past it
    if (scroll.atEdge) this.scheduleFrame();
  }

  // Screen y of the gap the row currently sits in, for the hysteresis check
  gapNowScreenY() {
    const drag = this.drag;
    if (!drag) return null;
    const { doc } = this.view.state;
    const lineFrom = doc.lineAt(drag.block.from).from;
    for (const { gap, y } of this.gapGeometry()) {
      if (doc.lineAt(gap.pos).from === lineFrom) return y;
    }
    return null;
  }

  handlePointerUp(event) {
    const drag = this.drag;
    if (!drag) return;
    if (drag.pointerId !== undefined && event.pointerId !== drag.pointerId) return;

    drag.pointer = { y: event.clientY };

    if (drag.mode !== 'line') {
      // Catch up with wherever the pointer stopped, then land the whole drag as one undo step
      if (drag.moved) this.tick();
      // The copy has to outlive the commit: blank separators can move the row by a line, so its
      // landing spot is measured after the document has settled
      const clone = drag.ghost;
      drag.ghost = null;
      this.finishDrag();
      this.commitReorder(drag);
      if (clone) this.settleClone(clone, drag);
      return;
    }

    const gap = drag.moved ? this.gapAt(event.clientY) : null;
    const { block } = drag;
    this.finishDrag();
    if (gap) moveTaskBlock(this.view, block, gap);
  }

  // A cancelled drag (Escape, pointercancel) must not leave the note in the preview order: those
  // live moves were never written to history, so rewind them. An outside edit is different — there
  // the drag is simply dropped and the other change stays (see `update`).
  cancelDrag() {
    const drag = this.drag;
    if (!drag) return;
    const origin = drag.mode === 'line' ? null : drag.originText;
    const originState = drag.originState;
    const current = this.view.state.doc.toString();
    this.finishDrag();
    if (origin === null || this.view.destroyed) return;
    // Notify the React value with the rewind, then restore the pre-drag history/selection.
    if (current !== origin) {
      const change = minimalChange(current, origin);
      if (change) {
        this.view.dispatch({
          changes: change,
          annotations: [taskDragInternal.of(true), Transaction.addToHistory.of(false)],
        });
      }
    }
    if (originState) this.view.setState(originState);
  }

  finishDrag() {
    const had = Boolean(this.drag);
    this.clearDragDom();
    if (had && !this.view.destroyed) {
      this.view.dispatch({ effects: setTaskDrag.of(null) });
    }
  }

  clearDragDom() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.gapGeom = null;
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    drag.marker.remove();
    drag.ghost?.remove();
    for (const { animation } of drag.slides) animation.cancel();
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.onPointerCancel);
    document.removeEventListener('keydown', this.onDragKeyDown);
    document.body.style.cursor = drag.prevCursor;
    document.body.style.userSelect = drag.prevUserSelect;
    this.view.dom.classList.remove('cm-task-dragging');
    this.view.dom.classList.remove('cm-task-lifting');
  }

  // The drop targets of the document as it is *now*: a live reorder changes the text, so the list is
  // rebuilt when the document changes and reused for every frame in between.
  gapList() {
    const drag = this.drag;
    const { doc } = this.view.state;
    if (drag.gapsDoc !== doc) {
      drag.gaps = collectGaps(this.view.state);
      drag.gapsDoc = doc;
    }
    return drag.gaps;
  }

  // Screen y of the gaps on screen, measured once per (document, scroll position) instead of once
  // per gap per pointer event: `coordsAtPos` is a real measurement and there is one per gap.
  gapGeometry() {
    const { view } = this;
    const { doc } = view.state;
    const scroller = this.scrollerOf();
    const scroll = scroller ? scroller.scrollTop : 0;
    const width = view.contentDOM.clientWidth;
    const height = view.contentDOM.clientHeight;
    const cached = this.gapGeom;
    if (cached && cached.doc === doc && cached.scroll === scroll
      && cached.width === width && cached.height === height) return cached.items;

    const items = [];
    for (const gap of this.gapList()) {
      // Nothing off screen can be dropped on anyway
      if (gap.pos < view.viewport.from || gap.pos > view.viewport.to) continue;
      const y = gapScreenY(view, gap);
      if (y !== null) items.push({ gap, y });
    }
    this.gapGeom = { doc, scroll, width, height, items };
    return items;
  }

  // The rendered row whose layout box contains this screen y. CodeMirror may render the whole note
  // (the scroller is the outer wrapper), so this walks the line elements; every read after the
  // first comes from the same clean layout, which keeps a pointer frame cheap.
  rowAtY(clientY) {
    const content = this.view.contentDOM;
    const parent = content.offsetParent || content.parentElement;
    const base = parent
      ? parent.getBoundingClientRect().top + parent.clientTop - parent.scrollTop
      : content.getBoundingClientRect().top;
    for (const el of content.children) {
      if (!el.classList.contains('cm-line')) continue;
      const top = base + el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (clientY >= top && clientY < bottom) return el;
    }
    return null;
  }

  // The gap under the pointer, per mode: nearest by distance ('line') or the top/bottom half of the
  // row under the pointer, which stops the line from jumping across a whole paragraph. Returns the
  // gap together with the screen y of the edge that chose it, so the hysteresis check needs no
  // second measurement.
  gapTarget(clientY) {
    const drag = this.drag;
    const { doc } = this.view.state;
    // The row can be dragged past the last line, where there is no text left to aim at. Clamping to
    // the text keeps the hole at the nearest end instead of freezing the list while the copy floats
    // over the rest of the page.
    const content = this.view.contentDOM.getBoundingClientRect();
    const pointerY = Math.min(Math.max(clientY, content.top), content.bottom - 1);
    let targetY = pointerY;
    let edge = null;
    let dir = 0;

    if (drag.mode !== 'line') {
      // The row under the pointer, in layout coordinates. Not `elementFromPoint`: the rows are
      // sliding while they make room, so the row that looks like it is under the cursor can be a
      // different one from the row that actually is, and the gaps below are measured from layout.
      const row = this.rowAtY(pointerY);
      // A blank separator has no halves: use the nearest gap. Reading it as "above" or "below"
      // made a drag jump over a whole paragraph when the pointer was on the blank line under it.
      if (row && row.textContent.trim() !== '') {
        const top = rowTop(row);
        const height = row.offsetHeight;
        // Below the midpoint means "after this row": its bottom edge, and the gap on that side.
        dir = pointerY < top + height / 2 ? -1 : 1;
        edge = dir < 0 ? top : top + height;
        targetY = edge;
      } else {
        // Pointer outside the painted page: fall back to CodeMirror's mapping
        const at = this.view.posAtCoords({ x: content.left + Math.min(12, content.width / 2), y: pointerY });
        if (at === null) return null;
        const coords = this.view.coordsAtPos(at, 1) || this.view.coordsAtPos(at, -1);
        if (!coords) return null;
        const fraction = (pointerY - coords.top) / Math.max(1, coords.bottom - coords.top);
        targetY = fraction < 0.5 ? coords.top : coords.bottom;
      }
    }

    const indent = lineIndent(doc, drag.block.from);
    const candidates = this.gapGeometry().filter(({ gap }) =>
      // Its own place: picking the task up and putting it back changes nothing
      !sameLine(doc, gap.pos, drag.block.from) && gapAllowed(gap, indent));

    // Direction wins over distance. The gap nearest to a row's bottom edge is the one above it, and
    // with a blank line between two tasks that gap is a no-op, so the drag looked stuck until the
    // pointer had crossed a whole second row. Taking the first gap past the edge instead makes the
    // hole open at the row you are actually over.
    let best = null;
    if (dir > 0) {
      for (const item of candidates) {
        if (item.y >= edge - 0.5 && (!best || item.y < best.y)) best = item;
      }
    } else if (dir < 0) {
      for (const item of candidates) {
        if (item.y <= edge + 0.5 && (!best || item.y > best.y)) best = item;
      }
    }
    if (!best) {
      let distance = Infinity;
      for (const item of candidates) {
        const d = Math.abs(item.y - targetY);
        if (d < distance) { distance = d; best = item; }
      }
    }
    return best ? { gap: best.gap, y: best.y } : null;
  }

  gapAt(clientY) {
    return this.gapTarget(clientY)?.gap ?? null;
  }

  // The row itself, lifted: a pixel copy of the rendered lines (same font, checkbox and wrapping)
  // with no card chrome, grabbed where the pointer touched it. The document's own rows are hidden
  // while it is out, so this is the only visible copy and the hidden lines are the landing hole.
  buildRowClone(block, event) {
    const { view } = this;
    const contentStyle = getComputedStyle(view.contentDOM);
    const wrap = document.createElement('div');
    wrap.className = 'cm-task-clone';
    // A decorative copy: it must not be focusable or read out as a second copy of the task
    wrap.inert = true;
    wrap.setAttribute('aria-hidden', 'true');
    // Fixed layer: the editor's scroll column clips its overflow (overflow-x: hidden), which cuts
    // the shadow off flush at the text edges. A fixed box is not clipped by ancestor overflow, so
    // the whole shadow shows; it still uses viewport coordinates and stays under the pointer.
    wrap.style.cssText = 'position:fixed;left:0;top:0;display:none;pointer-events:none;z-index:60;'
      + 'will-change:transform;border-radius:6px;'
      + `background:${paintedBackground(view.dom)};`
      + 'box-shadow:0 0 0 1px rgba(70,50,30,0.06), 0 7px 18px rgba(70,50,30,0.12), 0 2px 5px rgba(70,50,30,0.06);'
      + `font-family:${contentStyle.fontFamily};font-size:${contentStyle.fontSize};`
      + `line-height:${contentStyle.lineHeight};letter-spacing:${contentStyle.letterSpacing};`
      + `color:${contentStyle.color};`;
    // The text column's width: cloned lines then wrap exactly like the originals
    wrap.style.width = `${view.contentDOM.getBoundingClientRect().width}px`;

    const lines = blockLineElements(view, block);
    for (const line of lines) wrap.appendChild(line.cloneNode(true));
    // Inside the editor DOM, so the cloned grip/checkbox keep their generated theme styles
    view.dom.appendChild(wrap);

    // The copy only travels vertically: it stays in the row's own column instead of following the
    // pointer sideways out over the rest of the page.
    if (lines.length) {
      const rect = lines[0].getBoundingClientRect();
      this.drag.grab = { y: event.clientY - rect.top };
      this.drag.lockX = rect.left;
      this.drag.firstLineText = lines[0].textContent;
    }
    return wrap;
  }

  // The copy follows the pointer exactly, grab point under the cursor: that is what makes the row
  // feel picked up. The drop target is clamped separately, so the hole still reaches the end of the
  // list when the pointer goes past it.
  positionRowClone(clientY) {
    const drag = this.drag;
    if (!drag?.ghost || !drag.grab) return;
    if (drag.ghost.style.display === 'none') drag.ghost.style.display = 'block';
    const x = Math.round(drag.lockX ?? 0);
    const y = Math.round(clientY - drag.grab.y);
    drag.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  // Let the lifted row settle into the hole instead of vanishing under the cursor: the real row is
  // already visible, so the copy lands on top of it and fades. Measured after the commit, because a
  // blank separator can move the row by a line.
  settleClone(clone, drag) {
    // Never lifted (a plain press on the grip, or a click): nothing to animate
    if (clone.style.display === 'none') {
      clone.remove();
      return;
    }
    const from = clone.getBoundingClientRect();
    let best = null;
    for (const el of this.view.contentDOM.querySelectorAll('.cm-line')) {
      if (!drag.firstLineText || !el.textContent.startsWith(drag.firstLineText)) continue;
      const rect = el.getBoundingClientRect();
      const distance = Math.abs(rect.top - from.top);
      if (!best || distance < best.distance) best = { rect, distance };
    }
    const fade = () => clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 })
      .finished.then(() => clone.remove(), () => clone.remove());
    if (!best) {
      fade();
      setTimeout(() => clone.remove(), 200);
      return;
    }
    // The copy is a fixed layer on the editor element, so both ends of the settle are viewport coordinates
    const landed = `translate3d(${Math.round(best.rect.left)}px, ${Math.round(best.rect.top)}px, 0)`;
    clone.animate(
      [
        { transform: clone.style.transform, opacity: 1, offset: 0 },
        { transform: landed, opacity: 1, offset: 0.6 },
        { transform: landed, opacity: 0, offset: 1 },
      ],
      { duration: SLIDE_MS, easing: SLIDE_EASE },
    ).finished.then(() => clone.remove(), () => clone.remove());
    // The promise above is the normal path; this is a guarantee the copy never outlives the drop
    setTimeout(() => clone.remove(), SLIDE_MS + 80);
  }

  // Live reorder: the text moves now (no history), so the rows make room exactly like a sortable
  // list. No blank-line separators during the preview: a pure reorder means hovering can never
  // pile up empty lines; the separators are added once, when the item is dropped.
  applyLiveMove(drag, gap) {
    const plan = buildMove(this.view.state.doc, drag.block, gap, false, {
      stripLeadingBlank: !drag.originText.startsWith('\n'),
    });
    if (!plan) return false;
    const lifted = drag.block;
    const height = drag.mode === 'row' ? blockPixelHeight(this.view, lifted) : 0;
    drag.block = { from: plan.from, to: plan.to, startLine: plan.startLine, endLine: plan.endLine };
    this.view.dispatch({
      changes: plan.change,
      selection: { anchor: plan.anchor },
      annotations: [taskDragInternal.of(true), Transaction.addToHistory.of(false)],
      effects: setTaskDrag.of(drag.block),
    });
    if (drag.mode === 'row') this.slideRows(drag, lifted, height);
    return true;
  }

  // The rows that sat between the old and the new place slide there, so the document reads as rows
  // making room instead of jumping. A whole-line move shifts them by exactly the lifted block's
  // height, so this needs no layout read after the change (the height map is stale by then).
  slideRows(drag, lifted, height) {
    const { view } = this;
    const { doc } = view.state;

    // Rows still on their way keep that animation, so a row crossed again continues from where it
    // looks instead of restarting (that restart is what made the list bounce on quick crossings).
    // Matched by text: CodeMirror may hand the same content a fresh line element.
    const moving = new Map();
    for (const slide of drag.slides) {
      const running = slide.animation.playState === 'running' || slide.animation.playState === 'pending';
      const progress = running ? slide.animation.effect.getComputedTiming().progress : null;
      if (progress === null) {
        slide.animation.cancel();
        continue;
      }
      // CodeMirror may have given this content a fresh element: the pixel offset still belongs to
      // the row's text, but the old element must not keep the transform
      const still = slide.el.isConnected
        && doc.lineAt(view.posAtDOM(slide.el, 0)).text === slide.text;
      if (!still) slide.animation.cancel();
      const leftover = { slide, remaining: slide.start * (1 - progress), keep: still };
      const list = moving.get(slide.text);
      if (list) list.push(leftover);
      else moving.set(slide.text, [leftover]);
    }
    drag.slides = [];

    const count = lifted.endLine - lifted.startLine + 1;
    const from = lifted.startLine;
    const to = drag.block.startLine;
    // Rows the block jumped over: their old numbers, and which way they move
    const downward = to > from;
    const first = downward ? lifted.endLine + 1 : to;
    const last = downward ? to + count - 1 : from - 1;

    // Nothing to slide this time: the rows already on their way simply carry on
    if (to === from || last < first) {
      for (const list of moving.values()) {
        for (const { slide, keep } of list) if (keep) drag.slides.push(slide);
      }
      return;
    }
    const shift = downward ? -count : count;
    // Rows move up when the block moves down, and the other way round: start each one where it was
    const dy = downward ? height : -height;

    const vpFirst = doc.lineAt(view.viewport.from).number;
    const vpLast = doc.lineAt(view.viewport.to).number;
    for (let old = first; old <= last; old++) {
      const number = old + shift;
      if (number < vpFirst || number > vpLast) continue;
      const line = doc.line(number);
      const { node } = view.domAtPos(line.from, 1);
      const anchor = node.nodeType === 3 ? node.parentElement : node;
      const el = anchor?.closest?.('.cm-line');
      if (!el) continue;

      let start = dy;
      const list = moving.get(line.text);
      const previous = list && list.shift();
      if (previous) {
        start += previous.remaining;
        previous.slide.animation.cancel();
      }
      drag.slides.push({
        el,
        text: line.text,
        start,
        animation: el.animate(
          [{ transform: `translateY(${start}px)` }, { transform: 'translateY(0)' }],
          { duration: SLIDE_MS, easing: SLIDE_EASE },
        ),
      });
    }
    // Rows outside this crossing's range are not moving in the document, so their own slide stands
    for (const list of moving.values()) {
      for (const { slide, keep } of list) if (keep) drag.slides.push(slide);
    }
  }

  // One undo step for the whole drag. The preview never enters history; restore the pre-drag state
  // so older history is untouched, then apply the final move as the one isolated event.
  commitReorder(drag) {
    const view = this.view;
    if (view.destroyed) return;
    const originState = drag.originState;
    if (!originState) return;
    const originText = drag.originText;
    const finalText = view.state.doc.toString();

    // The preview was a pure reorder; add the blank lines the final position needs, once
    const withSeparators = addBlockSeparators(view.state.doc, drag.block);

    view.setState(originState);
    if (finalText === originText) return;

    const change = minimalChange(originText, withSeparators.text);
    if (!change) return;
    view.dispatch({
      changes: change,
      selection: { anchor: Math.min(withSeparators.anchor, withSeparators.text.length) },
      annotations: [taskDragInternal.of(true), isolateHistory.of('full')],
      userEvent: 'move.drop',
      scrollIntoView: true,
    });
  }

  positionDropLine(gap) {
    const drag = this.drag;
    if (!drag) return;
    const y = gap ? gapScreenY(this.view, gap) : null;
    if (y === null) {
      drag.marker.style.display = 'none';
      return;
    }
    const root = this.view.dom.getBoundingClientRect();
    const content = this.view.contentDOM.getBoundingClientRect();
    drag.marker.style.display = 'block';
    drag.marker.style.top = `${Math.round(y - root.top)}px`;
    drag.marker.style.left = `${Math.round(content.left - root.left)}px`;
    drag.marker.style.width = `${Math.round(content.width)}px`;
  }

  scrollerOf() {
    if (!this.scroller || !this.scroller.isConnected) this.scroller = this.view.dom.closest('.editor-scrollbar');
    return this.scroller;
  }

  // Scroll one step when the pointer rests near an edge, and say whether it moved (a scroll moves
  // the rows under a still pointer, so the target really has changed) and whether to keep going.
  autoScroll(clientY) {
    const scroller = this.scrollerOf();
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return { scrolled: false, atEdge: false };

    const rect = scroller.getBoundingClientRect();
    const edge = 56;
    const step = 14;
    const before = scroller.scrollTop;
    const atTop = clientY < rect.top + edge;
    const atBottom = clientY > rect.bottom - edge;
    if (atTop) scroller.scrollTop -= step;
    else if (atBottom) scroller.scrollTop += step;
    return {
      scrolled: scroller.scrollTop !== before,
      atEdge: (atTop && scroller.scrollTop > 0) || (atBottom && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight),
    };
  }
}, { decorations: (plugin) => plugin.decorations });

// ─── Dragged-block highlight ─────────────────────────────────────────────────

const setTaskDrag = StateEffect.define();

const buildDragDecorations = (state, block) => {
  const { doc } = state;
  const first = doc.lineAt(block.from).number;
  const last = doc.lineAt(block.to).number;
  const decorations = [];
  for (let number = first; number <= last; number++) {
    decorations.push(dragSourceLine.range(doc.line(number).from));
  }
  return Decoration.set(decorations);
};

const taskDragField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTaskDrag)) {
        return effect.value ? buildDragDecorations(tr.state, effect.value) : Decoration.none;
      }
    }
    return tr.docChanged ? Decoration.none : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ─── Geometry ────────────────────────────────────────────────────────────────

// The editor paints no background of its own (the note card does), so a lifted row needs the colour
// of the nearest ancestor that actually paints — otherwise the copy is see-through.
const paintedBackground = (el) => {
  for (let node = el; node; node = node.parentElement) {
    const match = /^rgba?\(([^)]+)\)$/.exec(getComputedStyle(node).backgroundColor);
    if (!match) continue;
    const [r, g, b, alpha = 1] = match[1].split(',').map(Number);
    if (alpha > 0) return `rgb(${r}, ${g}, ${b})`;
  }
  return '#ffffff';
};

// Top of a rendered row in screen coordinates, from its layout position. Transforms are ignored,
// which matters because the rows are sliding while the gaps are measured; a rect would include the
// slide and move every gap under the pointer.
const rowTop = (el) => {
  const parent = el.offsetParent || el.parentElement;
  if (!parent) return el.getBoundingClientRect().top;
  return parent.getBoundingClientRect().top + parent.clientTop + el.offsetTop - parent.scrollTop;
};

// Screen y of the gap before `gap.pos` (or after the last line, for the document end), read from
// the rendered rows. CodeMirror's own height map can lag a frame behind a live move (it refreshes
// on the next measure), which would misplace every gap right after a crossing.
const gapScreenY = (view, gap) => {
  const { doc } = view.state;
  const atEnd = gap.pos >= doc.length;
  const line = doc.lineAt(atEnd ? doc.length : gap.pos);
  const { node } = view.domAtPos(line.from, 1);
  const anchor = node.nodeType === 3 ? node.parentElement : node;
  const el = anchor?.closest?.('.cm-line');
  if (!el) return null;
  return atEnd ? rowTop(el) + el.offsetHeight : rowTop(el);
};

// ─── Sliding rows ────────────────────────────────────────────────────────────

// Pixel height of the rows being lifted, taken from the rendered rows before the change. A
// whole-line move shifts every row in between by exactly this much.
const blockPixelHeight = (view, block) => {
  const { doc } = view.state;
  let height = 0;
  for (let number = block.startLine; number <= block.endLine; number++) {
    height += view.lineBlockAt(doc.line(number).from).height;
  }
  return height;
};

// ─── Blocks and gaps ─────────────────────────────────────────────────────────

// A task owns its line plus any plain continuation lines (not another block)
const getTaskBlock = (state, lineFrom) => {
  const { doc } = state;
  const line = doc.lineAt(lineFrom);
  if (!isTaskLine(line.text) || isCodeLine(state, line.from)) return null;

  let endNumber = line.number;
  for (let number = line.number + 1; number <= doc.lines; number++) {
    const next = doc.line(number);
    if (!next.text.trim() || BLOCK_START_RE.test(next.text)) break;
    endNumber = number;
  }
  return { from: line.from, to: doc.line(endNumber).to, startLine: line.number, endLine: endNumber };
};

// End of the Markdown list item that owns this line, including nested lists and continuations.
const listItemEnd = (state, lineFrom) => {
  let node = syntaxTree(state).resolveInner(lineFrom, 1);
  for (; node; node = node.parent) {
    if (node.name === 'ListItem') return node.to;
  }
  return null;
};

// End of the fenced/indented code block that owns this line.
const codeBlockEnd = (state, lineFrom) => {
  let node = syntaxTree(state).resolveInner(lineFrom, 1);
  for (; node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return node.to;
  }
  return null;
};

// A line that starts a list item, so a task can sit beside it without a blank line in between
const LIST_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;
const isListLine = (text) => LIST_LINE_RE.test(text);

// The marker a new sibling task should use: the same indent and bullet as the current item.
const LIST_PREFIX_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/;
const taskPrefixFor = (text) => {
  const task = taskLineInfo(text);
  if (task) return `${task.indent}${task.bullet} [ ] `;
  const list = LIST_PREFIX_RE.exec(text);
  return list ? `${list[1]}${list[2]} [ ] ` : TASK_PREFIX;
};

// Indent (in columns) of the line starting at `pos`
const lineIndent = (doc, pos) => {
  if (pos >= doc.length) return 0;
  const lead = /^[ \t]*/.exec(doc.lineAt(pos).text)[0];
  return lead.replace(/\t/g, '    ').length;
};

// Prose after a task needs a blank line, or markdown reads it as a lazy continuation of the list
// item. Another list item needs none: that is what keeps a task moved to the end of a list inside
// that list instead of splitting it in two. (Prose *before* a task needs no separator: a bullet
// list can interrupt a paragraph.)
const needsBlank = (text) => text !== null && text.trim() !== '' && !isListLine(text);

// A gap that sits after a list's blank separator still means "append to that list": go back over
// the blank line(s) so the task lands directly under the last item instead of after the gap.
const joinListAbove = (lines, index) => {
  let at = index;
  while (at > 0 && lines[at - 1].trim() === '') at--;
  return at < index && at > 0 && isListLine(lines[at - 1]) ? at : index;
};

// Every place a block can be inserted: before a top-level block, between the items of any list (at
// any depth, so nested tasks stay in their nested list), and the document end. Nothing lands inside
// a paragraph. Each gap carries the indent of the line it sits on; a task only fills gaps at its
// own indent (see `gapAllowed`).
const collectGaps = (state) => {
  const { doc } = state;
  if (!doc.length) return [{ pos: 0, indent: 0 }];

  const gaps = [];
  const seen = new Set();
  const add = (pos, indent = lineIndent(doc, pos)) => {
    if (pos < 0 || pos > doc.length) return;
    const key = `${pos}:${indent}`;
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push({ pos, indent });
  };

  // Every rendered task line can be a drop target at its own indentation, even when the markdown
  // parser does not call it a list item (extra indentation or a list continuation). Code lines are
  // skipped: they do not render a checkbox.
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (isTaskLine(line.text) && !isCodeLine(state, line.from)) add(line.from, lineIndent(doc, line.from));
  }

  const collectList = (list) => {
    let lastLine = null;
    let lastIndent = 0;
    for (let item = list.firstChild; item; item = item.nextSibling) {
      if (item.name !== 'ListItem') continue;
      const indent = lineIndent(doc, item.from);
      // Nested lists hold their own gaps, at their own depth
      for (let child = item.firstChild; child; child = child.nextSibling) {
        if (child.name === 'BulletList' || child.name === 'OrderedList') collectList(child);
      }
      lastLine = doc.lineAt(item.to);
      lastIndent = indent;
    }
    // The gap right after the list, so a task can become its last item without leaving the list
    if (lastLine) add(Math.min(lastLine.to + 1, doc.length), lastIndent);
  };

  const tree = syntaxTree(state);
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === 'BulletList' || node.name === 'OrderedList') collectList(node);
    else add(node.from, 0);
  }
  // A document that starts with blank lines has no node at the very start
  add(0, 0);
  add(doc.length, 0);

  return gaps.sort((a, b) => a.pos - b.pos);
};

// A task only fills gaps at its own indent: a small drag can never yank a nested task out of its
// list, and a top-level task never lands between nested items.
const gapAllowed = (gap, indent) => gap.indent === indent;

// Gaps sit on a list marker (after the indent), while a block starts at its line start: compare
// the lines they belong to, not the raw positions.
const sameLine = (doc, a, b) => doc.lineAt(a).from === doc.lineAt(b).from;

// Smallest change between two versions of the text, so the undo step and the reparse stay small
const minimalChange = (prev, next) => {
  let start = 0;
  const maxStart = Math.min(prev.length, next.length);
  while (start < maxStart && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--;
    endNext--;
  }
  if (start === endPrev && start === endNext) return null;
  return { from: start, to: endPrev, insert: next.slice(start, endNext) };
};

// Where a task block lands when moved into a gap: the text, the change to apply and the block's new
// range. Returned (not applied) so the live-reorder drag can preview it and the drop commit it.
const buildMove = (doc, block, gap, separators = true, options = {}) => {
  const { stripLeadingBlank = false } = options;
  const lines = [];
  for (let number = 1; number <= doc.lines; number++) lines.push(doc.line(number).text);

  const startIdx = block.startLine - 1;
  const count = block.endLine - block.startLine + 1;
  if (startIdx < 0 || startIdx + count > lines.length) return null;

  const moving = lines.slice(startIdx, startIdx + count);
  if (!taskLineInfo(moving[0])) return null;

  const target = gap.pos >= doc.length ? lines.length : doc.lineAt(gap.pos).number - 1;

  // Dropping on itself — above, inside, or in the gap right below (blank lines included) — is a no-op
  const isOwnPlace = (index) => {
    if (index >= startIdx && index <= startIdx + count) return true;
    let above = index - 1;
    while (above >= startIdx + count && lines[above].trim() === '') above--;
    return above === startIdx + count - 1;
  };
  if (isOwnPlace(target)) return null;

  lines.splice(startIdx, count);
  // A block with a blank line on both sides leaves two blank lines behind when it is lifted: the
  // two separators become neighbours. Keep one, so a move never grows the note by an empty line.
  let seam = 0;
  if (startIdx > 0 && startIdx < lines.length
    && lines[startIdx - 1].trim() === '' && lines[startIdx].trim() === '') {
    lines.splice(startIdx, 1);
    seam = 1;
  }
  const insertAt = target > startIdx ? target - count - seam : target;

  const piece = moving.slice();
  const at = separators ? joinListAbove(lines, insertAt) : insertAt;
  if (separators) {
    // Prose directly *after* a task would be read as a lazy continuation of that item, so it needs
    // a blank line. Prose *above* a task does not: a bullet list can interrupt a paragraph, so the
    // task sits straight under it and no space is invented between the prose and the list.
    // The line after the gap, past the blank separator that joining the list above swallows
    const next = insertAt < lines.length ? lines[insertAt] : null;
    if (needsBlank(next)) piece.push('');
  }

  // Joining the list above replaces the blank separator with the task (the gap is still one line)
  lines.splice(at, insertAt - at, ...piece);

  // A task that was at the very top can leave its separator blank behind as a leading blank.
  // Remove it unless the note originally started with one.
  let blockIdx = at;
  if (stripLeadingBlank && lines.length > 1 && lines[0].trim() === '') {
    lines.shift();
    blockIdx = Math.max(0, blockIdx - 1);
  }

  const nextText = lines.join('\n');
  const change = minimalChange(doc.toString(), nextText);
  if (!change) return null;

  let from = 0;
  for (let i = 0; i < blockIdx; i++) from += lines[i].length + 1;
  let to = from;
  for (let i = blockIdx; i < blockIdx + count; i++) {
    to += lines[i].length + (i < blockIdx + count - 1 ? 1 : 0);
  }
  const info = taskLineInfo(lines[blockIdx]) || taskLineInfo(moving[0]);
  const anchor = from + Math.min(info.prefixEnd, lines[blockIdx].length);

  return { change, nextText, anchor, from, to, startLine: blockIdx + 1, endLine: blockIdx + count };
};

// The blank line a task block needs when prose follows it. Used once, on drop, by the live
// reorder preview (which itself only reorders lines), so hovering cannot accumulate empty lines.
// No separator is added above the block: prose above a bullet list needs none.
const addBlockSeparators = (doc, block) => {
  const lines = [];
  for (let number = 1; number <= doc.lines; number++) lines.push(doc.line(number).text);
  const startIdx = block.startLine - 1;
  const count = block.endLine - block.startLine + 1;
  if (startIdx < 0 || startIdx + count > lines.length) return { text: doc.toString(), anchor: block.from };

  const anchorAt = (index, firstText) => {
    const text = lines[index] ?? firstText ?? "";
    const info = taskLineInfo(text);
    let from = 0;
    for (let i = 0; i < index; i++) from += lines[i].length + 1;
    return from + (info ? Math.min(info.prefixEnd, text.length) : 0);
  };

  const at = joinListAbove(lines, startIdx);
  const next = startIdx + count < lines.length ? lines[startIdx + count] : null;
  const piece = lines.slice(startIdx, startIdx + count);
  if (needsBlank(next)) piece.push('');
  if (piece.length === count && at === startIdx) {
    return { text: doc.toString(), anchor: anchorAt(startIdx, lines[startIdx]) };
  }

  // Appending to the list above swallows the blank separator the preview left in front of the task
  lines.splice(at, startIdx - at + count, ...piece);
  return { text: lines.join('\n'), anchor: anchorAt(at, piece[0]) };
};

// Move a whole task block into a gap, as one transaction: undo puts it back in one step, and the
// card/search/agent see a normal task list afterwards.
const moveTaskBlock = (view, block, gap) => {
  const doc = view.state.doc;
  const plan = buildMove(doc, block, gap, true, { stripLeadingBlank: !doc.toString().startsWith('\n') });
  if (!plan) return;
  view.dispatch({
    changes: plan.change,
    selection: { anchor: plan.anchor },
    annotations: isolateHistory.of('full'),
    userEvent: 'move.drop',
    effects: setTaskDrag.of(null),
    scrollIntoView: true,
  });
};

// ─── Actions ─────────────────────────────────────────────────────────────────

const toggleTask = (view, lineFrom) => {
  if (view.state.readOnly) return;
  const line = view.state.doc.lineAt(lineFrom);
  const info = taskLineInfo(line.text);
  if (!info) return;
  const pos = line.from + info.checkPos;

  view.dispatch({
    changes: { from: pos, to: pos + 1, insert: info.checked ? ' ' : 'x' },
    // One checkbox, one undo step: Mod-z after clicking a box unchecks it
    annotations: isolateHistory.of('full'),
    userEvent: 'input.checkbox',
  });
};

// Views where the user actually placed a cursor; without one, "add a checkbox" goes to the bottom
const cursorPlaced = new WeakSet();

const taskCursorTracking = EditorView.domEventHandlers({
  pointerdown: (event, view) => {
    cursorPlaced.add(view);
    return false;
  },
  keydown: (event, view) => {
    cursorPlaced.add(view);
    return false;
  },
});

/**
 * Insert a new checkbox where the user last put the cursor (or at the bottom of the note).
 * Text goes in as a block: after the current line, or on the blank line the cursor is on.
 */
export const insertTask = (view) => {
  if (view.state.readOnly) return false;
  const { doc } = view.state;
  const hasCursor = cursorPlaced.has(view);
  const pos = hasCursor ? Math.min(view.state.selection.main.head, doc.length) : doc.length;

  let change;
  let prefix = TASK_PREFIX;
  if (!doc.length) {
    change = { from: 0, insert: prefix };
  } else {
    const line = doc.lineAt(pos);
    if (isCodeLine(view.state, line.from)) {
      // A code line is not a task: put the new task after the whole code block.
      const end = codeBlockEnd(view.state, line.from);
      if (end === null) return false;
      const nextStart = end < doc.length ? Math.min(end + 1, doc.length) : null;
      const next = nextStart === null ? null : doc.lineAt(nextStart);
      const needsBlankAfter = Boolean(next && next.text.trim() && !BLOCK_START_RE.test(next.text));
      change = { from: end, insert: `\n${prefix}${needsBlankAfter ? '\n' : ''}` };
    } else if (!line.text.trim()) {
      // A blank line already is a block gap: use it as the task's line. Keep any indentation it
      // has, and put the separating blank back when prose follows (the line we are replacing was
      // the only one between them).
      const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
      const needsBlankAfter = Boolean(next && next.text.trim() && !BLOCK_START_RE.test(next.text));
      const indent = /^[ \t]*/.exec(line.text)[0];
      prefix = `${indent}${TASK_PREFIX}`;
      change = { from: line.from, to: line.to, insert: `${prefix}${needsBlankAfter ? '\n' : ''}` };
    } else if (taskLineInfo(line.text) || isListLine(line.text)) {
      // A task/list item: the new one is its sibling, at the same indent and with the same marker.
      // Insert after the whole list item, so nested lists and continuation lines stay with it.
      prefix = taskPrefixFor(line.text);
      const end = listItemEnd(view.state, line.from);
      change = { from: end ?? line.to, insert: `\n${prefix}` };
    } else {
      // Prose: a bullet list can interrupt a paragraph, so no blank is needed above the task.
      // One is still needed after it when another prose line follows.
      const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
      const needsBlankAfter = Boolean(next && next.text.trim() && !BLOCK_START_RE.test(next.text));
      change = { from: line.to, insert: `\n${prefix}${needsBlankAfter ? '\n' : ''}` };
    }
  }

  const prefixOffset = change.insert.indexOf(prefix);
  view.dispatch({
    changes: change,
    selection: { anchor: change.from + prefixOffset + prefix.length },
    annotations: isolateHistory.of('full'),
    userEvent: 'input.insert',
    scrollIntoView: hasCursor,
  });
  return true;
};

// ─── Keyboard while writing a task ───────────────────────────────────────────

// Enter at the end of a task continues the list; on an empty task it ends the list
const continueTask = (view) => {
  if (view.state.readOnly) return false;
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const info = taskLineInfo(line.text);
  if (!info || isCodeLine(view.state, line.from)) return false;
  if (selection.head !== line.to) {
    const block = getTaskBlock(view.state, line.from);
    const next = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : null;
    const hasChild = Boolean(next && next.text.trim()
      && lineIndent(view.state.doc, next.from) > lineIndent(view.state.doc, line.from));
    if (!block || block.endLine !== line.number || hasChild) return false;
    if (selection.head <= line.from + info.prefixEnd) return false;

    const insert = `\n${info.indent}${info.bullet} [ ] `;
    view.dispatch({
      changes: { from: selection.head, insert },
      selection: { anchor: selection.head + insert.length },
      userEvent: 'input',
      scrollIntoView: true,
    });
    return true;
  }

  const text = line.text.slice(info.prefixEnd);
  if (!text.trim()) {
    const doc = view.state.doc;
    let nextNumber = line.number + 1;
    while (nextNumber <= doc.lines && doc.line(nextNumber).text.trim() === '') nextNumber++;
    if (nextNumber <= doc.lines) {
      // The list continues below: remove the empty task and put the caret on the next content,
      // with the now-empty line left as the separator.
      view.dispatch({
        changes: { from: line.from, to: line.to },
        selection: { anchor: doc.line(nextNumber).from },
        annotations: isolateHistory.of('full'),
        userEvent: 'delete',
      });
    } else {
      // Leave the list: one blank line remains between the last task and the new line.
      view.dispatch({
        changes: { from: line.from, to: doc.length, insert: '\n' },
        selection: { anchor: line.from + 1 },
        annotations: isolateHistory.of('full'),
        userEvent: 'delete',
      });
    }
    return true;
  }

  const insert = `\n${info.indent}${info.bullet} [ ] `;
  view.dispatch({
    changes: { from: selection.head, insert },
    selection: { anchor: selection.head + insert.length },
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
};

// Backspace right after the (hidden) marker removes the whole checkbox, turning the line into prose
const removeTaskPrefix = (view) => {
  if (view.state.readOnly) return false;
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const info = taskLineInfo(line.text);
  if (!info || isCodeLine(view.state, line.from)) return false;
  const prefixFrom = line.from + info.indent.length;
  const prefixTo = line.from + info.prefixEnd;
  if (selection.head !== prefixTo) return false;

  view.dispatch({
    changes: { from: prefixFrom, to: prefixTo },
    selection: { anchor: prefixFrom },
    annotations: isolateHistory.of('full'),
    userEvent: 'delete',
  });
  return true;
};

// Above the markdown language's own Enter/Backspace keymap (which also uses Prec.high): inside a
// task we decide, otherwise the event falls through to it
const taskKeymap = Prec.highest(keymap.of([
  { key: 'Enter', run: continueTask },
  { key: 'Backspace', run: removeTaskPrefix },
]));

// The marker is hidden behind the widget: keep the caret out of it, or typing there would edit
// invisible characters (`- [ ]` → `x- [ ]`). Move empty selections to just after the checkbox.
const taskSelectionFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged) return tr;
  if (tr.selection.ranges.length !== 1 || !tr.selection.main.empty) return tr;

  const line = tr.state.doc.lineAt(tr.selection.main.head);
  const info = taskLineInfo(line.text);
  if (!info || isCodeLine(tr.state, line.from)) return tr;

  const prefixTo = line.from + info.prefixEnd;
  if (tr.selection.main.head >= line.from && tr.selection.main.head < prefixTo) {
    return [tr, { selection: { anchor: prefixTo } }];
  }
  return tr;
});

// The replacement behaves as one unit for arrow keys / Home / End
const taskAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(taskListPlugin)?.decorations || Decoration.none,
);

// ─── Styling ─────────────────────────────────────────────────────────────────

const taskTheme = EditorView.theme({
  '.cm-task-widget': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    marginRight: '6px',
    verticalAlign: 'middle',
    lineHeight: '1',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  },
  '.cm-task-grip': {
    width: '8px',
    height: '12px',
    flex: '0 0 auto',
    borderRadius: '3px',
    cursor: 'grab',
    touchAction: 'none',
    opacity: '0.35',
    position: 'relative',
    // 2 × 3 dots, in the platform coral rather than the stone grey
    backgroundImage: 'radial-gradient(circle at 2px 2px, #e85d56 1.1px, transparent 1.2px)',
    backgroundSize: '4px 4px',
    transition: 'opacity 120ms ease',
  },
  // Bigger hit area than the dots suggest, so a finger or a hurried mouse still grabs the row.
  // Kept clear of the checkbox: 4px reaches into the 5px gap without sitting on top of it.
  // Vertical inset stays inside the line box: a taller hit area makes CodeMirror's scroller
  // 4px taller than the line and shifts the text when the caret is revealed.
  '.cm-task-grip::before': {
    content: '""',
    position: 'absolute',
    inset: '-3px -4px',
  },
  '.cm-line:hover .cm-task-grip': { opacity: '0.7' },
  // `&` is the editor element itself, which is where the plugin puts these classes
  '&.cm-task-dragging .cm-task-grip': { cursor: 'grabbing', opacity: '0.7' },
  '.cm-task-check': {
    boxSizing: 'border-box',
    width: '15px',
    height: '15px',
    flex: '0 0 auto',
    margin: '0',
    padding: '0',
    position: 'relative',
    border: '1.6px solid #bfb2a1',
    borderRadius: '4.5px',
    background: 'transparent',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, border-color 120ms ease',
  },
  '.cm-task-check:hover': { borderColor: '#e85d56' },
  '.cm-task-check.is-checked': { backgroundColor: '#e85d56', borderColor: '#e85d56' },
  '.cm-task-check.is-checked::after': {
    content: '""',
    position: 'absolute',
    left: '4px',
    top: '1px',
    width: '4px',
    height: '8px',
    border: 'solid #fff',
    borderWidth: '0 2px 2px 0',
    transform: 'rotate(45deg)',
  },
  '.cm-task-done': {
    color: '#9c9892',
    textDecoration: 'line-through',
    textDecorationColor: 'rgba(156, 152, 146, 0.65)',
  },
  '.cm-task-drag-source': { opacity: '0.35' },
  // 'row' drag: the lifted copy is the only visible copy, so the document's rows become the hole.
  // opacity (not visibility) keeps the row in the accessibility tree and still measures normally.
  '&.cm-task-lifting .cm-task-drag-source': { opacity: '0' },
  '&.cm-task-lifting .cm-task-grip': { opacity: '0.75' },
});

// ─── Extension ───────────────────────────────────────────────────────────────

// `taskDragMode` is provided by whichever Compartment holds it (or defaults to 'row' when absent)
export const markdownTaskList = [
  taskListPlugin,
  taskDragField,
  taskAtomicRanges,
  taskSelectionFilter,
  taskKeymap,
  taskCursorTracking,
  taskTheme,
];
