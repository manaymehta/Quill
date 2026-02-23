import React, { useEffect, useState } from 'react'
import NotesGrid from '../../components/Cards/NotesGrid';
import useNoteOperations from '../../hooks/useNoteOperations';
import axiosInstance from '../../utils/axiosInstance';
import { useAuthStore } from '../../store/useAuthStore';
import { useNotesStore } from '../../store/useNotesStore';
import Toast from '../../components/ToastMessage/Toast';
import AddEditNotes from '../Home/AddEditNotes';
import Modal from 'react-modal';
import '../Home/Modal.css';

const Archive = () => {
    const [archivedNotes, setArchivedNotes] = useState([]);
    const [showToast, setShowToast] = useState(false);
    const [shouldCloseModal, setShouldCloseModal] = useState(false);

    const { getUser } = useAuthStore();
    const { getAllNotes } = useNotesStore();

    const [openAddEditModal, setOpenAddEditModal] = useState({
        isShown: false,
        type: "add",
        data: null,
    });

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
            console.log("Unexpected error. Please try again");
        }
    }

    const handleEdit = (note) => {
        setOpenAddEditModal({ isShown: true, type: "edit", data: note })
    };

    const {
        deleteNote,
        updateNoteArchive,
        handleChecklistToggle
    } = useNoteOperations(getArchivedNotes, showToastMessage, getAllNotes);

    const handleModalClose = () => {
        if (openAddEditModal.type === "edit") {
            setShouldCloseModal(true);
        } else {
            setOpenAddEditModal({ isShown: false, type: "add", data: null });
        }
    };

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

            <Modal
                isOpen={openAddEditModal.isShown}
                onRequestClose={handleModalClose}
                closeTimeoutMS={200}
                style={{
                    overlay: {
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "rgba(0,0,0,0.2)",
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflowY: 'auto',
                        zIndex: 50,
                    },
                }}
                className="mx-auto rounded-2xl bg-[#f8ecdc] w-full max-w-lg p-4 max-h-[90vh] flex flex-col"
                overlayClassName="ReactModal__Overlay"
            >
                <AddEditNotes
                    type={openAddEditModal.type}
                    noteData={openAddEditModal.data}
                    getAllNotes={() => {
                        getArchivedNotes();
                        getAllNotes();
                    }}
                    onClose={() => {
                        setOpenAddEditModal({ isShown: false, type: "add", data: null });
                        setShouldCloseModal(false);
                    }}
                    showToastMessage={showToastMessage}
                    shouldCloseModal={shouldCloseModal}
                />
            </Modal>

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
