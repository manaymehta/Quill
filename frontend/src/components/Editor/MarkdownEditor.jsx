import { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { historyField, redo } from '@codemirror/commands';
import { keymap } from '@codemirror/view';
import { quillTheme, quillMarkdownHighlight, hideMarkdownSyntax, lineWrap } from '../../utils/markdownEditor';
import { editorRegistry } from '../../utils/editorRegistry';

// Everything in the editor that needs CodeMirror (~600 kB), kept in its own chunk so the rest of the
// editor (toolbar, title, tags, checklist, buttons) shows at once: see markdownEditorLoader.

// State fields persisted in editor snapshots (used for both toJSON and fromJSON)
const SNAPSHOT_FIELDS = { history: historyField };

const EDITOR_EXTENSIONS = [
  markdown(),
  quillTheme,
  quillMarkdownHighlight,
  hideMarkdownSyntax,
  lineWrap,
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
const LiveMarkdownEditor = ({ noteId, value, onChange, viewRef, autoFocus, keepOnClose }) => {
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

  return (
    <CodeMirror
      value={value}
      initialState={initialState}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
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
