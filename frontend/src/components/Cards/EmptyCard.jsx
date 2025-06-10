import React from 'react'
import noteimage from "../../assets/noteimage.png"
const EmptyCard = ({ img, message }) => {
  return (
    <div className='flex flex-col items-center justify-center mt-40'>
      {/*<div class="w-25 h-25 bg-white border-[8px] border-gray-300 rounded-full flex items-center justify-center">
        <span class="text-7xl font-medium text-gray-300">+</span>
      </div>*/}
      <img className="w-50 h-50 opacity-30" src={noteimage} alt="no"/>
      <p className='w-1/2 text-center leading-8  text-2xl font-normal text-gray-500'>{message}</p>
    </div>
  )
}

export default EmptyCard
