import { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { historyField, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { keymap, EditorView } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { quillTheme, quillMarkdownHighlight, hideMarkdownSyntax, lineWrap } from '../../utils/markdownEditor';
import { markdownTaskList, insertTask } from '../../utils/markdownTaskList';
import { editorRegistry } from '../../utils/editorRegistry';

// Everything in the editor that needs CodeMirror (~600 kB), kept in its own chunk so the rest of the
// editor (toolbar, title, tags, checkboxes, buttons) shows at once: see markdownEditorLoader.

// Scoped scroll margin keeps cursor above virtual keyboard without leaking across editor instances
const KEYBOARD_GAP_PX = 24;
const keyboardMarginCompartment = new Compartment();
const keyboardScrollMargin = keyboardMarginCompartment.of(
  EditorView.scrollMargins.of(() => null)
);

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
});

// Phones: dual-layer keyboard management.
// - Layer 1 (virtualkeyboardpolicy): 'manual' on selection avoids popups/scrolling; 'auto' on tap binds Gboard.
// - Layer 2 (inputmode): 'none' suppresses keyboard on selection; 'text' enables typing.
// Thresholds (500ms / 25px) accommodate natural thumb contact squish without dropping taps.
const TAP_MAX_MS = 500;
const TAP_MAX_MOVE_PX = 25;
const showKeyboard = () => navigator.virtualKeyboard?.show();

// Detect open keyboard via VirtualKeyboard API (HTTPS) or visualViewport shrinkage (HTTP fallback)
const isKeyboardOpen = () => {
  const vk = navigator.virtualKeyboard;
  if (vk && typeof vk.boundingRect?.height === 'number') {
    return vk.boundingRect.height > 0;
  }
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv && window.innerHeight > 0) {
    return (window.innerHeight - vv.height) > 100;
  }
  return false;
};

const setupMobileHandlers = (view, onPasteTextRef) => {
  const dom = view.contentDOM;
  if (!dom) return undefined;

  // Handle Gboard / Android clipboard suggestion chips and text replacements
  const handleBeforeInput = (e) => {
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
  };
  dom.addEventListener('beforeinput', handleBeforeInput);

  // Toggle typing ('text'/'auto') vs selection-suppression ('none'/'manual').
  // Attribute equality guards prevent redundant DOM writes and recalculations on touch.
  const setArmedState = (typing) => {
    if (typing) {
      if (dom.getAttribute('inputmode') !== 'text') {
        dom.setAttribute('inputmode', 'text');
      }
      if (navigator.virtualKeyboard && dom.getAttribute('virtualkeyboardpolicy') !== 'auto') {
        dom.setAttribute('virtualkeyboardpolicy', 'auto');
      }
    } else {
      if (dom.getAttribute('inputmode') !== 'none') {
        dom.setAttribute('inputmode', 'none');
      }
      if (navigator.virtualKeyboard && dom.getAttribute('virtualkeyboardpolicy') !== 'manual') {
        dom.setAttribute('virtualkeyboardpolicy', 'manual');
      }
    }
  };

  // Initial state while the keyboard is closed: suppress keyboard on touch-and-hold selection
  setArmedState(false);

  // On HTTP, Android ignores view.focus() if already focused; the momentary blur/focus cycle
  // forces Android to recognize inputmode='text' and open the soft keyboard.
  let isInternalRefocus = false;
  const focusEditorForTyping = () => {
    setArmedState(true);
    if (navigator.virtualKeyboard) {
      view.focus();
      showKeyboard();
    } else {
      if (document.activeElement === dom) {
        isInternalRefocus = true;
        dom.blur();
        view.focus();
        isInternalRefocus = false;
      } else {
        view.focus();
      }
    }
  };
  // Expose focus pipeline on view so parent containers (e.g. AddEditNotes empty-space click) reuse it
  view.focusForTyping = focusEditorForTyping;

  let down = null;
  const onPointerDown = (e) => {
    if (e.pointerType !== 'touch') {
      down = null;
      return;
    }
    down = { at: e.timeStamp, x: e.clientX, y: e.clientY };

    // Disarm on touch down if keyboard is closed so hold-to-select doesn't pop keyboard
    if (!isKeyboardOpen() && dom.getAttribute('inputmode') !== 'none') {
      setArmedState(false);
    }
  };
  const onPointerCancel = () => { down = null; };
  const onPointerUp = (e) => {
    if (!down || e.pointerType !== 'touch') return;
    const isTap = e.timeStamp - down.at < TAP_MAX_MS && Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_MAX_MOVE_PX;
    down = null;
    if (!isTap) return;
    // Next tick lets browser place the cursor; keep closed if tap resulted in text selection
    setTimeout(() => {
      if (view.state.selection.main.empty) {
        focusEditorForTyping();
      }
    }, 0);
  };

  const onBlur = () => {
    if (isInternalRefocus) return;
    setArmedState(false);
  };

  // Android back button dismisses keyboard without firing blur; catch dismissal to disarm
  const onGeometryChange = () => {
    if (!isKeyboardOpen()) {
      setArmedState(false);
    }
  };

  const onVisualViewportResize = () => {
    if (!isKeyboardOpen()) {
      setArmedState(false);
    }
  };

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointercancel', onPointerCancel);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('blur', onBlur);
  navigator.virtualKeyboard?.addEventListener('geometrychange', onGeometryChange);
  window.visualViewport?.addEventListener('resize', onVisualViewportResize);

  return () => {
    delete view.focusForTyping;
    dom.removeEventListener('beforeinput', handleBeforeInput);
    dom.removeEventListener('pointerdown', onPointerDown);
    dom.removeEventListener('pointercancel', onPointerCancel);
    dom.removeEventListener('pointerup', onPointerUp);
    dom.removeEventListener('blur', onBlur);
    navigator.virtualKeyboard?.removeEventListener('geometrychange', onGeometryChange);
    window.visualViewport?.removeEventListener('resize', onVisualViewportResize);
  };
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
  markdownTaskList,
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
const LiveMarkdownEditor = ({ noteId, value, onChange, viewRef, autoFocus, keepOnClose, keyboardOverlap = 0, onPasteText, onHistoryChange, onUserEdit }) => {
  const onPasteTextRef = useRef(onPasteText);
  useEffect(() => {
    onPasteTextRef.current = onPasteText;
  }, [onPasteText]);

  // Tells the toolbar whether there is anything to undo/redo, and reports user edits so an open
  // undo/redo pill closes on typing. Undo/redo transactions are history, not edits: they keep it open.
  // The parent passes stable callbacks, so this extension (and the array below) stays stable too.
  const historyListener = useMemo(() => EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const isHistory = update.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
    if (!isHistory && update.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move.drop'))) {
      onUserEdit?.();
    }
    onHistoryChange?.({
      canUndo: undoDepth(update.state) > 0,
      canRedo: redoDepth(update.state) > 0,
    });
  }), [onUserEdit, onHistoryChange]);

  // Stable array: a new extensions array would reconfigure the whole editor on every render
  const extensions = useMemo(() => [...EDITOR_EXTENSIONS, historyListener], [historyListener]);

  const initialState = useMemo(() => {
    const snapshot = editorRegistry.getEditorSnapshot(noteId);
    return snapshot ? { json: snapshot, fields: SNAPSHOT_FIELDS } : undefined;
  }, [noteId]);

  const keepOnCloseRef = useRef(keepOnClose);
  useEffect(() => {
    keepOnCloseRef.current = keepOnClose;
  }, [keepOnClose]);

  const cleanupMobileHandlersRef = useRef(null);
  useEffect(() => () => {
    cleanupMobileHandlersRef.current?.();
  }, []);

  useEffect(() => () => {
    const view = viewRef.current;
    if (view && keepOnCloseRef.current?.()) {
      editorRegistry.saveEditorSnapshot(noteId, view, SNAPSHOT_FIELDS);
    }
  }, [noteId, viewRef]);

  // Update instance scroll margin when keyboard resizes and scroll cursor into view
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const margin = keyboardOverlap > 0 ? keyboardOverlap + KEYBOARD_GAP_PX : 0;
    const effects = [
      keyboardMarginCompartment.reconfigure(
        EditorView.scrollMargins.of(() => (margin > 0 ? { bottom: margin } : null))
      ),
    ];
    if (keyboardOverlap > 0 && view.hasFocus) {
      effects.push(EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }));
    }
    view.dispatch({ effects });
  }, [keyboardOverlap, viewRef]);

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
        // Undo/redo stay in this chunk: the toolbar only calls these, never CodeMirror itself
        view.quillUndo = () => undo(view);
        view.quillRedo = () => redo(view);
        // Toolbar checkbox button: inserts at the cursor the user last placed (bottom if none)
        view.quillInsertTask = () => insertTask(view);
        onHistoryChange?.({
          canUndo: undoDepth(view.state) > 0,
          canRedo: redoDepth(view.state) > 0,
        });
        cleanupMobileHandlersRef.current?.();
        cleanupMobileHandlersRef.current = setupMobileHandlers(view, onPasteTextRef);
        if (keyboardOverlap > 0) {
          const margin = keyboardOverlap + KEYBOARD_GAP_PX;
          const effects = [
            keyboardMarginCompartment.reconfigure(
              EditorView.scrollMargins.of(() => ({ bottom: margin }))
            ),
          ];
          if (view.hasFocus) {
            effects.push(EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }));
          }
          view.dispatch({ effects });
        }
        if (autoFocus) view.focus();
      }}
      extensions={extensions}
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
