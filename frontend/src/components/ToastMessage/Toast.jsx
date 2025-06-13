import React, { useEffect } from "react";
import { LuCheck } from "react-icons/lu";
import { MdDeleteOutline } from "react-icons/md";

const Toast = ({ isShown, message, type, onClose }) => {
  useEffect(() => {
  if (isShown) {
    const timeoutId = setTimeout(() => {
      onClose(); // triggers fade-out + unmount timer in Home.jsx
    }, 3000);

    return () => clearTimeout(timeoutId);
  }
}, [isShown, onClose]);


  return (

    <div className={`absolute top-20 right-6`}>
      <div className={`min-w-52  border border-slate-200 shadow-2xl rounded-md transition-opacity duration-400 ${isShown ? "opacity-100" : "opacity-0"} 
      ${type === "delete" ? "bg-red-400" : "bg-emerald-500"}`}
      >
        <div className="flex items-center gap-3 py-2 px-4">
          <div className={`w-10 h-10 flex items-center justify-center rounded-full ${type === "delete" ? "bg-red-50" : "bg-green-50"}`}>
            {type === "delete" ? (
              <MdDeleteOutline className="text-xl text-red-500" />
            ) : (
              <LuCheck className="text-xl text-green-500" />
            )}
          </div>
          <p className="text-sm text-white">{message}</p>
        </div>
      </div>
    </div>
  );
};

export default Toast;