import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import NotesGrid from '../../components/Cards/NotesGrid';
import FoldersGrid from '../../components/Cards/FoldersGrid';
import { useModalStore } from '../../components/Modals/useModalStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useHomeNotesQuery, useFoldersQuery } from '../../hooks/useNotesQuery';
import { buildFolderHierarchy } from '../../utils/folderHierarchy';
import { useDeleteNoteMutation, useArchiveNoteMutation, useChecklistToggleMutation, useToggleHomePinMutation, useMoveNoteMutation } from '../../hooks/useNoteMutations';
import { useEditFolderMutation } from '../../hooks/useFolderMutations';
import { MdOutlineFolder } from 'react-icons/md';
import './Modal.css';

// A drag here changes Home's order
const HOME_ORDER = { list: 'home' };

const Home = () => {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const isFoldersView = queryParams.get("view") === "folders";

  const { data: allNotes = [], isLoading } = useHomeNotesQuery();
  const { data: folders = [] } = useFoldersQuery();

  const searchQuery = useSearchStore((state) => state.searchQuery);
  const searchMode = useSearchStore((state) => state.searchMode);
  const setSearchScope = useSearchStore((state) => state.setSearchScope);
  const setScopeFolderIds = useSearchStore((state) => state.setScopeFolderIds);
  const openTab = useTabsStore((state) => state.openTab);

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

  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const openFolderDeleteModal = useModalStore((state) => state.openFolderDeleteModal);

  const { promptDelete } = useDeleteNoteMutation();
  const { promptToggleArchive } = useArchiveNoteMutation();
  const toggleHomePinMutation = useToggleHomePinMutation();
  const moveNoteMutation = useMoveNoteMutation();
  const checklistToggleMutation = useChecklistToggleMutation();
  const editFolderMutation = useEditFolderMutation();

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

  const handleEdit = useCallback((note) => openTab(note), [openTab]);


  const folderHierarchy = useMemo(() => buildFolderHierarchy(folders), [folders]);
  const topLevelFolders = folderHierarchy.rootFolders;

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
        ) : (
          <NotesGrid
            notes={displayedNotes}
            orderList={HOME_ORDER}
            loading={isLoading}
            emptyMessage={"It's quiet here… Start by adding a note."}
            onEdit={handleEdit}
            onDelete={promptDelete}
            onArchive={promptToggleArchive}
            onToggleHome={handleToggleHome}
            onMove={handleMoveNote}
            onChecklistToggle={handleChecklist}
          />
        )}
      </div>
    </div>
  );
};

export default Home;
