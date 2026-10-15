/**
 * In-memory registry for CodeMirror runtime state and baseline comparisons.
 * Kept outside of persisted Zustand state to avoid heavy object cloning
 * and unnecessary React re-renders while typing.
 *
 * Must stay free of CodeMirror imports: it is loaded eagerly via useTabsStore,
 * while the editor itself lives in a lazily loaded chunk.
 */

// Map<tabId, CodeMirrorJSONSnapshot>
const snapshots = new Map();

// Map<tabId, { title, content, tags, isChecklist, checklist, folderId }>
const baselines = new Map();

// Map<tabId, { title, content, tags, isChecklist, checklist, folderId }>
const drafts = new Map();

const normalizeTags = (tags) => (Array.isArray(tags) ? [...tags].map(t => String(t).trim()).filter(Boolean) : []);

const normalizeChecklist = (checklist) =>
  Array.isArray(checklist)
    ? checklist
        .filter(Boolean)
        .map(item => ({
          text: String(item?.text || '').trim(),
          completed: Boolean(item?.completed),
        }))
    : [];

const normalizeLinkPreviews = (previews) =>
  Array.isArray(previews)
    ? previews
        .map((p) => (typeof p === 'string' ? p : p?.url || ''))
        .filter(Boolean)
        .sort()
    : [];

export const editorRegistry = {
  /**
   * Capture and save a CodeMirror view's state snapshot. `fields` are the state
   * fields to serialize alongside doc/selection (e.g. { history: historyField }).
   */
  saveEditorSnapshot: (tabId, view, fields) => {
    if (!tabId || !view || !view.state) return;
    try {
      const snapshot = view.state.toJSON(fields);
      snapshots.set(String(tabId), snapshot);
    } catch (err) {
      console.warn('Failed to snapshot editor state for tab:', tabId, err);
    }
  },

  /**
   * Retrieve the serialized CodeMirror snapshot for a tab.
   */
  getEditorSnapshot: (tabId) => {
    if (!tabId) return null;
    return snapshots.get(String(tabId)) || null;
  },

  /**
   * Remove a CodeMirror snapshot when a tab is closed.
   */
  deleteEditorSnapshot: (tabId) => {
    if (!tabId) return;
    snapshots.delete(String(tabId));
  },

  /**
   * Set or update the saved baseline for dirty-state comparisons.
   */
  setBaseline: (tabId, note) => {
    if (!tabId) return;
    baselines.set(String(tabId), {
      title: String(note?.title || '').trim(),
      content: String(note?.content || '').trim(),
      tags: normalizeTags(note?.tags),
      isChecklist: Boolean(note?.isChecklist),
      checklist: normalizeChecklist(note?.checklist),
      folderId: note?.folderId || null,
      linkPreviews: normalizeLinkPreviews(note?.linkPreviews),
      isDraft: Boolean(note?.isDraft),
    });
  },

  /**
   * Get the saved baseline for a tab.
   */
  getBaseline: (tabId) => {
    if (!tabId) return null;
    return baselines.get(String(tabId)) || null;
  },

  /**
   * Delete baseline when a tab is closed.
   */
  deleteBaseline: (tabId) => {
    if (!tabId) return;
    baselines.delete(String(tabId));
  },

  /**
   * Cache current draft values for immediate reference.
   */
  setDraft: (tabId, patch) => {
    if (!tabId) return;
    const key = String(tabId);
    const existing = drafts.get(key) || {};
    drafts.set(key, { ...existing, ...patch });
  },

  /**
   * Get current cached draft values.
   */
  getDraft: (tabId) => {
    if (!tabId) return null;
    return drafts.get(String(tabId)) || null;
  },

  /**
   * Delete cached draft.
   */
  deleteDraft: (tabId) => {
    if (!tabId) return;
    drafts.delete(String(tabId));
  },

  /**
   * Full cleanup for a closed tab.
   */
  cleanupTab: (tabId) => {
    if (!tabId) return;
    const key = String(tabId);
    snapshots.delete(key);
    baselines.delete(key);
    drafts.delete(key);
  },

  /**
   * Check if a tab has unsaved changes compared to its saved baseline.
   */
  isTabDirty: (tabId, currentDraft) => {
    if (!tabId) return false;
    const key = String(tabId);
    const baseline = baselines.get(key);
    const draft = { ...(currentDraft || {}), ...(drafts.get(key) || {}) };

    // If no baseline was recorded (e.g. brand new draft not yet in registry)
    if (!baseline) {
      if (!draft) return false;
      const hasTitle = Boolean(String(draft.title || '').trim());
      const hasContent = Boolean(String(draft.content || '').trim());
      const hasTags = Array.isArray(draft.tags) && draft.tags.length > 0;
      const hasChecklist = Array.isArray(draft.checklist) && draft.checklist.length > 0;
      const hasPreviews = Array.isArray(draft.linkPreviews) && draft.linkPreviews.length > 0;
      const hasFolder = Boolean(draft.folderId);
      const hasChecklistMode = Boolean(draft.isChecklist);
      return hasTitle || hasContent || hasTags || hasChecklist || hasPreviews || hasFolder || hasChecklistMode;
    }

    if (!draft) return false;

    // Compare title & content (trimmed)
    if (String(draft.title || '').trim() !== baseline.title) return true;
    if (String(draft.content || '').trim() !== baseline.content) return true;

    // Compare checklist mode toggle
    if (Boolean(draft.isChecklist) !== baseline.isChecklist) return true;

    // Compare folder assignment
    if ((draft.folderId || null) !== baseline.folderId) return true;

    // Compare tags
    const currentTags = normalizeTags(draft.tags);
    if (currentTags.length !== baseline.tags.length) return true;
    for (let i = 0; i < currentTags.length; i++) {
      if (currentTags[i] !== baseline.tags[i]) return true;
    }

    // Compare checklist items
    const currentChecklist = normalizeChecklist(draft.checklist);
    if (currentChecklist.length !== baseline.checklist.length) return true;
    for (let i = 0; i < currentChecklist.length; i++) {
      if (currentChecklist[i].text !== baseline.checklist[i].text) return true;
      if (currentChecklist[i].completed !== baseline.checklist[i].completed) return true;
    }

    // Compare link previews
    const currentPreviews = normalizeLinkPreviews(draft.linkPreviews);
    const baselinePreviews = baseline.linkPreviews || [];
    if (currentPreviews.length !== baselinePreviews.length) return true;
    for (let i = 0; i < currentPreviews.length; i++) {
      if (currentPreviews[i] !== baselinePreviews[i]) return true;
    }

    return false;
  },
};
