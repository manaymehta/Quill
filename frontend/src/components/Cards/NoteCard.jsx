import moment from 'moment'
import { MdOutlinePushPin, MdCreate, MdDelete, MdCheckBoxOutlineBlank, MdCheckBox, MdRestore, MdDeleteForever, MdOutlineArchive, MdOutlineUnarchive } from "react-icons/md"

const NoteCard = ({ title, date, content, tags, isPinned, onEdit, onDelete, onPinned, isChecklist, checklist, onChecklistToggle, isTrash, onRestore, isArchived, onArchive }) => {
  return (
    <div
      onClick={(e) => {
        if (e.target.closest('.no-card-click')) return;
        onEdit();
      }}
      className='group border max-w-sm border-gray-700 rounded-3xl p-4 bg-[#f8ecdc] shadow-xs hover:bg-[#d8cec1] hover:shadow-xl transition-all ease-in-out cursor-pointer'
    >
      <div className='flex flex-col '>
        <div className='flex justify-between items-start'>
          <h4 className='text-2xl font-semibold tracking-tight text-[#e85d56]'>{title}</h4>
          <MdOutlinePushPin
            className={`icon-btn no-card-click transition-opacity duration-200 ${isPinned ? 'text-[#e85d56] opacity-100' : 'text-[#a6a6a6] opacity-0 group-hover:opacity-100'} ${isTrash || isArchived ? 'hidden' : ''} hover:text-slate-600`}
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
        <div className='flex items-center gap-1 flex-wrap'>
          {tags.map((item) => (
            <span key={item} className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-[#e3d7c9] text-gray-700 font-medium">
              #{item}
            </span>
          ))}
        </div>
        <div className='flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
          {isTrash ? (
            <>
              <MdRestore
                className='icon-btn hover:text-green-600 no-card-click text-[#bdbdbd]'
                onClick={onRestore}
                title="Restore"
              />
              <MdDeleteForever
                className='icon-btn hover:text-red-600 no-card-click text-[#bdbdbd]'
                onClick={onDelete}
                title="Delete Forever"
              />
            </>
          ) : (
            <>
              <div
                className='icon-btn hover:text-blue-600 no-card-click text-[#bdbdbd]'
                onClick={onArchive}
                title={isArchived ? "Unarchive" : "Archive"}
              >
                {isArchived ? <MdOutlineUnarchive size={22} /> : <MdOutlineArchive size={22} />}
              </div>

              <MdDelete
                className='icon-btn hover:text-[#e85d56] no-card-click text-[#bdbdbd]'
                onClick={onDelete}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default NoteCard
