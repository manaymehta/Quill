import moment from 'moment'
import React from 'react'
import { MdOutlinePushPin, MdCreate, MdDelete, MdCheckBoxOutlineBlank, MdCheckBox } from "react-icons/md"

const NoteCard = ({ title, date, content, tags, isPinned, onEdit, onDelete, onPinned, isChecklist, checklist, onChecklistToggle }) => {
  return (
    <div
      onClick={(e) => {
        if (e.target.closest('.no-card-click')) return;
        onEdit();
      }}
      className='border max-w-sm border-gray-700 rounded-3xl p-4 bg-[#f8ecdc] shadow-xs hover:bg-[#d8cec1] hover:shadow-xl transition-all ease-in-out cursor-pointer'
    >
      <div className='flex flex-col'>
        <div className='flex justify-between items-start'>
          <h4 className='text-2xl font-semibold tracking-tight text-[#e85d56]'>{title}</h4>
          <MdOutlinePushPin
            className={`icon-btn no-card-click ${isPinned ? 'text-[#e85d56]' : 'text-[#a6a6a6]'} hover:text-slate-600`}
            onClick={onPinned}
          />
        </div>
        <span className='font-medium text-xs text-[#9c9892] mt-1'>
          {moment(date).format("Do MMM YYYY")}
        </span>
      </div>

      <div className='mt-2'>
        {isChecklist ? (
          <div className="flex flex-col gap-2 mt-2">
            {checklist.slice(0, 3).map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="no-card-click" onClick={(e) => { e.stopPropagation(); onChecklistToggle(index); }}>
                    {item.completed ? <MdCheckBox /> : <MdCheckBoxOutlineBlank />}
                </div>
                <span className={`${item.completed ? 'line-through text-slate-500' : ''}`}>{item.text}</span>
              </div>
            ))}
            {checklist.length > 3 && <span className="text-xs text-slate-500">...and {checklist.length - 3} more items.</span>}
          </div>
        ) : (
          <p className='font-medium mt-2 text-[#494949]'>
            {content?.slice(0, 60)}
          </p>
        )}
      </div>

      <div className='flex items-center justify-between gap-2 mt-2'>
        <div className='text-slate-500 text-sm'>
          {tags.map((item) => `#${item} `)}
        </div>
        <div className='flex items-center gap-2'>
          <MdDelete
            className='icon-btn hover:text-[#e85d56] no-card-click text-[#bdbdbd]'
            onClick={onDelete}
          />
        </div>
      </div>
    </div>
  )
}

export default NoteCard
