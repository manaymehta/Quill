import React from 'react'
import { FaMagnifyingGlass } from "react-icons/fa6";
import { IoMdClose } from "react-icons/io";
const SearchBar = ({ value, onChange, onClearSearch, handleSearch }) => {

  return (
    <div className='flex w-70 items-center px-4 bg-slate-100 rounded-full'>
      <input
        type='text'
        value={value}
        className='w-full bg-transparent py-[11px] outline-none '
        onChange={onChange}
        placeholder='Search Notes'
      />
      {value && <IoMdClose className='text-slate-400 hover:text-black mr-2 text-xl' onClick={onClearSearch} />}
      <FaMagnifyingGlass className='cursor-pointer text-slate-400 hover:text-black' onClick={handleSearch} />
    </div>
  )
}

export default SearchBar
