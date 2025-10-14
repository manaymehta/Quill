import React, { useState } from 'react'
import { MdAdd, MdClose } from 'react-icons/md'

const TagInput = ({ tags, setTags, isChecklist, setIsChecklist }) => {

  const [inputValue, setInputValue] = useState("");

  const onInputChange = (e) => {
    setInputValue(e.target.value);
  }

  const addNewTag = () => {
    if (inputValue.trim() != "") {
      setTags([...tags, inputValue.trim()]);  //... - all values from that array, .trim() - removes white spaces from ends
      setInputValue("");
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      addNewTag();
    }
  }

  const handleRemoveTag = (removeTag) => {
    setTags(tags.filter((tag) => tag!==removeTag));
  }

  return (
    <div className='flex flex-col'>
      {tags?.length > 0 && (
        <div className='flex items-center gap-x-2 flex-wrap mt-2 max-h-20 overflow-y-auto'>
          {tags.map((tag, index) => (
            <span key={index} className='text-neutral-500 rounded-full px-2 py-1.5 text-sm'>
              # {tag}
              <button 
                className='pl-1 relative top-0.5 text-neutral-400'
                onClick={() => {handleRemoveTag(tag)}}
              >
                <MdClose />
              </button>
            </span>
          ))}
        </div>)}
      <div className='flex items-center justify-between gap-4 mt-3'>
        <div className="flex items-center gap-4 flex-grow">
            <input
              className='text-sm bg-[#e0d5c8] px-3 py-2 rounded-full outline-slate-200 w-full'
              type='text'
              placeholder='Tags'
              onChange={onInputChange}
              onKeyDown={handleKeyDown}
              value={inputValue}
            />

            <button
              className='w-8 h-8 rounded-full flex items-center justify-center cursor-pointer bg-[#cdc4b8] text-stone-500 hover:bg-neutral-400 hover:text-white flex-shrink-0'
              onClick={addNewTag}
            >
              <MdAdd className='' />
            </button>
        </div>

        <button
            className='flex flex-row gap-2 ml-2 justify-center items-center text-sm cursor-pointer bg-[#cdc4b8] text-stone-500 py-2 px-6 my-1 rounded-full flex-shrink-0'
            onClick={() => setIsChecklist(!isChecklist)}
        >
            {isChecklist ? 'Text' : 'Checklist'}
        </button>
      </div>
    </div>
  )
}

export default TagInput
