import React from 'react'
import { getInitials } from '../../utils/helper'
import { useAuthStore } from '../../store/useAuthStore'

const ProfileInfo = ({ onLogout }) => {
	const { user } = useAuthStore();
	return (
		<div className='flex items-center gap-3 '>
			<div className='w-12 h-12 flex items-center justify-center rounded-full text-slate-950 font-medium bg-slate-100'>
				<p className='font-bold'>{getInitials(user?.fullName)}</p>
			</div>
			<div className='text-sm'>
				<p className='font-semibold'>{user?.fullName}</p>
				<button className="text-black underline cursor-pointer hover:text-blue-600" onClick={onLogout}>Logout</button>
			</div>
		</div>
	)
}

export default ProfileInfo
 