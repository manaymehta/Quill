import React from 'react';
import { Link } from 'react-router-dom';
import { useFoldersStore } from '../../store/useFoldersStore';
import { useFoldersQuery } from '../../hooks/useNotesQuery';

const Breadcrumb = ({ folderId }) => {
    const { getFolderPath } = useFoldersStore();
    const { data: folders = [] } = useFoldersQuery();

    if (!folderId) return null;

    const path = getFolderPath(folders, folderId);

    return (
        <div className="inline-flex items-center bg-white/[0.04] border border-white/[0.05] shadow-sm backdrop-blur-md px-3 py-1.5 rounded-full text-[11px] sm:text-[12px] font-bold text-stone-400 uppercase tracking-[0.15em] select-none">
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
                        <span className="text-stone-600 mx-1.5 font-normal">/</span>
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
