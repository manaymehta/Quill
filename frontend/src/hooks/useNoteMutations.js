import { useMutation, useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';
import { QUERY_KEYS } from './useNotesQuery';

export const useDeleteNoteMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId) => {
      const response = await axiosInstance.delete(`/delete-note/${noteId}`);
      return response.data;
    },
    onSuccess: () => {
      if (showToast) showToast("Note moved to Trash", "delete");
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to delete note", "error");
    },
  });
};

export const useArchiveNoteMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, isArchived }) => {
      const response = await axiosInstance.put(`/update-note-archive/${noteId}`, { isArchived });
      return response.data;
    },
    onSuccess: (_, variables) => {
      if (showToast) showToast(`Note ${variables.isArchived ? "archived" : "unarchived"}`, "success");
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to update note archive", "error");
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

export const useToggleHomePinMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId) => {
      const response = await axiosInstance.put(`/toggle-home-pin/${noteId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.HOME_NOTES });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to toggle pin", "error");
    },
  });
};

export const useMoveNoteMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, targetFolderId }) => {
      const response = await axiosInstance.put(`/move-note/${noteId}`, { targetFolderId });
      return response.data;
    },
    onSuccess: () => {
      if (showToast) showToast("Note moved successfully", "success");
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to move note", "error");
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.HOME_NOTES });
    },
  });
};

export const useRestoreNoteMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId) => {
      const response = await axiosInstance.put(`/restore-note/${noteId}`);
      return response.data;
    },
    onSuccess: () => {
      if (showToast) showToast("Note restored successfully", "success");
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to restore note", "error");
    },
  });
};

export const useDeleteTrashNotePermanentMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId) => {
      const response = await axiosInstance.delete(`/delete-trash-note/${noteId}`);
      return response.data;
    },
    onSuccess: () => {
      if (showToast) showToast("Note deleted permanently", "delete");
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TRASH_NOTES });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to permanently delete note", "error");
    },
  });
};
