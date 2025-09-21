import React, { useState } from 'react';
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa6";

const PasswordInput = ({ value, onChange, placeholder, inputClassName, eyeIconClassName }) => {
    const [isShowPassword, setIsShowPassword] = useState(false);
    const toggleShowPassword = () => {
        setIsShowPassword(!isShowPassword);
    };

    return (
        <div className={`flex items-center ${inputClassName}`}>
            <input
                value={value}
                onChange={onChange}
                placeholder={placeholder || "Password"}
                type={isShowPassword ? "text" : "password"}
                className="w-full bg-transparent outline-none"
            />

            {isShowPassword ? (
                <FaRegEye
                    size={22}
                    onClick={toggleShowPassword}
                    className={`cursor-pointer ${eyeIconClassName}`}
                />
            ) : (
                <FaRegEyeSlash
                    size={22}
                    onClick={toggleShowPassword}
                    className={`cursor-pointer ${eyeIconClassName}`}
                />
            )}
        </div>
    );
};

export default PasswordInput;
