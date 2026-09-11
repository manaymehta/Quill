import { useMutation, useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';
import { QUERY_KEYS } from './useNotesQuery';
import { useTabsStore } from '../store/useTabsStore';
import { useToastStore } from '../store/useToastStore';
import { editorRegistry } from '../utils/editorRegistry';

const hasEmbeddingIssue = (data) => ["failed", "partial"].includes(data?.embedding?.status);

export const useDeleteNoteMutation = (legacyShowToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?.noteId || variables?._id;
      if (noteId && useTabsStore.getState().isTabOpen(noteId)) {
        useToastStore.getState().showToast({
          message: "Close the editor tab for this note before deleting.",
          type: "warning",
        });
        const err = new Error("NOTE_OPEN_IN_TAB");
        err.suppressToast = true;
        throw err;
      }
      const response = await axiosInstance.delete(`/delete-note/${noteId}`);
      return response.data;
    },
    onSuccess: (data, variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?.noteId || variables?._id;
      const embeddingIssue = hasEmbeddingIssue(data);
      const message = embeddingIssue
        ? "Note moved to Trash. Embedding cleanup failed."
        : "Note moved to Trash";
      const type = embeddingIssue ? "warning" : "delete";

      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify({
        message,
        type,
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
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(error.response?.data?.message || "Failed to delete note", "error");
    },
  });
};

export const useArchiveNoteMutation = (legacyShowToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, isArchived }) => {
      const response = await axiosInstance.put(`/update-note-archive/${noteId}`, { isArchived });
      return response.data;
    },
    onSuccess: (data, variables) => {
      const isArchived = variables?.isArchived;
      const noteId = variables?.noteId;
      const message = `Note ${isArchived ? "archived" : "unarchived"}`;
      const embeddingIssue = hasEmbeddingIssue(data);

      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify({
        message: embeddingIssue ? `${message}. Embedding update failed.` : message,
        type: embeddingIssue ? "warning" : "success",
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
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(error.response?.data?.message || "Failed to update note archive", "error");
    },
  });
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

export const useToggleHomePinMutation = (legacyShowToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables) => {
      const noteId = typeof variables === 'string' ? variables : variables?.noteId || variables?._id;
      const response = await axiosInstance.put(`/toggle-home-pin/${noteId}`, {});
      return response.data;
    },
    onSuccess: (data, variables) => {
      const isPinned = data?.note?.showInHome ?? (typeof variables === 'object' ? variables.showInHome : true);
      const message = `Note ${isPinned ? "shown on" : "hidden from"} Home`;
      const embeddingIssue = hasEmbeddingIssue(data);
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(
        embeddingIssue ? `${message}. Embedding update failed.` : message,
        embeddingIssue ? "warning" : "success"
      );
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(error.response?.data?.message || "Failed to toggle pin", "error");
    },
  });
};

export const useMoveNoteMutation = (legacyShowToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, targetFolderId }) => {
      const response = await axiosInstance.put(`/move-note/${noteId}`, { targetFolderId });
      return response.data;
    },
    onSuccess: (data, variables) => {
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify("Note moved successfully", "success");
      if (variables?.noteId && variables?.targetFolderId !== undefined) {
        useTabsStore.getState().updateTabState(variables.noteId, { folderId: variables.targetFolderId });
        // Also update the baseline so isTabDirty doesn't flag a false dirty-state
        const baseline = editorRegistry.getBaseline(variables.noteId);
        if (baseline) {
          editorRegistry.setBaseline(variables.noteId, { ...baseline, folderId: variables.targetFolderId });
        }
      }
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
    onError: (error) => {
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(error.response?.data?.message || "Failed to move note", "error");
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

export const useRestoreNoteMutation = (legacyShowToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId) => {
      const response = await axiosInstance.put(`/restore-note/${noteId}`);
      return response.data;
    },
    onSuccess: (data) => {
      const embeddingIssue = hasEmbeddingIssue(data);
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(
        embeddingIssue
          ? "Note restored. Embedding failed."
          : "Note restored successfully",
        embeddingIssue ? "warning" : "success"
      );
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(error.response?.data?.message || "Failed to restore note", "error");
    },
  });
};

export const useDeleteTrashNotePermanentMutation = (legacyShowToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId) => {
      const response = await axiosInstance.delete(`/delete-trash-note/${noteId}`);
      return response.data;
    },
    onSuccess: (data) => {
      const embeddingIssue = hasEmbeddingIssue(data);
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(
        embeddingIssue
          ? "Note deleted permanently. Embedding cleanup failed."
          : "Note deleted permanently",
        embeddingIssue ? "warning" : "delete"
      );
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TRASH_NOTES });
    },
    onError: (error) => {
      const notify = legacyShowToast || useToastStore.getState().showToast;
      notify(error.response?.data?.message || "Failed to permanently delete note", "error");
    },
  });
};
