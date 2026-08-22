import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import NotesGrid from '../../components/Cards/NotesGrid';
import AiSearchPanel from '../../components/Cards/AiSearchPanel';
import Toast from '../../components/ToastMessage/Toast';
import FoldersGrid from '../../components/Cards/FoldersGrid';
import { useModalStore } from '../../components/Modals/useModalStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useHomeNotesQuery, useFoldersQuery } from '../../hooks/useNotesQuery';
import { useDeleteNoteMutation, useArchiveNoteMutation, useChecklistToggleMutation } from '../../hooks/useNoteMutations';
import { useEditFolderMutation } from '../../hooks/useFolderMutations';
import { MdOutlineFolder } from 'react-icons/md';
import './Modal.css';

const Home = () => {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const isFoldersView = queryParams.get("view") === "folders";

  const { data: allNotes = [], isLoading } = useHomeNotesQuery();
  const { data: folders = [] } = useFoldersQuery();

  const { searchQuery, searchMode, semanticResult, isSearchingAI, setSearchScope, setScopeFolderIds } = useSearchStore();
  const { openTab } = useTabsStore();

  const displayedNotes = useMemo(() => {
    if (searchMode === 'keyword' && searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return allNotes.filter(n =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.content && n.content.toLowerCase().includes(q)) ||
        (n.tags && n.tags.some(t => t.toLowerCase().includes(q)))
      );
    }
    return allNotes;
  }, [allNotes, searchMode, searchQuery]);

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
  const checklistToggleMutation = useChecklistToggleMutation();
  const editFolderMutation = useEditFolderMutation(showToastMessage);

  // Set search scope context
  useEffect(() => {
    setSearchScope("home");
    setScopeFolderIds([]);
  }, [setSearchScope, setScopeFolderIds]);

  const handleRenameFolder = (folderId, newName) => {
    editFolderMutation.mutate({ folderId, patch: { name: newName } });
  };

  const handleColorChangeFolder = (folderId, newColor) => {
    editFolderMutation.mutate({ folderId, patch: { color: newColor } });
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
    archiveNoteMutation.mutate({ noteId: note._id, isArchived: !note.isArchived });
  };

  const handleChecklist = (note, index) => {
    const newChecklist = [...(note.checklist || [])];
    if (newChecklist[index]) {
      newChecklist[index] = { ...newChecklist[index], completed: !newChecklist[index].completed };
    }
    checklistToggleMutation.mutate({ noteId: note._id, checklist: newChecklist });
  };

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

  // Compute top level items
  const topLevelFolders = folders.filter(f => f.parentId === null && !f.isDeleted)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="relative min-h-0">
      <div className="pb-24 px-2 md:px-4">
        {isFoldersView ? (
          <div className="space-y-3">
            {/* Folders Section */}
            <div>
              <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-3 flex items-center">
                <MdOutlineFolder className="mr-2" size={16} />
                Folders
              </h3>
              <FoldersGrid
                folders={topLevelFolders}
                parentId={null}
                onRename={handleRenameFolder}
                onColorChange={handleColorChangeFolder}
                onDelete={handleDeleteFolder}
                isAddingFolder={isAddingFolder}
                setIsAddingFolder={setIsAddingFolder}
              />
            </div>
          </div>
        ) : isAIMode ? (
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
                  onChecklistToggle={handleChecklist}
                />
              )}
            </div>
            <div className="w-full md:w-1/3 shrink-0">
              <AiSearchPanel />
            </div>
          </div>
        ) : (
          <NotesGrid
            notes={displayedNotes}
            loading={isLoading}
            emptyMessage={"It's quiet here… Start by adding a note."}
            onEdit={handleEdit}
            onDelete={handleDeleteNoteClick}
            onArchive={handleArchiveToggle}
            onChecklistToggle={handleChecklist}
          />
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

export default Home;
