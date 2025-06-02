import React from 'react'
import { MdAdd } from 'react-icons/md'
const AddEditNotes = () => {
  return (
    <div>
      <div className='flex flex-col gap-2'>

        <input
          type='text'
          className=''
          placeholder='Title '
        />
      </div>

      <div className='flex flex-col gap-2 mt-4'>

        <textarea
          type='text'
          className='text-sm bg-slate-50 outline-none p-2 rounded'
          placeholder='Content '
          rows={10}
        />
      </div>

      <div>
        <input
          type='text'
          className='flex flex-col'
          placeholder='TAGS '
        />
      </div>
        
      <button 
        className=' btn-primary transition-all ease-in-out'
        onClick={()=>{}}  
      >
        ADD
      </button>
    </div>
  )
}

export default AddEditNotes
