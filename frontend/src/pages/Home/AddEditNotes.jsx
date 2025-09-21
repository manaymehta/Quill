import React, { useEffect, useState } from 'react'
import { MdAdd, MdClose, MdCheckBoxOutlineBlank, MdCheckBox } from 'react-icons/md'
import TagInput from '../../components/Input/TagInput'
import axiosInstance from '../../utils/axiosInstance';

const AddEditNotes = ({ type, noteData, onClose, getAllNotes, showToastMessage, shouldCloseModal }) => { //noteData used for current values of note to be edited
  const [tags, setTags] = useState(noteData?.tags || []);
  const [content, setContent] = useState(noteData?.content || "");
  const [title, setTitle] = useState(noteData?.title || "");
  const [error, setError] = useState("")
  const [summarizedText, setSummarizedText] = useState(""); // State for summarized text
  const [isSummarizing, setIsSummarizing] = useState(false); //State for Loading
  const [isChecklist, setIsChecklist] = useState(noteData?.isChecklist || false);
  const [checklist, setChecklist] = useState(noteData?.checklist || []);

  const handleChecklistItemChange = (index, newText) => {
    const newChecklist = [...checklist];
    newChecklist[index].text = newText;
    setChecklist(newChecklist);
  };

  const toggleChecklistItem = (index) => {
    const newChecklist = [...checklist];
    newChecklist[index].completed = !newChecklist[index].completed;
    setChecklist(newChecklist);
  };

  const addChecklistItem = () => {
    setChecklist([...checklist, { text: '', completed: false }]);
  };

  const removeChecklistItem = (index) => {
    const newChecklist = [...checklist];
    newChecklist.splice(index, 1);
    setChecklist(newChecklist);
  };

  const editNote = async () => {
    const noteId = noteData._id;
    try {
      const response = await axiosInstance.put("/edit-note/" + noteId, {
        title,
        content: isChecklist ? "" : content,
        tags,
        isChecklist,
        checklist
      });
      if (response.data && response.data.note) {
        getAllNotes();
        onClose();
        showToastMessage("Note updated successfully", "edit");
      }
    }
    catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      }
    }
  }

  const addNewNote = async () => {
    try {
      const response = await axiosInstance.post("/add-note", {
        title,
        content,
        tags,
        isChecklist,
        checklist
      });
      if (response.data && response.data.note) {
        getAllNotes();
        onClose();
        showToastMessage("Note added successfully", "add");
      }
    }
    catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      }
    }
  }
  //error conditions for adding a note
  const handleAddNote = () => {
    if (!isChecklist && !content && !title) {
        setError("Please enter content")
        return;
    }
    if (isChecklist && checklist.length === 0 && !title) {
        setError("Please add at least one checklist item")
        return;
    }
    setError("");
    if (type === 'edit') {
      editNote();
    } else {
      addNewNote();
    }
  }

  // New function to handle summarization
  const handleSummarize = async () => {
    if (!content.trim()) {
      setError("Please enter content to summarize.");
      return;
    }
    setIsSummarizing(true);
    setError("");
    try {
      const response = await axiosInstance.post("/summarize-note", {
        text: content, // Send the current content from the textarea
      });

      if (response.data && response.data.summary) {
        setSummarizedText(response.data.summary);
      } else {
        setSummarizedText("Could not summarize the note.");
      }
    } catch (error) {
      console.error("Error summarizing note:", error);
      if (error.response && error.response.data && error.response.data.message) {
        setError("Summarization error: " + error.response.data.message);
      } else {
        setError("An unexpected error occurred during summarization.");
      }
      setSummarizedText("Failed to summarize.");
    } finally {
      setIsSummarizing(false);
    }
  };

  useEffect(() => {
    if (shouldCloseModal && type === "edit") {
      handleAddNote();
    }
  }, [shouldCloseModal]);

  return (
    <div className='flex flex-col h-full'>
      <div className='relative'>
        <button
          className=' text-2xl text-[#e85d56] hover:text-slate-600 flex items-center justify-center absolute -top-1 -right-1'
          onClick={onClose}
        >
          <MdClose />
        </button>
      </div>

      <div className='flex flex-col gap-2'>

        <input
          type='text'
          className=' outline-none font-medium text-xl pl-1 pt-1'
          placeholder='Title '
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
        />
      </div>

      

      <div className='flex flex-col gap-2 mt-4 flex-grow overflow-y-auto'>
        {isChecklist ? (
            <div>
                {checklist.length === 0 && (
                    <button className='w-full text-sm bg-[#cdc4b8] text-stone-500 p-2 my-3 hover:bg-neutral-400 hover:text-white rounded-full transition-all ease-in-out' onClick={addChecklistItem}>
                        <MdAdd className="inline-block" /> Add Item
                    </button>
                )}
                {checklist.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 mb-2">
                        <button className='cursor-pointer' onClick={() => toggleChecklistItem(index)}>
                            {item.completed ? <MdCheckBox /> : <MdCheckBoxOutlineBlank />}
                        </button>
                        <input
                            type="text"
                            value={item.text}
                            onChange={(e) => handleChecklistItemChange(index, e.target.value)}
                            className='text-sm bg-[#f8ecdc] outline-none p-2 rounded-xl w-full'
                            placeholder='Checklist item'
                        />
                        <button className='cursor-pointer' onClick={() => removeChecklistItem(index)}>
                            <MdClose />
                        </button>
                    </div>
                ))}
                {checklist.length > 0 && (
                    <button className='w-full text-sm bg-[#cdc4b8] text-stone-500 p-2 my-3 hover:bg-neutral-400 hover:text-white rounded-full transition-all ease-in-out' onClick={addChecklistItem}>
                        <MdAdd className="inline-block" /> Add Item
                    </button>
                )}
                
            </div>
        ) : (
                        <textarea
                type='text'
                className={`text-sm bg-[#f8ecdc] outline-none p-2 rounded-xl transition-all duration-150 ${summarizedText ? 'h-64' : 'h-120'}`}
                placeholder='Content '
                value={content}
                onChange={(e) => {
                    setContent(e.target.value)
                    setError("");
                }}
            />
        )}

        {summarizedText && !isChecklist && (
          <div className='mt-2 p-3 bg-gray-100 rounded-xl'>
            <h4 className='font-medium text-lg mb-2'>Summary:</h4>
            <p className='text-sm text-gray-800'>{summarizedText}</p>
          </div>
        )}
      </div>

      <div className='flex items-center justify-between gap-2'>
        <TagInput tags={tags} setTags={setTags} isChecklist={isChecklist} setIsChecklist={setIsChecklist} />
      </div>

      {error && (<p className='text-xs pl-2 pt-2 text-red-500'>{error}</p>)}

      <div className='flex'>
        <button
          className='w-full text-sm bg-[#cdc4b8] text-stone-500 p-2 my-3 mr-2 hover:bg-neutral-400 hover:text-white rounded-full transition-all ease-in-out'
          onClick={handleAddNote}
        >
          {type === "edit" ? "EDIT" : "ADD"}
        </button>
        {!isChecklist && (
            <button
            className='w-auto text-sm opacity-85 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white py-2.5 px-3 my-3 rounded-full hover:shadow-lg hover:opacity-70 transition-all ease-in-out duration-300'
            onClick={handleSummarize}
            disabled={isSummarizing}
            >
            {isSummarizing ? "Summarizing..." : "Summarize"}
            </button>
        )}
      </div>
    </div>
  )
}

export default AddEditNotes