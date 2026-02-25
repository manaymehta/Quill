import React from 'react';
import { RiSparkling2Fill } from 'react-icons/ri';
import { IoMdClose } from 'react-icons/io';
import { useSearchStore } from '../../store/useSearchStore';

/**
 * Right-side AI answer panel shown in the split layout when searchMode === 'semantic'.
 * Rendered inside Home.jsx, not MainLayout.
 */
const AiSearchPanel = () => {
    const { semanticResult, clearSemanticResult, isSearchingAI, searchQuery } = useSearchStore();

    if (isSearchingAI) {
        return (
            <div className="flex flex-col gap-3 p-5 rounded-2xl bg-[#1e1e21] border border-[#dd5e57]/30 h-fit sticky top-20">
                <div className="flex items-center gap-2">
                    <RiSparkling2Fill className="text-[#dd5e57] text-lg animate-pulse" />
                    <span className="text-sm font-semibold text-white">Ask AI</span>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed">
                    Searching for <span className="text-white font-medium">"{searchQuery}"</span>…
                </p>
                <div className="flex gap-1 mt-1">
                    {[0, 1, 2].map(i => (
                        <span
                            key={i}
                            className="w-2 h-2 rounded-full bg-[#dd5e57] animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }}
                        />
                    ))}
                </div>
            </div>
        );
    }

    if (!semanticResult) return null;

    return (
        <div className="flex flex-col gap-4 p-5 rounded-2xl bg-[#1e1e21] border border-[#dd5e57]/30 h-fit sticky top-20">
            {/* header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <RiSparkling2Fill className="text-[#dd5e57] text-lg" />
                    <span className="text-sm font-semibold text-white">AI Answer</span>
                </div>
                <button
                    onClick={clearSemanticResult}
                    className="text-slate-500 hover:text-white transition-colors"
                >
                    <IoMdClose className="text-lg" />
                </button>
            </div>

            {/* answer */}
            <p className="text-slate-200 text-sm leading-relaxed border-l-2 border-[#dd5e57]/50 pl-3">
                {semanticResult.answer}
            </p>

            {/* source count */}
            {semanticResult.sourceNotes?.length > 0 && (
                <p className="text-xs text-slate-500">
                    Based on {semanticResult.sourceNotes.length} note{semanticResult.sourceNotes.length > 1 ? 's' : ''} from your knowledge base
                </p>
            )}
        </div>
    );
};

export default AiSearchPanel;
