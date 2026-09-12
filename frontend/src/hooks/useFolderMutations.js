import { useMutation, useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';
import { QUERY_KEYS } from './useNotesQuery';
import { useToastStore } from '../store/useToastStore';

export const useCreateFolderMutation = () => {
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
      useToastStore.getState().showToast("Folder created successfully", "success");
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDERS });
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to create folder", "error");
    },
  });
};

export const useEditFolderMutation = () => {
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
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to update folder", "error");
    },
  });
};

export const useDeleteFolderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ folderId }) => {
      const response = await axiosInstance.delete(`/delete-folder/${folderId}`);
      return response.data;
    },
    onSuccess: () => {
      useToastStore.getState().showToast("Folder moved to Trash", "delete");
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to delete folder", "error");
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

export const useRestoreFolderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (folderId) => {
      const response = await axiosInstance.put(`/restore-folder/${folderId}`);
      return response.data;
    },
    onSuccess: () => {
      useToastStore.getState().showToast("Folder restored successfully", "success");
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to restore folder", "error");
    },
  });
};

export const useDeleteFolderPermanentMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (folderId) => {
      const response = await axiosInstance.delete(`/delete-folder-permanent/${folderId}`);
      return response.data;
    },
    onSuccess: () => {
      useToastStore.getState().showToast("Folder deleted permanently", "delete");
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TRASH_FOLDERS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TRASH_NOTES });
    },
    onError: (error) => {
      useToastStore.getState().showToast(error.response?.data?.message || "Failed to permanently delete folder", "error");
    },
  });
};
