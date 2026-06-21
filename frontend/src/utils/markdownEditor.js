/**
 * markdownEditor.js
 * Custom CodeMirror 6 extensions for the Quill note editor.
 *
 * Exports:
 *  - quillTheme           : EditorView.theme matching the cream (#f4eadc) aesthetic
 *  - quillMarkdownHighlight : syntaxHighlighting for headings, bold, italic, etc.
 *  - hideMarkdownSyntax   : ViewPlugin that hides syntax markers on non-active lines
 *  - lineWrap             : EditorView.lineWrapping convenience re-export
 */

import { EditorView, ViewPlugin, Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// ─── Cream Theme ────────────────────────────────────────────────────────────
export const quillTheme = EditorView.theme({
  // Root editor element — explicitly set the cream colour so @uiw's built-in
  // light theme (which injects background:#fff) can't win the specificity race.
  '&': {
    backgroundColor: '#f4eadc',
    fontSize: 'inherit',
    fontFamily: "'Lora', Georgia, serif",
    // intentionally no height:'100%' — the outer wrapper div handles scroll
  },

  // Editable content pane
  '.cm-content': {
    caretColor: '#e85d56',
    fontFamily: 'inherit',
    padding: '0',
    // minHeight removed — let content grow naturally
  },

  // Remove the default blue focus ring
  '&.cm-focused': { outline: 'none !important' },

  // Individual text lines
  '.cm-line': {
    color: '#333',
    lineHeight: 'inherit',
    paddingLeft: '0',
    paddingRight: '0',
  },

  // Scrollable panel — no height, no overflow override; the outer wrapper
  // div (`overflow-y-auto`) scrolls, so cm-scroller just shows all content.
  '.cm-scroller': {
    fontFamily: "'Lora', Georgia, serif",
    overflowY: 'visible',
  },

  // Text cursor
  '.cm-cursor': {
    borderLeftColor: '#e85d56',
    borderLeftWidth: '2px',
  },

  // Selection highlight — warm amber tint instead of default blue
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(200,140,80,0.18) !important',
  },

  // Active line — very subtle so it doesn't distract
  '.cm-activeLine': {
    backgroundColor: 'rgba(0,0,0,0.025)',
    borderRadius: '4px',
  },

  // Hide line-number gutter
  '.cm-gutters': { display: 'none' },

  // Placeholder text
  '.cm-placeholder': { color: '#a8a29e', fontStyle: 'normal' },
});

// ─── Markdown Typography Highlight Style ─────────────────────────────────────
export const quillMarkdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    // Headings — sizes scale down from h1 to h6
    { tag: tags.heading1, fontSize: '1.5em',   fontWeight: '700', color: '#1a1a1a', lineHeight: '1.3' },
    { tag: tags.heading2, fontSize: '1.25em',  fontWeight: '700', color: '#1a1a1a' },
    { tag: tags.heading3, fontSize: '1.125em', fontWeight: '600', color: '#2a2a2a' },
    { tag: tags.heading4, fontSize: '1em',     fontWeight: '600', color: '#2a2a2a' },
    { tag: tags.heading5,                        fontWeight: '600', color: '#2a2a2a' },
    { tag: tags.heading6,                        fontWeight: '600', color: '#2a2a2a' },

    // Inline emphasis
    { tag: tags.strong,        fontWeight: '700' },
    { tag: tags.emphasis,      fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through', color: '#9c9892' },

    // Inline code
    {
      tag: tags.monospace,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      backgroundColor: 'rgba(0,0,0,0.06)',
      borderRadius: '3px',
      padding: '1px 4px',
      fontSize: '0.9em',
    },

    // Links
    { tag: tags.link, color: '#d97757', textDecoration: 'underline' },
    { tag: tags.url,  color: '#c4654a' },

    // Blockquote text
    { tag: tags.quote, color: '#78716c', fontStyle: 'italic' },

    // List markers (-, *, 1.) — accent color
    { tag: tags.list, color: '#d97757' },

    // HTML / meta syntax — muted
    { tag: tags.meta,    color: '#a8a29e' },
    { tag: tags.comment, color: '#a8a29e', fontStyle: 'italic' },
  ])
);

// ─── Hide-Syntax Plugin ───────────────────────────────────────────────────────
// On any line where the cursor is NOT present, replace markdown syntax markers
// (##, **, *, ``, ~~) with an invisible widget so the rendered text looks clean.
// The moment the cursor enters that line, the raw markers reappear for editing.

const SYNTAX_MARKS = new Set([
  'HeaderMark',        // #, ##, ###, …
  'EmphasisMark',      // * and _ for italic / bold
  'CodeMark',          // ` backticks for inline code
  'LinkMark',          // [ ] ( ) in links
  'StrikethroughMark', // ~~ (GFM)
]);

/** A zero-width invisible widget. Used to visually erase syntax markers. */
class HideWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  // All instances are equivalent — prevents unnecessary recreations on update
  eq() { return true; }
  ignoreEvent() { return false; }
}

const hiddenDecoration = Decoration.replace({ widget: new HideWidget() });

export const hideMarkdownSyntax = ViewPlugin.fromClass(
  class {
    decorations;

    constructor(view) {
      this.decorations = this.buildDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        // Text changed or user scrolled — always rebuild.
        this.decorations = this.buildDecorations(update.view);
        return;
      }
      if (update.selectionSet) {
        // Cursor moved — only rebuild if it crossed into a DIFFERENT LINE.
        // Horizontal cursor movement within the same line produces the exact
        // same decoration set, so we can safely skip those updates (~90 % of
        // all selectionSet events while the user is typing in prose).
        const prevLine = update.startState.doc
          .lineAt(update.startState.selection.main.head).number;
        const currLine = update.state.doc
          .lineAt(update.state.selection.main.head).number;
        if (prevLine !== currLine) {
          this.decorations = this.buildDecorations(update.view);
        }
      }
    }

    buildDecorations(view) {
      const { state } = view;
      const builder = new RangeSetBuilder();
      // Line number of the cursor's anchor position
      const cursorLine = state.doc.lineAt(state.selection.main.head).number;

      // Only iterate the visible viewport for performance
      syntaxTree(state).iterate({
        from: view.viewport.from,
        to:   view.viewport.to,
        enter(node) {
          if (!SYNTAX_MARKS.has(node.name)) return;
          const nodeLine = state.doc.lineAt(node.from).number;
          // Hide the marker on every line EXCEPT the one the cursor is on
          if (nodeLine !== cursorLine) {
            builder.add(node.from, node.to, hiddenDecoration);
          }
        },
      });

      return builder.finish();
    }
  },
  { decorations: v => v.decorations }
);

// ─── Line Wrap ────────────────────────────────────────────────────────────────
// Re-exported so callers can import everything from one place.
export const lineWrap = EditorView.lineWrapping;
