import { useQuery } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';

// Standardized Query Keys
export const QUERY_KEYS = {
  NOTES: ['notes'],       // every note list (and the folder counts): what a note change refreshes
  HOME_NOTES: ['notes', 'home'],
  // Under 'notes' on purpose: every note change already refreshes ['notes'], so the counts follow
  FOLDER_NOTE_COUNTS: ['notes', 'folder-counts'],
  GRAPH_NOTES: (includeArchived) => ['notes', 'graph', { includeArchived: Boolean(includeArchived) }],
  FOLDER_NOTES: (folderId) => ['notes', 'folder', folderId],
  TRASH_NOTES: ['notes', 'trash'],
  ARCHIVED_NOTES: ['notes', 'archived'],
  FOLDERS: ['folders'],   // also the prefix of every folder list
  TRASH_FOLDERS: ['folders', 'trash'],
};

// ─── Query Hooks ─────────────────────────────────────────────────────────────

// One GET whose reply holds the data under `field` (`empty` until it has it)
const listQuery = (queryKey, url, field, empty = []) => function useListQuery(options = {}) {
  return useQuery({
    queryKey,
    queryFn: async () => (await axiosInstance.get(url)).data?.[field] ?? empty,
    ...options,
  });
};

export const useHomeNotesQuery = listQuery(QUERY_KEYS.HOME_NOTES, '/get-home-notes', 'notes');
// { [folderId]: number of notes filed directly in it (not archived, not trashed) }
export const useFolderNoteCountsQuery = listQuery(QUERY_KEYS.FOLDER_NOTE_COUNTS, '/folder-note-counts', 'counts', {});
export const useTrashNotesQuery = listQuery(QUERY_KEYS.TRASH_NOTES, '/get-trash-notes', 'notes');
export const useArchivedNotesQuery = listQuery(QUERY_KEYS.ARCHIVED_NOTES, '/get-all-archived-notes', 'notes');
export const useFoldersQuery = listQuery(QUERY_KEYS.FOLDERS, '/get-folders', 'folders');
export const useTrashFoldersQuery = listQuery(QUERY_KEYS.TRASH_FOLDERS, '/get-trash-folders', 'folders');

export const useGraphNotesQuery = (includeArchived = false, options = {}) =>
  listQuery(QUERY_KEYS.GRAPH_NOTES(includeArchived), `/get-graph-notes?includeArchived=${Boolean(includeArchived)}`, 'notes')(options);

// A folder's own notes (its subfolders show as cards, not in its grid)
export const useFolderNotesQuery = (folderId, options = {}) =>
  listQuery(QUERY_KEYS.FOLDER_NOTES(folderId), `/get-folder-notes?folderIds=${encodeURIComponent(folderId || '')}`, 'notes')({
    enabled: Boolean(folderId),
    ...options,
  });
