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

// Phones (Chrome on Android): the keyboard opens only on a tap that places the cursor, not when you
// long-press or drag to select text (it used to open on any focus, shifting the text you were
// selecting up above it). The text area asks for the keyboard itself (virtualkeyboardpolicy=manual);
// a long-press is taken over by the browser's selection (pointercancel) or lasts too long to count
// as a tap. Other browsers keep their own behaviour.
const TAP_MAX_MS = 400;
const TAP_MAX_MOVE_PX = 10;
const showKeyboard = () => navigator.virtualKeyboard?.show();
const keyboardOnTapOnly = (view) => {
  if (!navigator.virtualKeyboard) return;
  const dom = view.contentDOM;
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
// history) from the in-memory registry and keeps that snapshot current; when it closes, saves it
// once more if keepOnClose() says the tab is still open and unchanged from outside.
// keyboardOverlap: how much of the scroll area the on-screen keyboard covers (px, 0 when closed).
const LiveMarkdownEditor = ({ noteId, value, onChange, viewRef, autoFocus, keepOnClose, keyboardOverlap = 0 }) => {
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

  return (
    <CodeMirror
      value={value}
      initialState={initialState}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
        keyboardOnTapOnly(view);
        if (autoFocus) view.focus();
      }}
      onUpdate={(viewUpdate) => {
        if (viewUpdate.docChanged || viewUpdate.selectionSet) {
          editorRegistry.saveEditorSnapshot(noteId, viewUpdate.view, SNAPSHOT_FIELDS);
        }
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
