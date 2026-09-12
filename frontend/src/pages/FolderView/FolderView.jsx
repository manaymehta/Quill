import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import NotesGrid from '../../components/Cards/NotesGrid';
import AiSearchPanel from '../../components/Cards/AiSearchPanel';
import { useSearchStore } from '../../store/useSearchStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useToastStore } from '../../store/useToastStore';
import { useFoldersQuery, useFolderNotesQuery } from '../../hooks/useNotesQuery';
import { buildFolderHierarchy } from '../../utils/folderHierarchy';
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
  const folderHierarchy = useMemo(() => buildFolderHierarchy(folders), [folders]);
  const subtreeIds = useMemo(() => folderHierarchy.getSubtreeIds(folderId), [folderHierarchy, folderId]);
  const { data: folderNotes = [], isLoading } = useFolderNotesQuery(subtreeIds, folderId);

  const searchQuery = useSearchStore((state) => state.searchQuery);
  const searchMode = useSearchStore((state) => state.searchMode);
  const semanticResult = useSearchStore((state) => state.semanticResult);
  const isSearchingAI = useSearchStore((state) => state.isSearchingAI);
  const openTab = useTabsStore((state) => state.openTab);

  const [isAddingFolder, setIsAddingFolder] = useState(false);

  const { openFolderDeleteModal } = useModalStore();

  const { promptDelete } = useDeleteNoteMutation();
  const { promptToggleArchive } = useArchiveNoteMutation();
  const toggleHomePinMutation = useToggleHomePinMutation();
  const moveNoteMutation = useMoveNoteMutation();
  const checklistToggleMutation = useChecklistToggleMutation();
  const editFolderMutation = useEditFolderMutation();

  // Redirect if folder doesn't exist
  useEffect(() => {
    if (folders.length > 0 && !folderHierarchy.foldersById.has(String(folderId))) {
      navigate("/dashboard");
    }
  }, [folderId, folders.length, folderHierarchy, navigate]);

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

  const handleEdit = useCallback((note) => openTab(note), [openTab]);

  const isAIMode = searchMode === 'semantic' && (isSearchingAI || semanticResult);

  // Subfolders list (direct children only)
  const subfolders = useMemo(() =>
    folderHierarchy.getDirectChildren(folderId).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    [folderHierarchy, folderId]
  );
  
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
                  onDelete={promptDelete}
                  onArchive={promptToggleArchive}
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
                    onDelete={promptDelete}
                    onArchive={promptToggleArchive}
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
    </div>
  );
};

export default FolderView;
