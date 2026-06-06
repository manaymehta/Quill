import React, { useState, useRef, useEffect } from 'react';
import { getInitials } from '../../utils/helper';
import { useAuthStore } from '../../store/useAuthStore';
import { FiLogOut } from 'react-icons/fi';

const ProfileInfo = ({ onLogout }) => {
	const { user } = useAuthStore();
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef(null);

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
				setIsOpen(false);
			}
		};
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen]);

	return (
		<div className='relative' ref={dropdownRef}>
			{/* Avatar Button */}
			<button 
				onClick={() => setIsOpen(!isOpen)}
				className={`w-10 h-10 md:w-11 md:h-11 flex items-center justify-center rounded-full text-white font-medium bg-[#e85d56] hover:bg-[#d4544d] transition-colors cursor-pointer outline-none ${isOpen ? 'ring-[3px] ring-white/20' : ''}`}
				aria-label="Account menu"
			>
				<p className='font-bold text-sm md:text-base'>{getInitials(user?.fullName)}</p>
			</button>

			{/* Google-style Dropdown Card / Mobile Modal */}
			{isOpen && (
				<>
					{/* Mobile Backdrop (fixed w-screen h-screen escapes the 60px Navbar height) */}
					<div 
						className="fixed top-0 left-0 w-screen h-screen bg-black/60 z-40 sm:hidden" 
						onClick={() => setIsOpen(false)} 
					/>
					
					{/* Profile Card */}
					<div className='fixed top-[50dvh] left-[50dvw] -translate-x-1/2 -translate-y-1/2 sm:absolute sm:top-full sm:left-auto sm:translate-x-0 sm:translate-y-0 sm:right-0 sm:mt-3 w-[290px] bg-[#2a2b2e] border border-[#4a4b50] rounded-3xl shadow-2xl py-5 z-50 animate-scale-up sm:animate-ghost-in sm:origin-top-right'>
					{/* User Details */}
					<div className='flex flex-col items-center px-4 pb-4'>
						<div className='w-[72px] h-[72px] flex items-center justify-center rounded-full text-white font-medium bg-[#e85d56] text-2xl mb-3 shadow-inner'>
							<p className='font-bold'>{getInitials(user?.fullName)}</p>
						</div>
						<p className='text-white font-medium text-lg leading-tight'>{user?.fullName}</p>
						{user?.email && (
							<p className='text-[#a0a1a5] text-[13px] mt-1'>{user.email}</p>
						)}
					</div>
					
					<div className='h-[1px] w-full bg-[#4a4b50] my-2' />
					
					{/* Sign out action */}
					<div className='px-4 pt-3 pb-1 flex justify-center'>
						<button 
							onClick={() => {
								setIsOpen(false);
								onLogout();
							}}
							className='flex items-center justify-center gap-2 bg-transparent hover:bg-[#3f4044] text-white border border-[#8e9096] px-8 py-2.5 rounded-full transition-colors font-medium text-sm cursor-pointer'
						>
							<FiLogOut className="text-lg" />
							Sign out
						</button>
					</div>
				</div>
				</>
			)}
		</div>
	);
};

export default ProfileInfo;