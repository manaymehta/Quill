import { useMutation, useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';
import { QUERY_KEYS } from './useNotesQuery';

export const useCreateFolderMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, parentId, color, icon }) => {
      const response = await axiosInstance.post('/create-folder', {
        name,
        parentId: parentId || null,
        color,
        icon,
      });
      return response.data;
    },
    onSuccess: () => {
      if (showToast) showToast("Folder created successfully", "success");
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDERS });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to create folder", "error");
    },
  });
};

export const useEditFolderMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ folderId, patch }) => {
      const response = await axiosInstance.put(`/edit-folder/${folderId}`, patch);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDERS });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to update folder", "error");
    },
  });
};

export const useDeleteFolderMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ folderId, subtreeIds }) => {
      const response = await axiosInstance.delete(`/delete-folder/${folderId}`, {
        data: { folderIdsInSubtree: subtreeIds },
      });
      return response.data;
    },
    onSuccess: () => {
      if (showToast) showToast("Folder moved to Trash", "delete");
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to delete folder", "error");
    },
  });
};

export const useReorderFoldersMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ parentId, updates }) => {
      const response = await axiosInstance.put('/reorder-folders', { parentId: parentId || null, updates });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDERS });
    },
  });
};

export const useRestoreFolderMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (folderId) => {
      const response = await axiosInstance.put(`/restore-folder/${folderId}`);
      return response.data;
    },
    onSuccess: () => {
      if (showToast) showToast("Folder restored successfully", "success");
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to restore folder", "error");
    },
  });
};

export const useDeleteFolderPermanentMutation = (showToast) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (folderId) => {
      const response = await axiosInstance.delete(`/delete-folder-permanent/${folderId}`);
      return response.data;
    },
    onSuccess: () => {
      if (showToast) showToast("Folder deleted permanently", "delete");
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TRASH_FOLDERS });
    },
    onError: (error) => {
      if (showToast) showToast(error.response?.data?.message || "Failed to permanently delete folder", "error");
    },
  });
};
