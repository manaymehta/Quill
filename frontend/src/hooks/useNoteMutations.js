import { useMutation, useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';
import { QUERY_KEYS } from './useNotesQuery';
import { useTabsStore } from '../store/useTabsStore';
import { useToastStore } from '../store/useToastStore';
import { useModalStore } from '../components/Modals/useModalStore';
import { editorRegistry } from '../utils/editorRegistry';
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

export const useReorderNotesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ updates }) => {
      const response = await axiosInstance.put('/reorder-notes', { updates });
      return response.data;
    },
    onMutate: async ({ reorderedNotes, folderId }) => {
      const queryKey = folderId ? QUERY_KEYS.FOLDER_NOTES(folderId) : QUERY_KEYS.ALL_NOTES;
      await queryClient.cancelQueries({ queryKey });
      const previousNotes = queryClient.getQueryData(queryKey);

      if (reorderedNotes) {
        queryClient.setQueryData(queryKey, reorderedNotes);
      }

      return { previousNotes, queryKey };
    },
    onError: (err, variables, context) => {
      if (context?.previousNotes && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousNotes);
      }
    },
    onSettled: (data, error, variables, context) => {
      if (context?.queryKey) {
        queryClient.invalidateQueries({ queryKey: context.queryKey });
      } else {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ALL_NOTES });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.HOME_NOTES });
      }
    },
  });
};

export const useReorderHomeNotesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ updates }) => {
      const response = await axiosInstance.put('/reorder-home-notes', { updates });
      return response.data;
    },
    onMutate: async ({ reorderedNotes }) => {
      const cancelPromise = queryClient.cancelQueries({ queryKey: QUERY_KEYS.HOME_NOTES });
      const previousNotes = queryClient.getQueryData(QUERY_KEYS.HOME_NOTES);

      if (reorderedNotes) {
        queryClient.setQueryData(QUERY_KEYS.HOME_NOTES, reorderedNotes);
      }

      await cancelPromise;
      return { previousNotes };
    },
    onError: (err, variables, context) => {
      if (context?.previousNotes) {
        queryClient.setQueryData(QUERY_KEYS.HOME_NOTES, context.previousNotes);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.HOME_NOTES });
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
    onSuccess: (data) => {
      const embeddingIssue = hasEmbeddingIssue(data);
      useToastStore.getState().showToast(
        embeddingIssue ? "Note restored. Embedding failed." : "Note restored successfully",
        embeddingIssue ? "warning" : "success"
      );
      queryClient.invalidateQueries({ queryKey: ['notes'] });
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
