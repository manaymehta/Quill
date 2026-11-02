import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import axiosInstance from '../utils/axiosInstance';
import { QUERY_KEYS } from './useNotesQuery';
import { useTabsStore } from '../store/useTabsStore';
import { useToastStore } from '../store/useToastStore';
import { useModalStore } from '../components/Modals/useModalStore';
import { editorRegistry } from '../utils/editorRegistry';
import { noteIndexingFailed } from '../utils/noteIndexing';
import { TOAST, MODAL_MESSAGES } from '../constants/toastMessages';

const isCanceled = (err) => axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED';

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

const findCachedNote = (queryClient, noteId) => {
  for (const [, list] of queryClient.getQueriesData({ queryKey: QUERY_KEYS.NOTES })) {
    const note = Array.isArray(list) && list.find((n) => n._id === noteId);
    if (note) return note;
  }
  return null;
};

const insertAt = (list, note, index) => {
  if (!note || list.some((n) => n._id === note._id)) return list;
  const targetIndex = typeof index === 'number' && index >= 0 && index <= list.length ? index : list.length;
  const next = [...list];
  next.splice(targetIndex, 0, note);
  return next;
};

const inFlightRequests = new Map();

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
      const existing = inFlightRequests.get(noteId);
      if (existing) existing.abort();

      const controller = new AbortController();
      inFlightRequests.set(noteId, controller);
      try {
        const response = await axiosInstance.delete(`/delete-note/${noteId}`, { signal: controller.signal });
        return response.data;
      } finally {
        if (inFlightRequests.get(noteId) === controller) {
          inFlightRequests.delete(noteId);
        }
      }
    },
    // The card leaves every list and joins Trash at once
    onMutate: (variables) => {
      const noteId = noteIdOf(variables);
      if (!noteId || useTabsStore.getState().isTabOpen(noteId)) return {};

      const noteSnapshot = typeof variables === 'object' && variables !== null
        ? variables
        : findCachedNote(queryClient, noteId);
      const indices = new Map();
      for (const [key, list] of queryClient.getQueriesData({ queryKey: QUERY_KEYS.NOTES })) {
        if (!Array.isArray(list)) continue;
        const idx = list.findIndex((n) => n._id === noteId);
        if (idx !== -1) indices.set(key, idx);
      }

      const trashedNote = noteSnapshot
        ? { ...noteSnapshot, isDeleted: true, deletedAt: new Date().toISOString() }
        : null;

      const context = patchNoteLists(queryClient, (key, list) => {
        const name = listName(key);
        if (name === 'trash') {
          return trashedNote && !list.some((n) => n._id === noteId) ? [trashedNote, ...list] : list;
        }
        return without(list, noteId);
      });

      useToastStore.getState().showToast({
        ...TOAST.NOTE_DELETED,
        onUndo: noteId
          ? () => {
              const active = inFlightRequests.get(noteId);
              if (active) {
                active.abort();
                inFlightRequests.delete(noteId);
              }

              patchNoteLists(queryClient, (key, list) => {
                const name = listName(key);
                if (name === 'trash') {
                  return without(list, noteId);
                }
                if (indices.has(key) && noteSnapshot) {
                  return insertAt(list, noteSnapshot, indices.get(key));
                }
                return list;
              });

              const reverseController = new AbortController();
              inFlightRequests.set(noteId, reverseController);
              axiosInstance.put(`/restore-note/${noteId}`, {}, { signal: reverseController.signal })
                .catch((err) => {
                  if (isCanceled(err)) return;
                  patchNoteLists(queryClient, (key, list) => {
                    const name = listName(key);
                    if (name === 'trash') {
                      return trashedNote && !list.some((n) => n._id === noteId) ? [trashedNote, ...list] : list;
                    }
                    return without(list, noteId);
                  });
                  useToastStore.getState().showToast(err.response?.data?.message || "Failed to restore note", "error");
                })
                .finally(() => {
                  if (inFlightRequests.get(noteId) === reverseController) {
                    inFlightRequests.delete(noteId);
                  }
                });
            }
          : null,
      });

      return context;
    },
    onSuccess: () => {},
    onError: (error, _variables, context) => {
      if (isCanceled(error)) return;
      restoreNoteLists(queryClient, context);
      if (error?.message === "NOTE_OPEN_IN_TAB" || error?.suppressToast) return;
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to delete note", "error");
    },
    onSettled: (_data, error) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDER_NOTE_COUNTS });
      if (error && !isCanceled(error) && error.message !== "NOTE_OPEN_IN_TAB" && !error.suppressToast) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
      }
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
      onConfirm: () => mutation.mutate(noteOrId),
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

    mutation.mutate(noteOrId);
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
      const existing = inFlightRequests.get(noteId);
      if (existing) existing.abort();

      const controller = new AbortController();
      inFlightRequests.set(noteId, controller);
      try {
        const response = await axiosInstance.put(`/update-note-archive/${noteId}`, { isArchived }, { signal: controller.signal });
        return response.data;
      } finally {
        if (inFlightRequests.get(noteId) === controller) {
          inFlightRequests.delete(noteId);
        }
      }
    },
    // Archiving: leaves Home, folder, unarchived graph; joins Archive.
    // Unarchiving: leaves Archive; joins Home, folder, graph.
    onMutate: ({ noteId, isArchived, note: passedNote }) => {
      const noteSnapshot = passedNote || findCachedNote(queryClient, noteId);
      const indices = new Map();
      for (const [key, list] of queryClient.getQueriesData({ queryKey: QUERY_KEYS.NOTES })) {
        if (!Array.isArray(list)) continue;
        const idx = list.findIndex((n) => n._id === noteId);
        if (idx !== -1) indices.set(key, idx);
      }

      const applyArchiveState = (targetArchived) => (key, list) => {
        const name = listName(key);
        const item = noteSnapshot ? { ...noteSnapshot, isArchived: targetArchived } : null;

        if (targetArchived) {
          if (name === 'home' || name === 'folder') {
            return without(list, noteId);
          }
          if (name === 'graph') {
            const includeArchived = Boolean(key[2]?.includeArchived);
            if (!includeArchived) return without(list, noteId);
            return item && list.some((n) => n._id === noteId)
              ? list.map((n) => (n._id === noteId ? item : n))
              : list;
          }
          if (name === 'archived') {
            if (!item) return list;
            return list.some((n) => n._id === noteId)
              ? list.map((n) => (n._id === noteId ? item : n))
              : [...list, item];
          }
          return list;
        } else {
          if (name === 'archived') {
            return without(list, noteId);
          }
          if (name === 'home') {
            if (!item) return list;
            const belongsInHome = !item.folderId || item.showInHome === true;
            if (belongsInHome) {
              return list.some((n) => n._id === noteId)
                ? list.map((n) => (n._id === noteId ? item : n))
                : [...list, item];
            }
            return without(list, noteId);
          }
          if (name === 'folder') {
            if (!item) return list;
            const folderId = key[2];
            const belongsInFolder = Boolean(item.folderId) && String(item.folderId) === String(folderId);
            if (belongsInFolder) {
              return list.some((n) => n._id === noteId)
                ? list.map((n) => (n._id === noteId ? item : n))
                : [...list, item];
            }
            return without(list, noteId);
          }
          if (name === 'graph') {
            if (!item) return list;
            return list.some((n) => n._id === noteId)
              ? list.map((n) => (n._id === noteId ? item : n))
              : [...list, item];
          }
          return list;
        }
      };

      const context = patchNoteLists(queryClient, applyArchiveState(isArchived));

      useToastStore.getState().showToast({
        ...(isArchived ? TOAST.NOTE_ARCHIVED : TOAST.NOTE_UNARCHIVED),
        onUndo: noteId
          ? () => {
              const active = inFlightRequests.get(noteId);
              if (active) {
                active.abort();
                inFlightRequests.delete(noteId);
              }

              patchNoteLists(queryClient, (key, list) => {
                if (indices.has(key) && noteSnapshot) {
                  return insertAt(without(list, noteId), noteSnapshot, indices.get(key));
                }
                return applyArchiveState(!isArchived)(key, list);
              });

              const reverseController = new AbortController();
              inFlightRequests.set(noteId, reverseController);
              axiosInstance.put(`/update-note-archive/${noteId}`, { isArchived: !isArchived }, { signal: reverseController.signal })
                .catch((err) => {
                  if (isCanceled(err)) return;
                  patchNoteLists(queryClient, applyArchiveState(isArchived));
                  useToastStore.getState().showToast(err.response?.data?.message || "Failed to reverse archive", "error");
                })
                .finally(() => {
                  if (inFlightRequests.get(noteId) === reverseController) {
                    inFlightRequests.delete(noteId);
                  }
                });
            }
          : null,
      });

      return context;
    },
    onSuccess: () => {},
    onError: (error, _variables, context) => {
      if (isCanceled(error)) return;
      restoreNoteLists(queryClient, context);
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to update note archive", "error");
    },
    onSettled: (_data, error) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDER_NOTE_COUNTS });
      if (error && !isCanceled(error)) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
      }
    },
  });

  const promptToggleArchive = (noteOrId, options = {}) => {
    const noteId = typeof noteOrId === 'string' ? noteOrId : noteOrId?._id;
    if (!noteId) return;

    const isArchived = typeof noteOrId === 'object' && noteOrId !== null
      ? Boolean(noteOrId.isArchived)
      : Boolean(options.isArchived);

    const note = typeof noteOrId === 'object' && noteOrId !== null ? noteOrId : null;

    if (isArchived) {
      if (options.confirmUnarchive) {
        useModalStore.getState().openConfirmModal({
          ...MODAL_MESSAGES.UNARCHIVE_NOTE,
          onConfirm: () => mutation.mutate({ noteId, isArchived: false, note }),
        });
      } else {
        mutation.mutate({ noteId, isArchived: false, note });
      }
    } else {
      useModalStore.getState().openConfirmModal({
        ...MODAL_MESSAGES.ARCHIVE_NOTE,
        onConfirm: () => mutation.mutate({ noteId, isArchived: true, note }),
      });
    }
  };

  return {
    ...mutation,
    promptToggleArchive,
  };
};

const CHECKLIST_MUTATION_KEY = ['checklist-toggle'];

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
    // The new state shows at once on every card of the note; joins or leaves Home immediately
    onMutate: (variables) => {
      const noteId = noteIdOf(variables);
      const current = findCachedNote(queryClient, noteId);
      if (!current) return {};
      const showInHome = !current.showInHome;
      const updated = { ...current, showInHome };
      return patchNoteLists(queryClient, (key, list) => {
        const name = listName(key);
        if (name === 'home') {
          if (showInHome) {
            return list.some((n) => n._id === noteId)
              ? list.map((n) => (n._id === noteId ? updated : n))
              : [...list, updated];
          } else {
            return without(list, noteId);
          }
        }
        return list.some((n) => n._id === noteId)
          ? list.map((n) => (n._id === noteId ? updated : n))
          : list;
      });
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
    // The card leaves the old folder page and arrives at the bottom of the target folder at once
    onMutate: ({ noteId, targetFolderId }) => {
      const noteSnapshot = findCachedNote(queryClient, noteId);
      const updated = noteSnapshot ? { ...noteSnapshot, folderId: targetFolderId } : null;
      return patchNoteLists(queryClient, (key, list) => {
        const name = listName(key);
        if (name === 'folder') {
          if (String(key[2]) === String(targetFolderId ?? '')) {
            return updated && !list.some((n) => n._id === noteId) ? [...list, updated] : list;
          }
          return without(list, noteId);
        }
        if (name === 'home') {
          if (!targetFolderId) {
            return updated && !list.some((n) => n._id === noteId) ? [...list, updated] : list;
          } else if (!updated?.showInHome) {
            return without(list, noteId);
          }
        }
        return list.some((n) => n._id === noteId) && updated
          ? list.map((n) => (n._id === noteId ? updated : n))
          : list;
      });
    },
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDER_NOTE_COUNTS });
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
    mutationFn: async (variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?._id;
      const response = await axiosInstance.put(`/restore-note/${noteId}`);
      return response.data;
    },
    onMutate: (variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?._id;
      const noteSnapshot = typeof variables === 'object' && variables !== null
        ? variables
        : findCachedNote(queryClient, noteId);

      return patchNoteLists(queryClient, (key, list) => {
        const name = listName(key);
        if (name === 'trash') {
          return without(list, noteId);
        }
        if (noteSnapshot && !list.some((n) => n._id === noteId)) {
          const restoredNote = { ...noteSnapshot, isDeleted: false, deletedAt: null };
          if (noteSnapshot.isArchived) {
            if (name === 'archived') {
              return [...list, restoredNote];
            }
            if (name === 'graph' && Boolean(key[2]?.includeArchived)) {
              return [...list, restoredNote];
            }
          } else {
            if (name === 'home' && (!noteSnapshot.folderId || noteSnapshot.showInHome)) {
              return [...list, restoredNote];
            }
            if (name === 'folder' && noteSnapshot.folderId && String(key[2]) === String(noteSnapshot.folderId)) {
              return [...list, restoredNote];
            }
            if (name === 'graph') {
              return [...list, restoredNote];
            }
          }
        }
        return list;
      });
    },
    onSuccess: (data, variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?._id;
      useToastStore.getState().showToast("Note restored successfully", "success");
      // Re-indexing runs after the restore replies; a failure still shows, a moment later
      if (data?.indexing) {
        noteIndexingFailed(noteId).then((failed) => {
          if (failed) useToastStore.getState().showToast("Note restored. Embedding failed.", "warning");
        });
      }
    },
    onError: (error, _variables, context) => {
      restoreNoteLists(queryClient, context);
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to restore note", "error");
    },
    onSettled: (_data, error) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDER_NOTE_COUNTS });
      if (error) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
      }
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
    onMutate: (noteId) => patchNoteLists(queryClient, (key, list) => (
      listName(key) === 'trash' ? without(list, noteId) : list
    )),
    onSuccess: (data) => {
      const embeddingIssue = hasEmbeddingIssue(data);
      useToastStore.getState().showToast(
        embeddingIssue ? "Note deleted permanently. Embedding cleanup failed." : "Note deleted permanently",
        embeddingIssue ? "warning" : "delete"
      );
    },
    onError: (error, _variables, context) => {
      restoreNoteLists(queryClient, context);
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to permanently delete note", "error");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TRASH_NOTES });
    },
  });
};
