import React from 'react';
import { Link } from 'react-router-dom';
import { useFoldersStore } from '../../store/useFoldersStore';
import { MdKeyboardArrowRight, MdOutlineFolder } from 'react-icons/md';

const Breadcrumb = ({ folderId }) => {
    const { getFolderPath } = useFoldersStore();

    if (!folderId) return null;

    const path = getFolderPath(folderId);

    return (
        <div className="flex items-center text-[13px] font-semibold text-stone-400 uppercase tracking-widest py-0.5 select-none">
            <MdOutlineFolder className="mr-2 text-stone-400 flex-shrink-0" size={16} />

            <Link
                to="/dashboard?view=folders"
                className="hover:text-stone-200 transition-colors"
            >
                Home
            </Link>

            {path.map((folder, index) => {
                const isLast = index === path.length - 1;
                return (
                    <React.Fragment key={folder._id}>
                        <MdKeyboardArrowRight size={16} className="text-stone-500 mx-1 flex-shrink-0" />
                        {isLast ? (
                            <span className="text-[#e85d56] truncate max-w-[120px] md:max-w-[200px]">
                                {folder.name}
                            </span>
                        ) : (
                            <Link
                                to={`/folder/${folder._id}`}
                                className="hover:text-stone-200 transition-colors truncate max-w-[120px]"
                            >
                                {folder.name}
                            </Link>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default Breadcrumb;
