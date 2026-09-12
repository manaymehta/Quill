/**
 * Core Toast Presets and Confirmation Modal Configurations.
 * 
 * Only holds constants for actions with custom dock labels/Undo
 * and shared modal dialogs. Standard dynamic errors flow naturally
 * via showToast(errorMessage, 'error').
 */

export const TOAST = {
  TAB_OPEN_WARNING: {
    label: 'Close editor tab to delete',
    message: 'Close editor tab to delete',
    type: 'warning',
  },
  NOTE_DELETED: {
    label: 'Deleted',
    message: 'Note moved to Trash',
    type: 'delete',
  },
  NOTE_ARCHIVED: {
    label: 'Archived',
    message: 'Note archived',
    type: 'archive',
  },
  NOTE_UNARCHIVED: {
    label: 'Unarchived',
    message: 'Note unarchived',
    type: 'success',
  },
};

export const MODAL_MESSAGES = {
  DELETE_NOTE: {
    title: 'Delete note?',
    message: 'This moves the note to Trash.',
    confirmLabel: 'Yes',
    variant: 'danger',
  },
  ARCHIVE_NOTE: {
    title: 'Archive note?',
    message: 'This moves the note to Archive.',
    confirmLabel: 'Archive',
    variant: 'warning',
  },
  UNARCHIVE_NOTE: {
    title: 'Unarchive note?',
    message: 'This moves the note back to Home.',
    confirmLabel: 'Unarchive',
    variant: 'warning',
  },
  PERMANENT_DELETE_NOTE: {
    title: 'Delete permanently?',
    message: 'This cannot be undone. Are you sure you want to permanently delete this note?',
    confirmLabel: 'Delete forever',
    variant: 'danger',
  },
  PERMANENT_DELETE_FOLDER: (folderName) => ({
    title: 'Delete folder permanently?',
    message: `Are you sure you want to permanently delete "${folderName}"? This action cannot be undone.`,
    confirmLabel: 'Delete forever',
    variant: 'danger',
  }),
  DISCARD_UNSAVED_CHANGES: {
    title: 'Discard unsaved changes?',
    message: 'This note has unsaved changes. Closing this tab will discard them.',
    confirmLabel: 'Discard',
    variant: 'danger',
  },
};
