import React, { useState } from 'react'
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa6";
const PasswordInput = ({ onChange, value, placeholder }) => {

    const [isShowPassword, setIsShowPassword] = useState(false);
    const toggleShowPassword = () => {
        setIsShowPassword(!isShowPassword);
    }

    return (
        <div className="flex items-center bg-transparent border-[1.5px] px-5 rounded ab-3">
            <input
                value={value}
                onChange={onChange}
                placeholder={placeholder || "Password"}
                type={isShowPassword ? "text" : "password"}
                className="w-full text-sa bg-transparent py-3 mr-3 rounded outline-none"
            />

            {isShowPassword ? (
                <FaRegEye
                    size={22}
                    onClick={toggleShowPassword}
                    className='text-primary cursor-pointer'
                />
            ) : (
                <FaRegEyeSlash
                    size={22}
                    onClick={toggleShowPassword}
                    className='text-slate-400 cursor-pointer'
                />
            )}
        </div>
    )
}

export default PasswordInput
