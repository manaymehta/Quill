import { useEffect, useState, useCallback } from 'react'
import { MdAdd, MdClose, MdCheckBoxOutlineBlank, MdCheckBox, MdNotes } from 'react-icons/md'
import { FaWandMagicSparkles, FaTag } from 'react-icons/fa6'
import axiosInstance from '../../utils/axiosInstance';


const AddEditNotes = ({ type, noteData, onUpdateTabState, onClose, onSaveSuccess, showToastMessage, shouldCloseModal }) => {
  const [tags, setTags] = useState(noteData?.tags || []);
  const [content, setContent] = useState(noteData?.content || "");
  const [title, setTitle] = useState(noteData?.title || "");
  const [error, setError] = useState("")
  const [summarizedText, setSummarizedText] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isChecklist, setIsChecklist] = useState(noteData?.isChecklist || false);
  const [checklist, setChecklist] = useState(noteData?.checklist || []);
  const [tagInputValue, setTagInputValue] = useState("");

  // sync state to home whenever anything changes, this preserves unsaved changes when switching tabs
  useEffect(() => {
    if (onUpdateTabState) {
      // parent will manage the temporary draft ID
      onUpdateTabState({
        title,
        content,
        tags,
        isChecklist,
        checklist
      });
    }
  }, [title, content, tags, isChecklist, checklist]);


  const handleAddTag = () => {
    if (tagInputValue.trim() !== "") {
      const newTag = tagInputValue.trim();
      if (!tags.includes(newTag)) {
        setTags([...tags, newTag]);
      }
      setTagInputValue("");
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };


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


  const editNote = useCallback(async () => {
    const noteId = noteData._id;
    try {
      // POST for temp draft ID, PUT for existing note
      if (noteData.isDraft) {
        const response = await axiosInstance.post("/add-note", {
          title,
          content: isChecklist ? "" : content,
          tags,
          isChecklist,
          checklist
        });
        if (response.data && response.data.note) {
          onSaveSuccess();
          showToastMessage("Note added successfully", "add");
        }
      } else {
        const response = await axiosInstance.put("/edit-note/" + noteId, {
          title,
          content: isChecklist ? "" : content,
          tags,
          isChecklist,
          checklist
        });
        if (response.data && response.data.note) {
          onSaveSuccess();
          showToastMessage("Note updated successfully", "edit");
        }
      }
    }
    catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      }
    }
  }, [noteData, title, content, isChecklist, tags, checklist, onSaveSuccess, showToastMessage]);

  const addNewNote = useCallback(async () => {
    try {
      const response = await axiosInstance.post("/add-note", {
        title,
        content,
        tags,
        isChecklist,
        checklist
      });
      if (response.data && response.data.note) {
        onSaveSuccess();
        showToastMessage("Note added successfully", "add");
      }
    }
    catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      }
    }
  }, [title, content, tags, isChecklist, checklist, onSaveSuccess, showToastMessage]);
  const handleAddNote = useCallback(() => {
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
  }, [isChecklist, content, title, checklist, type, editNote, addNewNote]);

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
  }, [shouldCloseModal, handleAddNote, type]);

  return (
    <div className='editor-wrapper flex flex-col h-full w-full bg-[#f4eadc] rounded-2xl shadow-sm border border-[#e8dcc8] overflow-hidden relative'>

      {/* editor content area */}
      <div className='flex-grow flex flex-col pt-4 md:pt-8 pr-8 md:pr-12 pb-2 pl-6 md:pl-8 overflow-hidden'>

        {/* title area */}
        <input
          type='text'
          className='w-full bg-transparent outline-none font-medium text-4xl text-[#333] placeholder-stone-400 mb-6 font-sans caret-[#333] cursor-text shrink-0 leading-tight'
          placeholder='Untitled Note'
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
        />

        <div className='flex flex-col gap-2 flex-grow overflow-hidden'>
          {error && (<p className='text-xs text-red-500 mb-2 shrink-0'>{error}</p>)}

          {isChecklist ? (
            <div className="flex-grow overflow-y-auto editor-scrollbar pr-2">

              {checklist.length === 0 && (
                <button className='w-full text-sm bg-black/5 text-[#333] p-3 rounded-xl cursor-pointer hover:bg-black/10 transition-all ease-in-out text-left' onClick={addChecklistItem}>
                  <MdAdd className="inline-block text-lg align-text-bottom mr-1" /> Add your first item...
                </button>
              )}
              {checklist.map((item, index) => (
                <div key={index} className="flex items-center gap-3 mb-3 group">
                  <button className='cursor-pointer text-stone-500 hover:text-[#e85d56] transition-colors text-xl' onClick={() => toggleChecklistItem(index)}>
                    {item.completed ? <MdCheckBox className="text-[#e85d56]" /> : <MdCheckBoxOutlineBlank />}
                  </button>
                  <input
                    type="text"
                    value={item.text}
                    onChange={(e) => handleChecklistItemChange(index, e.target.value)}
                    className={`text-base bg-transparent outline-none w-full border-b border-transparent focus:border-black/10 transition-colors py-1 caret-[#333] cursor-text ${item.completed ? 'line-through text-stone-400' : 'text-[#333]'}`}
                    placeholder='Checklist item'
                  />
                  <button className='cursor-pointer text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-[#e85d56]' onClick={() => removeChecklistItem(index)}>
                    <MdClose className="text-xl" />
                  </button>
                </div>
              ))}
              {checklist.length > 0 && (
                <button className='text-sm text-stone-500 p-2 mt-2 cursor-pointer hover:text-[#333] transition-colors ease-in-out text-left' onClick={addChecklistItem}>
                  <MdAdd className="inline-block text-lg align-text-bottom" /> Add another item
                </button>
              )}
            </div>
          ) : (
            <textarea
              className='text-lg font-sans bg-transparent text-[#333] outline-none flex-grow resize-none leading-relaxed placeholder-stone-400 caret-[#333] cursor-text overflow-y-auto editor-scrollbar pr-2'
              placeholder='Start typing...'
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setError("");
              }}
            />
          )}

          {summarizedText && !isChecklist && (
            <div className='mt-4 p-5 font-serif bg-[#f8f1e6] border border-[#e8dcc8] shadow-inner rounded-xl relative shrink-0 overflow-y-auto max-h-48 editor-scrollbar'>
              <button
                className='text-xl text-stone-400 cursor-pointer hover:text-[#e85d56] transition-colors absolute top-4 right-4'
                onClick={() => setSummarizedText("")}
              >
                <MdClose />
              </button>
              <div className="flex items-center gap-2 mb-3 text-[#d97757]">
                <FaWandMagicSparkles />
                <h4 className='font-semibold text-lg'>AI Summary</h4>
              </div>
              <p className='text-base text-[#4a4a4a] leading-relaxed'>{summarizedText}</p>
            </div>
          )}
        </div>

        {/* tags */}
        {tags.length > 0 && (
          <div className=" pt-2 border-t border-black/5 flex flex-wrap gap-2 shrink-0">
            {tags.map((tag, index) => (
              <span key={index} className="flex items-center px-3 py-1 bg-white/50 text-[#333] text-sm rounded-full border border-black/5 cursor-default group/removetag">
                <span className="text-stone-500 mr-1">#</span>{tag}
                <MdClose
                  className="ml-2 text-stone-400 opacity-0 group-hover/removetag:opacity-100 cursor-pointer hover:text-red-500 transition-colors"
                  onClick={() => handleRemoveTag(tag)}
                />
              </span>
            ))}
          </div>
        )}

      </div>


      <div className="bg-[#f8f1e6] border-t border-[#e8dcc8] px-8 py-4 flex items-center justify-between">

        {/* tools */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsChecklist(!isChecklist)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${isChecklist ? 'bg-white shadow-sm text-[#333]' : 'text-stone-500 hover:text-[#333] hover:bg-black/5'}`}
          >
            <MdNotes className="text-lg" />
            Checklist
          </button>

          <button
            onClick={handleSummarize}
            disabled={isSummarizing || isChecklist || !content.trim()}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${isSummarizing ? 'opacity-50 animate-pulse text-[#d97757]' : isChecklist || !content.trim() ? 'opacity-40 cursor-not-allowed text-stone-500' : 'text-stone-500 hover:text-[#d97757] hover:bg-orange-50'}`}
          >
            <FaWandMagicSparkles className="text-md" />
            {isSummarizing ? "Summarizing..." : "Summarize"}
          </button>

          {/* inline tag input */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/5 rounded-lg border border-transparent focus-within:border-black/10 focus-within:bg-white transition-all">
            <FaTag className="text-stone-400 text-sm" />
            <input
              type="text"
              placeholder="Add tag..."
              className="bg-transparent text-sm outline-none w-24 placeholder-stone-500 text-[#333] caret-[#333] cursor-text"
              value={tagInputValue}
              onChange={(e) => setTagInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
          </div>
        </div>

        {/* actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm text-stone-500 font-medium hover:text-[#ef4444] cursor-pointer hover:bg-red-50 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleAddNote}
            className="px-6 py-2 rounded-lg text-sm font-medium text-white cursor-pointer bg-[#dd5e57] hover:bg-[#fb6d65] hover:shadow-md transition-all flex items-center gap-2"
          >

            {type === "edit" ? "Save Changes" : "Save Note"}
          </button>
        </div>

      </div>
    </div>

  )
}




export default AddEditNotes