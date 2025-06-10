import moment from 'moment'
import React from 'react'

import { MdOutlinePushPin, MdCreate, MdDelete } from "react-icons/md"
const NoteCard = ({ title, date, content, tags, isPinned, onEdit, onDelete, onPinned }) => {

  return (
    <div className='border border-slate-200 rounded-xl p-4 bg-white hover:shadow-xl transition-all ease-in-out'>
      <div className='flex items-center justify-between'>
        <div>
          <h4 className='text-xl font-semibold text-slate-700'>{title}</h4>
          <span className='font-medium text-xs text-slate-500'>{moment(date).format("Do MMM YYYY")}</span>
        </div>
        <MdOutlinePushPin className={`icon-btn ${isPinned ? 'text-black' : 'text-slate-400'}  hover:text-slate-600`} onClick={onPinned} />
      </div>
      
      <div>
        <div>
          <p className='font-medium mt-2 text-slate-700'>{content?.slice(0, 60)}</p>
        </div>

        <div className='flex itmes-center justify-between gap-2 mt-2'>
          <div className=' text-slate-500 text-sm'>{tags.map((item)=>`#${item} `)}</div>
          <div className='flex items-center gap-2'>
            <MdCreate className='icon-btn hover:text-green-400' onClick={onEdit} />
            <MdDelete className='icon-btn hover:text-red-500' onClick={onDelete} />
          </div>
        </div>

        
      </div>
    </div>
  )
}

export default NoteCard
