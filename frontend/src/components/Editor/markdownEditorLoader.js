import { lazy } from 'react';

// The editor's text area and CodeMirror live in their own chunk (MarkdownEditor.jsx); the rest of
// the editor loads with the app, so it shows at once. The chunk is fetched early (idle time after
// the app loads, or pressing a note card), so it's usually there before the editor opens. It used
// to be the whole editor that loaded late, leaving a blank card until it arrived.
export const loadMarkdownEditor = () => import('./MarkdownEditor');
export const preloadMarkdownEditor = () => { loadMarkdownEditor().catch(() => {}); };

export const LiveMarkdownEditor = lazy(loadMarkdownEditor);
export const ReadOnlyMarkdown = lazy(() => loadMarkdownEditor().then((m) => ({ default: m.ReadOnlyMarkdown })));
