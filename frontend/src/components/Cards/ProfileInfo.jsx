import React from 'react'
import { getInitials } from '../../utils/helper'
import { useAuthStore } from '../../store/useAuthStore'

const ProfileInfo = ({ onLogout }) => {
	const { user } = useAuthStore();
	return (
		<div className='flex items-center gap-3 '>
			<div className='w-12 h-12 flex items-center justify-center rounded-full text-white font-medium bg-[#e85d56]'>
				<p className='font-bold'>{getInitials(user?.fullName)}</p>
			</div>
			<div className=' text-sm text-white'>
				{/*<p className='hidden sm:block font-semibold'>{user?.fullName}</p>*/}
				<button className="text-white cursor-pointer hover:text-[#e85d56]" onClick={onLogout}>LOG<br></br>OUT</button>
			</div>
		</div>
	)
}

export default ProfileInfo
 