import { useMutation, useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';
import { QUERY_KEYS } from './useNotesQuery';
import { useTabsStore } from '../store/useTabsStore';
import { useToastStore } from '../store/useToastStore';
import { useModalStore } from '../components/Modals/useModalStore';
import { editorRegistry } from '../utils/editorRegistry';
import { noteIndexingFailed } from '../utils/noteIndexing';
import { TOAST, MODAL_MESSAGES } from '../constants/toastMessages';

const hasEmbeddingIssue = (data) => ["failed", "partial"].includes(data?.embedding?.status);

// A change shown at once: update(key, list) gives each cached notes list its new value (or the same
// list when untouched). The lists are written first and fetches still in flight are then cancelled
// without reverting (as the reorder does), so a fetch that started earlier can't land over the
// change. Returns the previous lists, to put back if the server refuses.
const patchNoteLists = (queryClient, update) => {
  const previous = queryClient.getQueriesData({ queryKey: QUERY_KEYS.NOTES });
  for (const [key, list] of previous) {
    if (!Array.isArray(list)) continue;
    const next = update(key, list);
    if (next !== list) queryClient.setQueryData(key, next);
  }
  queryClient.cancelQueries({ queryKey: QUERY_KEYS.NOTES }, { revert: false });
  return { previous };
};

const restoreNoteLists = (queryClient, context) => {
  context?.previous?.forEach(([key, data]) => queryClient.setQueryData(key, data));
};

const without = (list, noteId) => (list.some((n) => n._id === noteId) ? list.filter((n) => n._id !== noteId) : list);
const noteIdOf = (variables) => (typeof variables === 'string' ? variables : variables?.noteId || variables?._id);
// Cached list keys: ['notes', 'home' | 'archived' | 'trash'], ['notes', 'folder', id], ['notes', 'graph', { includeArchived }]
const listName = (key) => key[1];

export const useDeleteNoteMutation = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?.noteId || variables?._id;
      if (noteId && useTabsStore.getState().isTabOpen(noteId)) {
        useToastStore.getState().showToast(TOAST.TAB_OPEN_WARNING);
        const err = new Error("NOTE_OPEN_IN_TAB");
        err.suppressToast = true;
        throw err;
      }
      const response = await axiosInstance.delete(`/delete-note/${noteId}`);
      return response.data;
    },
    // The card leaves every list but Trash at once
    onMutate: (variables) => {
      const noteId = noteIdOf(variables);
      if (!noteId || useTabsStore.getState().isTabOpen(noteId)) return {};
      return patchNoteLists(queryClient, (key, list) => (listName(key) === 'trash' ? list : without(list, noteId)));
    },
    onSuccess: (data, variables) => {
      const noteId = noteIdOf(variables);

      useToastStore.getState().showToast({
        ...TOAST.NOTE_DELETED,
        onUndo: noteId
          ? async () => {
              try {
                await axiosInstance.put(`/restore-note/${noteId}`);
                queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
              } catch (err) {
                useToastStore.getState().showToast(err.response?.data?.message || "Failed to restore note", "error");
              }
            }
          : null,
      });
    },
    onError: (error, _variables, context) => {
      restoreNoteLists(queryClient, context);
      if (error?.message === "NOTE_OPEN_IN_TAB" || error?.suppressToast) return;
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to delete note", "error");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
    },
  });

  const promptDelete = (noteOrId) => {
    const noteId = typeof noteOrId === 'string' ? noteOrId : noteOrId?._id;
    if (!noteId) return false;

    if (useTabsStore.getState().isTabOpen(noteId)) {
      useToastStore.getState().showToast(TOAST.TAB_OPEN_WARNING);
      return false;
    }

    useModalStore.getState().openConfirmModal({
      ...MODAL_MESSAGES.DELETE_NOTE,
      onConfirm: () => mutation.mutate(noteId),
    });
    return true;
  };

  const mutateWithTabGuard = (noteOrId) => {
    const noteId = typeof noteOrId === 'string' ? noteOrId : noteOrId?._id;
    if (!noteId) return false;

    if (useTabsStore.getState().isTabOpen(noteId)) {
      useToastStore.getState().showToast(TOAST.TAB_OPEN_WARNING);
      return false;
    }

    mutation.mutate(noteId);
    return true;
  };

  return {
    ...mutation,
    promptDelete,
    mutateWithTabGuard,
  };
};

export const useArchiveNoteMutation = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ noteId, isArchived }) => {
      const response = await axiosInstance.put(`/update-note-archive/${noteId}`, { isArchived });
      return response.data;
    },
    // Archiving: the card leaves Home, its folder and the Graph's live view at once. Unarchiving: it
    // leaves Archive. The list it joins shows it after the refresh (it arrives at the bottom).
    onMutate: ({ noteId, isArchived }) => patchNoteLists(queryClient, (key, list) => {
      const name = listName(key);
      const leaves = isArchived
        ? name === 'home' || name === 'folder' || (name === 'graph' && !key[2]?.includeArchived)
        : name === 'archived';
      return leaves ? without(list, noteId) : list;
    }),
    onSuccess: (data, variables) => {
      const isArchived = variables?.isArchived;
      const noteId = variables?.noteId;

      useToastStore.getState().showToast({
        ...(isArchived ? TOAST.NOTE_ARCHIVED : TOAST.NOTE_UNARCHIVED),
        onUndo: noteId
          ? async () => {
              try {
                await axiosInstance.put(`/update-note-archive/${noteId}`, { isArchived: !isArchived });
                queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
              } catch (err) {
                useToastStore.getState().showToast(err.response?.data?.message || "Failed to reverse archive", "error");
              }
            }
          : null,
      });
    },
    onError: (error, _variables, context) => {
      restoreNoteLists(queryClient, context);
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to update note archive", "error");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
    },
  });

  const promptToggleArchive = (noteOrId, options = {}) => {
    const noteId = typeof noteOrId === 'string' ? noteOrId : noteOrId?._id;
    if (!noteId) return;

    const isArchived = typeof noteOrId === 'object' && noteOrId !== null
      ? Boolean(noteOrId.isArchived)
      : Boolean(options.isArchived);

    if (isArchived) {
      if (options.confirmUnarchive) {
        useModalStore.getState().openConfirmModal({
          ...MODAL_MESSAGES.UNARCHIVE_NOTE,
          onConfirm: () => mutation.mutate({ noteId, isArchived: false }),
        });
      } else {
        mutation.mutate({ noteId, isArchived: false });
      }
    } else {
      useModalStore.getState().openConfirmModal({
        ...MODAL_MESSAGES.ARCHIVE_NOTE,
        onConfirm: () => mutation.mutate({ noteId, isArchived: true }),
      });
    }
  };

  return {
    ...mutation,
    promptToggleArchive,
  };
};

const CHECKLIST_MUTATION_KEY = ['checklist-toggle'];

const findCachedNote = (queryClient, noteId) => {
  for (const [, list] of queryClient.getQueriesData({ queryKey: QUERY_KEYS.NOTES })) {
    const note = Array.isArray(list) && list.find((n) => n._id === noteId);
    if (note) return note;
  }
  return null;
};

// Ticking an item on a card. Each tick starts from the newest cached checklist and shows at once
// (patched into every cached list), so a quick second tick can't send the state from before the
// first one and undo it. The lists are re-fetched once, after the last tick in flight settles.
export const useChecklistToggleMutation = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: CHECKLIST_MUTATION_KEY,
    mutationFn: async ({ noteId, checklist }) => {
      const response = await axiosInstance.put(`/edit-note/${noteId}`, { checklist });
      return response.data;
    },
    onMutate: ({ noteId, checklist }) => patchNoteLists(queryClient, (_key, list) => (
      list.some((n) => n._id === noteId) ? list.map((n) => (n._id === noteId ? { ...n, checklist } : n)) : list
    )),
    onError: (_error, _variables, context) => restoreNoteLists(queryClient, context),
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: CHECKLIST_MUTATION_KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
      }
    },
  });

  const toggle = (note, index) => {
    const checklist = [...((findCachedNote(queryClient, note._id) || note).checklist || [])];
    if (!checklist[index]) return;
    checklist[index] = { ...checklist[index], completed: !checklist[index].completed };
    mutation.mutate({ noteId: note._id, checklist });
  };

  return { ...mutation, toggle };
};

// "Home" / "Un Home" on a filed note: shows it on Home as well as in its folder (showInHome)
export const useToggleShowInHomeMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables) => {
      const response = await axiosInstance.put(`/toggle-show-in-home/${noteIdOf(variables)}`, {});
      return response.data;
    },
    // The new state shows at once on every card of the note; whether it joins or leaves Home's
    // list follows with the refresh
    onMutate: (variables) => {
      const noteId = noteIdOf(variables);
      const current = findCachedNote(queryClient, noteId);
      if (!current) return {};
      const showInHome = !current.showInHome;
      return patchNoteLists(queryClient, (_key, list) => (
        list.some((n) => n._id === noteId) ? list.map((n) => (n._id === noteId ? { ...n, showInHome } : n)) : list
      ));
    },
    onSuccess: (data) => {
      useToastStore.getState().showToast(data?.note?.showInHome ? TOAST.NOTE_ADDED_TO_HOME : TOAST.NOTE_REMOVED_FROM_HOME);
    },
    onError: (error, _variables, context) => {
      restoreNoteLists(queryClient, context);
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to update Home", "error");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
    },
  });
};

export const useMoveNoteMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, targetFolderId }) => {
      const response = await axiosInstance.put(`/move-note/${noteId}`, { targetFolderId });
      return response.data;
    },
    // The card leaves the folder page it was on at once; the folder it moves to shows it after the
    // refresh (it arrives at the bottom), as does Home when the move changes whether it's there
    onMutate: ({ noteId, targetFolderId }) => patchNoteLists(queryClient, (key, list) => (
      listName(key) === 'folder' && String(key[2]) !== String(targetFolderId ?? '') ? without(list, noteId) : list
    )),
    onSuccess: (data, variables) => {
      useToastStore.getState().showToast("Note moved successfully", "success");
      if (variables?.noteId && variables?.targetFolderId !== undefined) {
        useTabsStore.getState().updateTabState(variables.noteId, { folderId: variables.targetFolderId });
        const baseline = editorRegistry.getBaseline(variables.noteId);
        if (baseline) {
          editorRegistry.setBaseline(variables.noteId, { ...baseline, folderId: variables.targetFolderId });
        }
      }
    },
    onError: (error, _variables, context) => {
      restoreNoteLists(queryClient, context);
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to move note", "error");
    },
    // ['folders'] isn't refreshed: the folder list holds no note counts (those live under 'notes')
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
    },
  });
};

// The cached list each orderable grid shows (Trash has no order)
const ORDER_LIST_KEYS = {
  home: () => QUERY_KEYS.HOME_NOTES,
  folder: (folderId) => QUERY_KEYS.FOLDER_NOTES(folderId),
  archive: () => QUERY_KEYS.ARCHIVED_NOTES,
};

// The visible notes (`ids`, in their new order) take over the places they held
// in the full list; notes hidden by a search keep theirs. The server does the
// same (note-order.service reorderList), so the cache matches what it saves.
const reorderInPlace = (notes, ids) => {
  const moved = new Set(ids);
  const byId = new Map(notes.map((n) => [n._id, n]));
  let next = 0;
  return notes.map((n) => (moved.has(n._id) ? byId.get(ids[next++]) : n));
};

// A drag in one list: { list: 'home' | 'folder' | 'archive', folderId, ids }.
// The cache is updated before anything is awaited, so the grid shows the drop
// on the very next frame.
export const useReorderNotesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ list, folderId, ids }) => {
      const response = await axiosInstance.put('/reorder-notes', { list, folderId, ids });
      return response.data;
    },
    onMutate: async ({ list, folderId, ids }) => {
      const queryKey = ORDER_LIST_KEYS[list](folderId);
      const previousNotes = queryClient.getQueryData(queryKey);
      if (previousNotes) queryClient.setQueryData(queryKey, reorderInPlace(previousNotes, ids));
      // revert: false — a cancelled fetch would otherwise put back the list from before this drop
      await queryClient.cancelQueries({ queryKey }, { revert: false });
      return { previousNotes, queryKey };
    },
    onError: (err, variables, context) => {
      if (context?.previousNotes) {
        queryClient.setQueryData(context.queryKey, context.previousNotes);
      }
    },
    onSettled: (data, error, variables, context) => {
      if (context?.queryKey) queryClient.invalidateQueries({ queryKey: context.queryKey });
    },
  });
};

export const useRestoreNoteMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId) => {
      const response = await axiosInstance.put(`/restore-note/${noteId}`);
      return response.data;
    },
    onSuccess: (data, noteId) => {
      useToastStore.getState().showToast("Note restored successfully", "success");
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
      // Re-indexing runs after the restore replies; a failure still shows, a moment later
      if (data?.indexing) {
        noteIndexingFailed(noteId).then((failed) => {
          if (failed) useToastStore.getState().showToast("Note restored. Embedding failed.", "warning");
        });
      }
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to restore note", "error");
    },
  });
};

export const useDeleteTrashNotePermanentMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId) => {
      const response = await axiosInstance.delete(`/delete-trash-note/${noteId}`);
      return response.data;
    },
    onSuccess: (data) => {
      const embeddingIssue = hasEmbeddingIssue(data);
      useToastStore.getState().showToast(
        embeddingIssue ? "Note deleted permanently. Embedding cleanup failed." : "Note deleted permanently",
        embeddingIssue ? "warning" : "delete"
      );
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TRASH_NOTES });
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to permanently delete note", "error");
    },
  });
};
