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
    onSuccess: (data, variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?.noteId || variables?._id;

      useToastStore.getState().showToast({
        ...TOAST.NOTE_DELETED,
        onUndo: noteId
          ? async () => {
              try {
                await axiosInstance.put(`/restore-note/${noteId}`);
                queryClient.invalidateQueries({ queryKey: ['notes'] });
              } catch (err) {
                useToastStore.getState().showToast(err.response?.data?.message || "Failed to restore note", "error");
              }
            }
          : null,
      });

      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      if (error?.message === "NOTE_OPEN_IN_TAB" || error?.suppressToast) return;
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to delete note", "error");
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
    onSuccess: (data, variables) => {
      const isArchived = variables?.isArchived;
      const noteId = variables?.noteId;

      useToastStore.getState().showToast({
        ...(isArchived ? TOAST.NOTE_ARCHIVED : TOAST.NOTE_UNARCHIVED),
        onUndo: noteId
          ? async () => {
              try {
                await axiosInstance.put(`/update-note-archive/${noteId}`, { isArchived: !isArchived });
                queryClient.invalidateQueries({ queryKey: ['notes'] });
              } catch (err) {
                useToastStore.getState().showToast(err.response?.data?.message || "Failed to reverse archive", "error");
              }
            }
          : null,
      });

      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to update note archive", "error");
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

export const useChecklistToggleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, checklist }) => {
      const response = await axiosInstance.put(`/edit-note/${noteId}`, { checklist });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
};

export const useToggleHomePinMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?.noteId || variables?._id;
      const response = await axiosInstance.put(`/toggle-home-pin/${noteId}`, {});
      return response.data;
    },
    onSuccess: (data, variables) => {
      const isPinned = data?.note?.showInHome ?? (typeof variables === 'object' ? variables.showInHome : true);
      const message = `Note ${isPinned ? "pinned to" : "unpinned from"} Home`;
      useToastStore.getState().showToast(message, "success");
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to toggle pin", "error");
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
    onSuccess: (data, variables) => {
      useToastStore.getState().showToast("Note moved successfully", "success");
      if (variables?.noteId && variables?.targetFolderId !== undefined) {
        useTabsStore.getState().updateTabState(variables.noteId, { folderId: variables.targetFolderId });
        const baseline = editorRegistry.getBaseline(variables.noteId);
        if (baseline) {
          editorRegistry.setBaseline(variables.noteId, { ...baseline, folderId: variables.targetFolderId });
        }
      }
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to move note", "error");
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
      queryClient.invalidateQueries({ queryKey: ['notes'] });
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
