import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import NotesGrid from '../../components/Cards/NotesGrid';
import AiSearchPanel from '../../components/Cards/AiSearchPanel';
import Toast from '../../components/ToastMessage/Toast';
import { useSearchStore } from '../../store/useSearchStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useFolderNotesQuery, useFoldersQuery } from '../../hooks/useNotesQuery';
import { useDeleteNoteMutation, useArchiveNoteMutation, useChecklistToggleMutation, useToggleHomePinMutation, useMoveNoteMutation } from '../../hooks/useNoteMutations';
import { useEditFolderMutation } from '../../hooks/useFolderMutations';
import FoldersGrid from '../../components/Cards/FoldersGrid';
import Breadcrumb from '../../components/Cards/Breadcrumb';
import { useModalStore } from '../../components/Modals/useModalStore';
import { MdOutlineFolder, MdOutlineStickyNote2 } from 'react-icons/md';

const FolderView = () => {
  const { folderId } = useParams();
  const navigate = useNavigate();

  const { data: folders = [] } = useFoldersQuery();
  const getSubtreeIds = useFoldersStore((state) => state.getSubtreeIds);

  const subtreeIds = useMemo(() => getSubtreeIds(folders, folderId), [folders, folderId, getSubtreeIds]);
  const { data: folderNotes = [], isLoading } = useFolderNotesQuery(subtreeIds, folderId);

  const searchQuery = useSearchStore((state) => state.searchQuery);
  const searchMode = useSearchStore((state) => state.searchMode);
  const semanticResult = useSearchStore((state) => state.semanticResult);
  const isSearchingAI = useSearchStore((state) => state.isSearchingAI);
  const { openTab } = useTabsStore();

  const [showToast, setShowToast] = useState(false);
  const [isAddingFolder, setIsAddingFolder] = useState(false);

  const { openFolderDeleteModal, openConfirmModal } = useModalStore();
  const [toastMessageVisibility, setToastMessageVisibility] = useState({
    isShown: false,
    message: '',
    type: 'add',
  });

  const showToastMessage = useCallback((message, type) => {
    setToastMessageVisibility({ isShown: true, message, type });
    setShowToast(true);
  }, []);

  const deleteNoteMutation = useDeleteNoteMutation(showToastMessage);
  const archiveNoteMutation = useArchiveNoteMutation(showToastMessage);
  const toggleHomePinMutation = useToggleHomePinMutation(showToastMessage);
  const moveNoteMutation = useMoveNoteMutation(showToastMessage);
  const checklistToggleMutation = useChecklistToggleMutation();
  const editFolderMutation = useEditFolderMutation(showToastMessage);

  // Redirect if folder doesn't exist
  useEffect(() => {
    if (folders.length > 0 && !folders.some(f => f._id === folderId)) {
      navigate("/dashboard");
    }
  }, [folderId, folders, navigate]);

  // Set active folder & search scope context
  useEffect(() => {
    useFoldersStore.getState().setActiveFolderId(folderId);
    useSearchStore.getState().setSearchScope("folder");
    return () => {
      useFoldersStore.getState().setActiveFolderId(null);
      useSearchStore.getState().setSearchScope("home");
      useSearchStore.getState().setScopeFolderIds([]);
    };
  }, [folderId]);

  const subtreeKey = useMemo(() => subtreeIds.join(','), [subtreeIds]);

  // Sync search scope folder IDs with subtree
  useEffect(() => {
    useSearchStore.getState().setScopeFolderIds(subtreeIds);
  }, [subtreeKey, subtreeIds]);

  const handleCloseToast = useCallback(() => {
    setToastMessageVisibility((prev) => ({ ...prev, isShown: false }));
    setTimeout(() => setShowToast(false), 400);
  }, []);

  useEffect(() => {
    if (toastMessageVisibility.isShown) {
      const t = setTimeout(handleCloseToast, 3000);
      return () => clearTimeout(t);
    }
  }, [toastMessageVisibility.isShown, handleCloseToast]);

  const handleEdit = useCallback((note) => openTab(note), [openTab]);

  const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);

  // Subfolders list (direct children only)
  const subfolders = folders.filter(f => f.parentId === folderId && !f.isDeleted)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  
  // For explorer mode: direct notes only
  const directNotes = folderNotes.filter(n => n.folderId === folderId);

  const displayedDirectNotes = useMemo(() => {
    if (searchMode === 'keyword' && searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return directNotes.filter(n =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.content && n.content.toLowerCase().includes(q)) ||
        (n.tags && n.tags.some(t => t.toLowerCase().includes(q)))
      );
    }
    return directNotes;
  }, [directNotes, searchMode, searchQuery]);

  const handleRenameFolder = (id, newName) => {
    editFolderMutation.mutate({ folderId: id, patch: { name: newName } });
  };

  const handleColorChangeFolder = (id, color) => {
    editFolderMutation.mutate({ folderId: id, patch: { color } });
  };

  const handleDeleteFolder = (folderObj) => {
    openFolderDeleteModal(folderObj);
  };

  const handleDeleteNoteClick = (note) => {
    openConfirmModal({
      title: "Delete note?",
      message: "This moves the note to Trash.",
      onConfirm: () => deleteNoteMutation.mutate(note._id)
    });
  };

  const handleArchiveToggle = (note) => {
    if (note.isArchived) {
      archiveNoteMutation.mutate({ noteId: note._id, isArchived: false });
    } else {
      openConfirmModal({
        title: "Archive note?",
        message: "This moves the note to Archive.",
        confirmLabel: "Archive",
        variant: "warning",
        onConfirm: () => archiveNoteMutation.mutate({ noteId: note._id, isArchived: true })
      });
    }
  };

  const handleToggleHome = (note) => {
    toggleHomePinMutation.mutate(note._id);
  };

  const handleMoveNote = (noteId, targetFolderId) => {
    moveNoteMutation.mutate({ noteId, targetFolderId });
  };

  const handleChecklist = (note, index) => {
    const newChecklist = [...(note.checklist || [])];
    if (newChecklist[index]) {
      newChecklist[index] = { ...newChecklist[index], completed: !newChecklist[index].completed };
    }
    checklistToggleMutation.mutate({ noteId: note._id, checklist: newChecklist });
  };

  return (
    <div className="relative min-h-0">
      <div className="pb-24 px-2 md:px-4">
        <div className="mb-3">
          <Breadcrumb folderId={folderId} />
        </div>
        {isAIMode ? (
          <div className="flex flex-col-reverse md:flex-row gap-4">
            <div className="flex-1 min-w-0">
              {isSearchingAI ? (
                <div className="flex flex-col items-center justify-center mt-20 opacity-50 animate-pulse">
                  <p className="text-sm font-medium text-slate-400 text-center">
                    Analyzing context across your notes...
                  </p>
                </div>
              ) : (
                <NotesGrid
                  notes={semanticResult?.sourceNotes || []}
                  loading={isLoading}
                  emptyMessage="No matching notes found."
                  onEdit={handleEdit}
                  onDelete={handleDeleteNoteClick}
                  onArchive={handleArchiveToggle}
                  onToggleHome={handleToggleHome}
                  onMove={handleMoveNote}
                  onChecklistToggle={handleChecklist}
                  allowDrag={false}
                />
              )}
            </div>
            <div className="w-full md:w-1/3 shrink-0">
              <AiSearchPanel />
            </div>
          </div>
        ) : (
          <div>
            <div className="space-y-3">
              <div>
                <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-3 flex items-center">
                  <MdOutlineFolder className="mr-2" size={16} />
                  Folders
                </h3>
                <FoldersGrid
                  folders={subfolders}
                  parentId={folderId}
                  onRename={handleRenameFolder}
                  onColorChange={handleColorChangeFolder}
                  onDelete={handleDeleteFolder}
                  isAddingFolder={isAddingFolder}
                  setIsAddingFolder={setIsAddingFolder}
                />
              </div>

              {displayedDirectNotes.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-3 flex items-center">
                    <MdOutlineStickyNote2 className="mr-2" size={16} />
                    Notes
                  </h3>
                  <NotesGrid
                    notes={displayedDirectNotes}
                    loading={isLoading}
                    emptyMessage="No notes in this folder."
                    onEdit={handleEdit}
                    onDelete={handleDeleteNoteClick}
                    onArchive={handleArchiveToggle}
                    onToggleHome={handleToggleHome}
                    onMove={handleMoveNote}
                    onChecklistToggle={handleChecklist}
                    hideFolderBadge={true}
                  />
                </div>
              )}

              {!isLoading && subfolders.length === 0 && directNotes.length === 0 && (
                <div className="flex flex-col items-center justify-center mt-20 opacity-50">
                  <p className="text-sm font-medium text-slate-400 text-center">
                    This folder is empty.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showToast && (
        <Toast
          isShown={toastMessageVisibility.isShown}
          message={toastMessageVisibility.message}
          type={toastMessageVisibility.type}
          onClose={handleCloseToast}
        />
      )}
    </div>
  );
};

export default FolderView;
