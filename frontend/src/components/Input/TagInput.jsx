import React, { useState } from 'react'
import { MdAdd, MdClose } from 'react-icons/md'

const TagInput = ({ tags, setTags }) => {

  const [inputValue, setInputValue] = useState("");

  const onInputChange = (e) => {
    setInputValue(e.target.value);
  }

  const addNewTag = () => {
    if (inputValue.trim() != "") {
      setTags([...tags, inputValue.trim()]);  //... - all values from that array, .trim() - emoves white spaces from ends
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
    <div>
      {tags?.length > 0 && (
        <div className='flex items-center gap-x-2 flex-wrap'>
          {tags.map((tag, index) => (
            <span key={index} className='text-neutral-500 rounded-full px-2 py-1.5 text-sm mt-2 '>
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
      <div className='flex items-center gap-4 mt-3'>
        <input
          className='text-sm bg-[#e0d5c8] px-3 py-2 rounded-full outline-slate-200'
          type='text'
          placeholder='Tags'
          onChange={onInputChange}
          onKeyDown={handleKeyDown}
          value={inputValue}
        />

        <button
          className='w-8 h-8 rounded-full flex items-center justify-center bg-[#cdc4b8] text-stone-500 hover:bg-neutral-400 hover:text-white'
          onClick={addNewTag}
        >
          <MdAdd className='' />
        </button>
      </div>
    </div>
  )
}

export default TagInput
