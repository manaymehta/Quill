import { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { historyField, redo } from '@codemirror/commands';
import { keymap, EditorView } from '@codemirror/view';
import { quillTheme, quillMarkdownHighlight, hideMarkdownSyntax, lineWrap } from '../../utils/markdownEditor';
import { editorRegistry } from '../../utils/editorRegistry';

// Everything in the editor that needs CodeMirror (~600 kB), kept in its own chunk so the rest of the
// editor (toolbar, title, tags, checklist, buttons) shows at once: see markdownEditorLoader.

// With the on-screen keyboard over the editor (utils/virtualKeyboard), the cursor is kept this far
// above it: CodeMirror treats the covered part of the scroll area as out of view. Set from the open
// editor's keyboardOverlap (one text area is live at a time).
const KEYBOARD_GAP_PX = 24;
let keyboardMarginPx = 0;
const keyboardScrollMargin = EditorView.scrollMargins.of(() => ({ bottom: keyboardMarginPx }));

// Mobile keyboard integration:
// 1. Enable rich prose attributes on the contenteditable DOM so Gboard / mobile keyboards enable
//    autocorrect, sentence capitalization, spellcheck, swipe-typing, and spacebar cursor sliding
//    (CodeMirror defaults to autocorrect="off", spellcheck="false" intended for code editors).
const proseContentAttributes = EditorView.contentAttributes.of({
  autocorrect: 'on',
  autocapitalize: 'sentences',
  spellcheck: 'true',
  autocomplete: 'on',
  writingsuggestions: 'true',
  inputmode: 'text',
});

// Phones (Chrome on Android): the keyboard opens only on a tap that places the cursor, not when you
// long-press or drag to select text (it used to open on any focus, shifting the text you were
// selecting up above it). The text area asks for the keyboard itself (virtualkeyboardpolicy=manual);
// a long-press is taken over by the browser's selection (pointercancel) or lasts too long to count
// as a tap. Other browsers keep their own behaviour.
// In addition, we listen for beforeinput replacement/paste events so Gboard clipboard strip chips
// and predictive commits are inserted cleanly without browser DOM desync.
const TAP_MAX_MS = 400;
const TAP_MAX_MOVE_PX = 10;
const showKeyboard = () => navigator.virtualKeyboard?.show();
const setupMobileHandlers = (view, onPasteTextRef) => {
  const dom = view.contentDOM;
  if (!dom) return;

  // Handle Gboard / Android clipboard suggestion chips and text replacements
  dom.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertReplacementText' || e.inputType === 'insertFromPaste') {
      const text = e.dataTransfer?.getData('text/plain') || e.data;
      if (text) {
        e.preventDefault();
        const { state } = view;
        const targetRanges = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
        let from = state.selection.main.from;
        let to = state.selection.main.to;
        if (targetRanges.length > 0) {
          try {
            const r = targetRanges[0];
            from = view.posAtDOM(r.startContainer, r.startOffset);
            to = view.posAtDOM(r.endContainer, r.endOffset);
          } catch {
            // fallback to current selection
          }
        }
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: 'input.paste',
          scrollIntoView: true,
        });
        onPasteTextRef?.current?.(text);
      }
    }
  });

  if (!navigator.virtualKeyboard) return;
  dom.setAttribute('virtualkeyboardpolicy', 'manual');
  let down = null;
  dom.addEventListener('pointerdown', (e) => {
    down = e.pointerType === 'touch' ? { at: e.timeStamp, x: e.clientX, y: e.clientY } : null;
  });
  dom.addEventListener('pointercancel', () => { down = null; });
  dom.addEventListener('pointerup', (e) => {
    if (!down || e.pointerType !== 'touch') return;
    const isTap = e.timeStamp - down.at < TAP_MAX_MS && Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_MAX_MOVE_PX;
    down = null;
    if (!isTap) return;
    // After the tap has placed the cursor; a tap that left text selected doesn't open it
    setTimeout(() => {
      if (view.hasFocus && view.state.selection.main.empty) showKeyboard();
    }, 0);
  });
};

// State fields persisted in editor snapshots (used for both toJSON and fromJSON)
const SNAPSHOT_FIELDS = { history: historyField };

const EDITOR_EXTENSIONS = [
  markdown(),
  quillTheme,
  quillMarkdownHighlight,
  hideMarkdownSyntax,
  lineWrap,
  keyboardScrollMargin,
  proseContentAttributes,
  keymap.of([
    { key: 'Mod-Shift-z', run: redo, preventDefault: true },
  ]),
];

const EDITOR_BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: true,
  dropCursor: true,
  allowMultipleSelections: false,
  indentOnInput: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: false,
  highlightActiveLine: false,
  highlightSelectionMatches: false,
  searchKeymap: false,
};

// The note's live text area. Rehydrates the tab's CodeMirror state (doc, selection, undo/redo
// history) from the in-memory registry; when it closes, saves that snapshot if keepOnClose() says
// the tab is still open and unchanged from outside (a closed tab or an outside change drops it).
// keyboardOverlap: how much of the scroll area the on-screen keyboard covers (px, 0 when closed).
const LiveMarkdownEditor = ({ noteId, value, onChange, viewRef, autoFocus, keepOnClose, keyboardOverlap = 0, onPasteText }) => {
  const onPasteTextRef = useRef(onPasteText);
  useEffect(() => {
    onPasteTextRef.current = onPasteText;
  }, [onPasteText]);

  const initialState = useMemo(() => {
    const snapshot = editorRegistry.getEditorSnapshot(noteId);
    return snapshot ? { json: snapshot, fields: SNAPSHOT_FIELDS } : undefined;
  }, [noteId]);

  const keepOnCloseRef = useRef(keepOnClose);
  useEffect(() => {
    keepOnCloseRef.current = keepOnClose;
  }, [keepOnClose]);
  useEffect(() => () => {
    const view = viewRef.current;
    if (view && keepOnCloseRef.current?.()) {
      editorRegistry.saveEditorSnapshot(noteId, view, SNAPSHOT_FIELDS);
    }
  }, [noteId, viewRef]);

  // The keyboard opening (or resizing): keep the cursor above it, scrolling only the editor's own
  // area, and only if the keyboard covers it
  useEffect(() => {
    keyboardMarginPx = keyboardOverlap > 0 ? keyboardOverlap + KEYBOARD_GAP_PX : 0;
    const view = viewRef.current;
    if (keyboardOverlap > 0 && view?.hasFocus) {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) });
    }
  }, [keyboardOverlap, viewRef]);
  useEffect(() => () => { keyboardMarginPx = 0; }, []);

  // (No snapshot on every keystroke or cursor move: the save above, when the text area closes, is the one
  // that's read back. onChange must stay a stable function: @uiw/react-codemirror reconfigures the whole
  // editor whenever it changes, see AddEditNotes.)
  return (
    <CodeMirror
      value={value}
      initialState={initialState}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
        setupMobileHandlers(view, onPasteTextRef);
        if (autoFocus) view.focus();
      }}
      extensions={EDITOR_EXTENSIONS}
      placeholder="Start typing..."
      basicSetup={EDITOR_BASIC_SETUP}
    />
  );
};

// The agent review's "Before" view: the original text, read-only, in the editor's own look
export const ReadOnlyMarkdown = ({ value }) => (
  <CodeMirror
    value={value}
    editable={false}
    readOnly
    extensions={EDITOR_EXTENSIONS}
    basicSetup={EDITOR_BASIC_SETUP}
  />
);

export default LiveMarkdownEditor;
