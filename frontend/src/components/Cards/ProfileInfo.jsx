import React from 'react'
import { getInitials } from '../../utils/helper'

const ProfileInfo = ({onLogout}) => {
	return (
		<div className='flex itmes-center gap-3'>
			<div className='w-12 h-12 flex items-center justify-center rounded-full text-slate-950 font-medium bg-slate-100'>
				<p className='font-bold'>{getInitials("Manay Mehta")}</p>
			</div>
			<div>
				<p className='font-medium'>Name</p>
				<button className="text-black underline cursor-pointer hover:text-blue-600" onClick={onLogout}>Logout</button>
			</div>
		</div>
	)
}

export default ProfileInfo
