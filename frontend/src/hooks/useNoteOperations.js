import axiosInstance from "../utils/axiosInstance";
import { useNotesStore } from "../store/useNotesStore";

const useNoteOperations = (refreshData, showToastMessage) => {
    const { getAllNotes } = useNotesStore();

    const deleteNote = async (note) => {
        const noteId = note._id;
        try {
            const response = await axiosInstance.delete("/delete-note/" + noteId);
            if (response.data && !response.data.error) {
                showToastMessage("Note deleted successfully", "delete");
                refreshData();
                // refresh global notes if we are not on Home
                if (refreshData !== getAllNotes) getAllNotes();
            }
        } catch (error) {
            if (
                error.response &&
                error.response.data &&
                error.response.data.message
            ) {
                console.log("Unexpected error. Please try again");
            }
        }
    };

    const updateIsPinned = async (noteData) => {
        const noteId = noteData._id;
        try {
            const response = await axiosInstance.put(
                "/update-note-pinned/" + noteId,
                { isPinned: !noteData.isPinned }
            );

            if (response.data && response.data.note) {
                showToastMessage(
                    `Note ${!noteData.isPinned ? "pinned" : "unpinned"}`
                );
                refreshData();
                if (refreshData !== getAllNotes) getAllNotes();
            }
        } catch (error) {
            console.log(error);
        }
    };

    const updateNoteArchive = async (noteData) => {
        const noteId = noteData._id;
        try {
            const response = await axiosInstance.put(
                "/update-note-archive/" + noteId,
                { isArchived: !noteData.isArchived }
            );

            if (response.data && response.data.note) {
                showToastMessage(
                    `Note ${!noteData.isArchived ? "archived" : "unarchived"}`
                );
                refreshData();
                if (refreshData !== getAllNotes) getAllNotes();
            }
        } catch (error) {
            console.log(error);
        }
    };

    const handleChecklistToggle = async (note, index) => {
        const noteId = note._id;
        const newChecklist = [...note.checklist];
        newChecklist[index].completed = !newChecklist[index].completed;

        try {
            const response = await axiosInstance.put(`/edit-note/${noteId}`, {
                checklist: newChecklist,
            });

            if (response.data && response.data.note) {
                refreshData();
                if (refreshData !== getAllNotes) getAllNotes();
            }
        } catch (error) {
            console.log(error);
        }
    };

    const restoreNote = async (note) => {
        const noteId = note._id;
        try {
            const response = await axiosInstance.put("/restore-note/" + noteId);
            if (response.data && !response.data.error) {
                showToastMessage("Note restored successfully", "success");
                refreshData();
                getAllNotes();
            }
        } catch (error) {
            console.log("Unexpected error. Please try again", error);
        }
    };

    const deleteNotePermanently = async (note) => {
        const noteId = note._id;
        try {
            const response = await axiosInstance.delete("/delete-trash-note/" + noteId);
            if (response.data && !response.data.error) {
                showToastMessage("Note deleted permanently", "delete");
                refreshData();
            }
        } catch (error) {
            console.log("Unexpected error. Please try again", error);
        }
    }


    return {
        deleteNote,
        updateIsPinned,
        updateNoteArchive,
        handleChecklistToggle,
        restoreNote,
        deleteNotePermanently
    };
};

export default useNoteOperations;
