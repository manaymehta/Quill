import React, { useState } from 'react'
import { MdAdd, MdClose } from 'react-icons/md'
import TagInput from '../../components/Input/TagInput'

const AddEditNotes = ({onClose}) => {

  const [tags, setTags] = useState([]);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");

  const [error, setError] = useState("");

  const handleAddNote = () => {
    if(!content && !title){
      setError("Please enter content")
      return;
    }
    setError("");
  }

  return (
    <div>
      <div className='relative'>
        <button 
          className='text-slate-400 hover:text-slate-600 flex items-center justify-center absolute -top-1 -right-1'
          onClick={onClose}
        >
          <MdClose />
        </button>
      </div>

      <div className='flex flex-col gap-2'>

        <input
          type='text'
          className='outline-none font-medium text-xl pl-1 pt-1'
          placeholder='Title '
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
        />
      </div>

      <div className='flex flex-col gap-2 mt-4'>

        <textarea
          type='text'
          className='text-sm bg-slate-50 outline-none p-2 rounded-xl'
          placeholder='Content '
          rows={10}
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setError("");
          }}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <TagInput tags={tags} setTags={setTags}/>
      </div>
        
      {error && (<p className='text-xs pl-2 pt-2 text-red-500'>{error}</p>)}

      <button 
        className='w-full text-sm bg-primary text-white p-2 my-3 hover:bg-blue-600 rounded-full transition-all ease-in-out'
        onClick={handleAddNote}  
      >
        ADD
      </button>
    </div>
  )
}

export default AddEditNotes
