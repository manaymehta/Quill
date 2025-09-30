import React, { useEffect, useState } from 'react'
import NoteCard from '../../components/Cards/NoteCard'
import EmptyCard from '../../components/Cards/EmptyCard'
import axiosInstance from '../../utils/axiosInstance';
import { useAuthStore } from '../../store/useAuthStore';

const Pinned = () => {

  const [allPinnedNotes, setAllPinnedNotes] = useState([]);
  const { getUser } = useAuthStore();

  const getAllPinnedNotes = async () => {
    try {
      const response = await axiosInstance.get("/get-all-pinned-notes");
      if (response.data && response.data.notes) {
        setAllPinnedNotes(response.data.notes);
      }
    }
    catch (error) {
      console.log("Unexpected error. Please try again");
    }
  }

  useEffect(()=>{
    getAllPinnedNotes();
    getUser();
  },[getUser])

  return (
    <div className="min-h-screen">
      <div className="p-4">
        {allPinnedNotes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {allPinnedNotes.map((note) => (
              <NoteCard
                key={note._id}
                title={note.title}
                date={note.date}
                content={note.content}
                tags={note.tags}
                isPinned={note.isPinned}
                onEdit={() => handleEdit(note)}
                onDelete={() => deleteNote(note)}
                onPinned={() => updateIsPinned(note)}
              />
            ))}
          </div>
        ) : (
          <EmptyCard message={"No Pinned Notes..."} />
        )}
      </div>
    </div>
  )
}

export default Pinned
