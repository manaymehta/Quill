import { diffLines } from 'diff';
import axiosInstance from './axiosInstance';
import { editorRegistry } from './editorRegistry';
import { useTabsStore } from '../store/useTabsStore';

// How agent edits meet the user's open tabs (architecture plan §2.2, D21):
// - notes open with unsaved changes are sent with the message, so the agent
//   reads and edits what the user sees;
// - an edit to such a note is never applied on its own: the chat asks
//   Apply / Apply & save / Skip, and checks the user hasn't typed since;
// - every applied edit keeps the tab's previous contents for "Revert agent edit".

// Same caps Express enforces. A tab over them isn't sent; edits to it still
// go through the Apply / Skip prompt.
const MAX_UNSAVED_NOTES = 12;
const CONTENT_MAX = 20_000;
const TITLE_MAX = 500;
const TAGS_MAX = 50;
const TAG_CHARS_MAX = 100;
const CHECKLIST_MAX = 100;
const CHECKLIST_TEXT_MAX = 2000;

const NOTE_FIELDS = ['title', 'content', 'tags', 'isChecklist', 'checklist'];

// Line diff for the red/green views. Without ignoreNewlineAtEof, appending a
// line marks the user's (newline-less) last line as removed and re-added.
const lineDiff = (before, after) => diffLines(before, after, { ignoreNewlineAtEof: true });

const isSavedNoteTab = (tab) => Boolean(tab) && !tab.isDraft && !String(tab._id).startsWith('draft-');

// The five editable fields of a note, normalized for comparing and sending.
export const noteFields = (note) => ({
  title: String(note?.title || ''),
  content: String(note?.content || ''),
  tags: Array.isArray(note?.tags) ? note.tags.map(String) : [],
  isChecklist: Boolean(note?.isChecklist),
  checklist: Array.isArray(note?.checklist)
    ? note.checklist.filter(Boolean).map((item) => ({ text: String(item.text || ''), completed: Boolean(item.completed) }))
    : [],
});

// What the user sees in a tab right now: the editor's latest values win over
// the (debounced) tab copy.
const currentTabFields = (tab) => noteFields({ ...tab, ...(editorRegistry.getDraft(tab._id) || {}) });

const sameFields = (a, b) => (
  a.title.trim() === b.title.trim()
  && a.content.trim() === b.content.trim()
  && a.isChecklist === b.isChecklist
  && JSON.stringify(a.tags) === JSON.stringify(b.tags)
  && JSON.stringify(a.checklist) === JSON.stringify(b.checklist)
);

const findTab = (noteId) => useTabsStore.getState().openTabs.find((t) => t._id === noteId);

const isTabDirtyNow = (noteId) => {
  const tab = findTab(noteId);
  return Boolean(tab) && editorRegistry.isTabDirty(tab._id, tab);
};

// Open, saved notes with unsaved changes, as sent to the agent.
export const collectUnsavedNotes = () => {
  const out = [];
  for (const tab of useTabsStore.getState().openTabs) {
    if (out.length >= MAX_UNSAVED_NOTES) break;
    if (!isSavedNoteTab(tab) || !editorRegistry.isTabDirty(tab._id, tab)) continue;
    const fields = currentTabFields(tab);
    const tooBig = fields.content.length > CONTENT_MAX
      || fields.title.length > TITLE_MAX
      || fields.tags.length > TAGS_MAX
      || fields.tags.some((t) => t.length > TAG_CHARS_MAX)
      || fields.checklist.length > CHECKLIST_MAX
      || fields.checklist.some((item) => item.text.length > CHECKLIST_TEXT_MAX);
    if (!tooBig) out.push({ noteId: tab._id, ...fields });
  }
  return out;
};

const draftPatch = (draft) => {
  const patch = {};
  for (const key of NOTE_FIELDS) {
    if (draft[key] !== undefined && draft[key] !== null) patch[key] = draft[key];
  }
  return patch;
};

const fetchNote = async (noteId) => {
  const res = await axiosInstance.get(`/get-note/${noteId}`);
  return res.data?.note || null;
};

/**
 * Apply one agent edit to its note's tab.
 * - `base`: the version the agent edited. If the tab no longer matches it
 *   (the user typed since), returns { status: 'conflict' } unless `force`.
 * - `save`: after applying, the editor runs its normal save once.
 * The tab's previous contents are kept for "Revert agent edit".
 */
export const applyAgentEdit = async ({ noteId, patch, base }, { force = false, save = false } = {}) => {
  let tab = findTab(noteId);
  let note = null;
  if (!tab) {
    try {
      note = await fetchNote(noteId);
    } catch {
      note = null;
    }
    if (!note) return { status: 'failed', reason: 'This note could not be loaded — it may have been deleted.' };
  }

  const current = tab ? currentTabFields(tab) : noteFields(note);
  const proposed = { ...current, ...patch };
  if (!force && base && !sameFields(current, base)) {
    return { status: 'conflict', conflictDiff: lineDiff(current.content, proposed.content) };
  }

  const tabs = useTabsStore.getState();
  if (!tab) {
    if (!tabs.openTab(note)) return { status: 'failed', reason: 'Too many tabs are open. Close one and try again.' };
  }
  tabs.applyExternalUpdate(noteId, {
    ...proposed,
    agentStaged: true,
    agentDiff: patch.content !== undefined ? lineDiff(current.content, proposed.content) : null,
    agentOriginalContent: current.content,
    agentOriginalTitle: current.title,
    agentRevert: current,
    pendingSave: save,
  });
  tabs.setActiveTab(noteId);
  return { status: 'applied', title: proposed.title };
};

/**
 * Turn a reply's drafts into dock tabs or chat prompts.
 * - create → a new unsaved tab (as before);
 * - edit to a note with unsaved changes (now, or when the agent read it) →
 *   a pending prompt for the chat, nothing changes yet;
 * - any other edit → applied to the note's tab right away (as before).
 * `sentSnapshots`: noteId → the unsaved fields sent with the message.
 */
export const stageAgentDrafts = async (drafts, sentSnapshots = {}) => {
  const tabs = useTabsStore.getState();
  const staged = [];
  const pending = [];

  for (const draft of drafts) {
    if (draft.action === 'create') {
      const id = tabs.createDraftTab(draft.folderId ?? null, {
        title: draft.title || '',
        content: draft.content || '',
        tags: draft.tags || [],
        isChecklist: draft.isChecklist ?? false,
        checklist: draft.checklist || [],
        agentStaged: true,
      });
      if (id) staged.push({ kind: 'create', tabId: id, title: draft.title });
      continue;
    }

    if (draft.action !== 'edit' || !draft.noteId) continue;
    const patch = draftPatch(draft);
    if (Object.keys(patch).length === 0) continue;

    if (!draft.basedOnUnsaved && !isTabDirtyNow(draft.noteId)) {
      const result = await applyAgentEdit({ noteId: draft.noteId, patch, base: null }, { force: true });
      if (result.status === 'applied') {
        staged.push({ kind: 'edit', tabId: draft.noteId, title: result.title });
      } else {
        tabs.showTabToast(`Could not stage an edit: ${result.reason}`, 'error');
      }
      continue;
    }

    // Ask first. The base is what the agent edited: the unsaved text sent with
    // the message, or the saved note if the tab only became dirty mid-turn.
    let base = draft.basedOnUnsaved ? sentSnapshots[draft.noteId] : null;
    if (!base) {
      try {
        const note = await fetchNote(draft.noteId);
        base = note ? noteFields(note) : null;
      } catch {
        base = null;
      }
    }
    if (!base) {
      tabs.showTabToast('Could not prepare an edit — the note could not be loaded.', 'error');
      continue;
    }
    const proposed = { ...base, ...patch };
    pending.push({
      noteId: draft.noteId,
      title: proposed.title || base.title,
      patch,
      base,
      basedOnUnsaved: Boolean(draft.basedOnUnsaved),
      diff: patch.content !== undefined ? lineDiff(base.content, proposed.content) : null,
      titleChange: patch.title !== undefined && patch.title !== base.title ? { from: base.title, to: patch.title } : null,
      otherChanges: ['tags', 'isChecklist', 'checklist'].filter((key) => patch[key] !== undefined),
      status: 'pending',
    });
  }

  return { staged, pending };
};
