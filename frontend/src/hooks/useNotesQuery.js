import { useQuery } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';

// Standardized Query Keys
export const QUERY_KEYS = {
  HOME_NOTES: ['notes', 'home'],
  ALL_NOTES: ['notes', 'all'],
  FOLDER_NOTES: (folderId) => ['notes', 'folder', folderId],
  TRASH_NOTES: ['notes', 'trash'],
  ARCHIVED_NOTES: ['notes', 'archived'],
  FOLDERS: ['folders'],
  TRASH_FOLDERS: ['folders', 'trash'],
};

// ─── Query Hooks ─────────────────────────────────────────────────────────────

export const useHomeNotesQuery = (options = {}) => {
  return useQuery({
    queryKey: QUERY_KEYS.HOME_NOTES,
    queryFn: async () => {
      const response = await axiosInstance.get("/get-home-notes");
      return response.data?.notes || [];
    },
    ...options,
  });
};

export const useAllNotesQuery = (options = {}) => {
  return useQuery({
    queryKey: QUERY_KEYS.ALL_NOTES,
    queryFn: async () => {
      const response = await axiosInstance.get("/get-all-notes");
      return response.data?.notes || [];
    },
    ...options,
  });
};

export const useFolderNotesQuery = (folderIds, viewKey, options = {}) => {
  return useQuery({
    queryKey: QUERY_KEYS.FOLDER_NOTES(viewKey || (Array.isArray(folderIds) ? folderIds[0] : folderIds)),
    queryFn: async () => {
      const ids = Array.isArray(folderIds) ? folderIds.join(",") : folderIds;
      const response = await axiosInstance.get(`/get-folder-notes?folderIds=${ids}`);
      return response.data?.notes || [];
    },
    enabled: Boolean((viewKey || folderIds) && (Array.isArray(folderIds) ? folderIds.length > 0 : true)),
    ...options,
  });
};

export const useTrashNotesQuery = (options = {}) => {
  return useQuery({
    queryKey: QUERY_KEYS.TRASH_NOTES,
    queryFn: async () => {
      const response = await axiosInstance.get("/get-trash-notes");
      return response.data?.notes || [];
    },
    ...options,
  });
};

export const useArchivedNotesQuery = (options = {}) => {
  return useQuery({
    queryKey: QUERY_KEYS.ARCHIVED_NOTES,
    queryFn: async () => {
      const response = await axiosInstance.get("/get-all-archived-notes");
      return response.data?.notes || [];
    },
    ...options,
  });
};

export const useFoldersQuery = (options = {}) => {
  return useQuery({
    queryKey: QUERY_KEYS.FOLDERS,
    queryFn: async () => {
      const response = await axiosInstance.get("/get-folders");
      return response.data?.folders || [];
    },
    ...options,
  });
};

export const useTrashFoldersQuery = (options = {}) => {
  return useQuery({
    queryKey: QUERY_KEYS.TRASH_FOLDERS,
    queryFn: async () => {
      const response = await axiosInstance.get("/get-trash-folders");
      return response.data?.folders || [];
    },
    ...options,
  });
};
