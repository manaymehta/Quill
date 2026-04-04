import React, { useEffect, useState } from 'react'
import NotesGrid from '../../components/Cards/NotesGrid';
import useNoteOperations from '../../hooks/useNoteOperations';
import axiosInstance from '../../utils/axiosInstance';
import { useAuthStore } from '../../store/useAuthStore';
import { useNotesStore } from '../../store/useNotesStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useNavigate } from 'react-router-dom';
import Toast from '../../components/ToastMessage/Toast';

const Archive = () => {
    const [archivedNotes, setArchivedNotes] = useState([]);
    const [showToast, setShowToast] = useState(false);

    const { getUser } = useAuthStore();
    const { getAllNotes } = useNotesStore();
    const { openTab } = useTabsStore();
    const navigate = useNavigate();

    const [toastMessageVisibility, setToastMessageVisibility] = useState({
        isShown: false,
        message: "",
        type: "add"
    });

    const showToastMessage = (message, type) => {
        setToastMessageVisibility({ isShown: true, message, type });
        setShowToast(true);
    };

    const handleCloseToast = () => {
        setToastMessageVisibility((prev) => ({ ...prev, isShown: false }));
        setTimeout(() => {
            setShowToast(false);
        }, 400);
    };

    useEffect(() => {
        if (toastMessageVisibility.isShown) {
            setTimeout(() => {
                handleCloseToast();
            }, 3000);
        }
    }, [toastMessageVisibility.isShown]);

    const getArchivedNotes = async () => {
        try {
            const response = await axiosInstance.get("/get-all-archived-notes");
            if (response.data && response.data.notes) {
                setArchivedNotes(response.data.notes);
            }
        }
        catch (error) {
            console.log("Unexpected error. Please try again", error);
        }
    }

    const handleEdit = (note) => {
        openTab(note);
        navigate('/dashboard');
    };

    const {
        deleteNote,
        updateNoteArchive,
        handleChecklistToggle
    } = useNoteOperations(getArchivedNotes, showToastMessage, getAllNotes);

    useEffect(() => {
        getArchivedNotes();
        getUser();
    }, [getUser])

    return (
        <>
            <div className="p-2">
                <NotesGrid
                    notes={archivedNotes}
                    emptyMessage={"No Archived Notes..."}
                    onEdit={handleEdit}
                    onDelete={deleteNote}
                    onArchive={updateNoteArchive}
                    onChecklistToggle={handleChecklistToggle}
                // onPin not passed because archived notes typically aren't pinned, or it unarchives them (handled in backend/hook)
                />
            </div>



            {showToast && (
                <Toast
                    isShown={toastMessageVisibility.isShown}
                    message={toastMessageVisibility.message}
                    type={toastMessageVisibility.type}
                    onClose={handleCloseToast}
                />
            )}
        </>
    )
}

export default Archive
