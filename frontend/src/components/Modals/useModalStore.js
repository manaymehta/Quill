import { create } from 'zustand';

export const useModalStore = create((set) => ({
  // Generic Confirm Modal
  confirmModal: {
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Yes',
    variant: 'danger',
    onConfirm: null,
  },
  openConfirmModal: ({ title, message, confirmLabel = 'Yes', variant = 'danger', onConfirm }) =>
    set({
      confirmModal: {
        isOpen: true,
        title,
        message,
        confirmLabel,
        variant,
        onConfirm,
      },
    }),
  closeConfirmModal: () =>
    set((state) => ({
      confirmModal: {
        ...state.confirmModal,
        isOpen: false,
      },
    })),

  // Folder Delete Modal
  folderDeleteModal: {
    isOpen: false,
    folder: null,
    onConfirm: null,
  },
  openFolderDeleteModal: (folder, onConfirm) =>
    set({
      folderDeleteModal: {
        isOpen: true,
        folder,
        onConfirm,
      },
    }),
  closeFolderDeleteModal: () =>
    set((state) => ({
      folderDeleteModal: {
        ...state.folderDeleteModal,
        isOpen: false,
      },
    })),
}));
