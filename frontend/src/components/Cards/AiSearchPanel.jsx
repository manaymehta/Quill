import { RiSparkling2Fill } from 'react-icons/ri';
import { IoMdClose } from 'react-icons/io';
import ReactMarkdown from 'react-markdown';
import { useSearchStore } from '../../store/useSearchStore';

const AiSearchPanel = () => {
    const { semanticResult, clearSemanticResult, isSearchingAI, searchQuery } = useSearchStore();

    if (isSearchingAI) {
        return (
            <div className="flex flex-col gap-3 p-6 rounded-3xl bg-[#f8ecdc] border border-gray-700 shadow-sm h-fit sticky top-8 max-h-[85vh] overflow-y-auto animate-scale-up">
                <div className="flex items-center gap-2">
                    <RiSparkling2Fill className="text-[#e85d56] text-xl animate-pulse" />
                    <span className="text-base font-bold text-[#e85d56]">Ask AI</span>
                </div>
                <p className="text-[#494949] text-sm leading-relaxed font-medium">
                    Searching for <span className="text-[#e85d56] font-semibold">"{searchQuery}"</span>…
                </p>
                <div className="flex gap-1.5 mt-2">
                    {[0, 1, 2].map(i => (
                        <span
                            key={i}
                            className="w-2 h-2 rounded-full bg-[#e85d56] animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }}
                        />
                    ))}
                </div>
            </div>
        );
    }

    if (!semanticResult) return null;

    return (
        <div className="flex flex-col gap-4 p-6 rounded-3xl bg-[#f8ecdc] border border-gray-700 shadow-sm h-fit sticky top-8 max-h-[85vh] overflow-y-auto animate-scale-up">
            {/* header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 title-area">
                    <RiSparkling2Fill className="text-[#e85d56] text-xl" />
                    <span className="text-base font-bold text-[#e85d56]">AI Answer</span>
                </div>
                <button
                    onClick={clearSemanticResult}
                    className="text-stone-400 hover:text-red-500 hover:bg-red-50 p-1 rounded-full transition-colors cursor-pointer"
                >
                    <IoMdClose className="text-xl" />
                </button>
            </div>

            {/* answer */}
            <div className="text-[#494949] text-sm leading-relaxed border-l-[3px] border-[#e85d56]/50 pl-4 font-medium">
                <ReactMarkdown
                    components={{
                        p: ({node, ...props}) => <p className="mb-3 last:mb-0" data-type={node?.type} {...props} />,
                        strong: ({node, ...props}) => <strong className="font-bold text-stone-700" data-type={node?.type} {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3" data-type={node?.type} {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3" data-type={node?.type} {...props} />,
                        li: ({node, ...props}) => <li className="mb-1" data-type={node?.type} {...props} />,
                        a: ({node, ...props}) => <a className="text-[#e85d56] hover:underline" data-type={node?.type} {...props} />
                    }}
                >
                    {semanticResult.answer}
                </ReactMarkdown>
            </div>

            {/* source count */}
            {semanticResult.sourceNotes?.length > 0 && (
                <div className="mt-2 pt-4 border-t border-black/5">
                    <p className="text-xs text-stone-500 font-medium">
                        Based on {semanticResult.sourceNotes.length} note{semanticResult.sourceNotes.length > 1 ? 's' : ''} from your knowledge base
                    </p>
                </div>
            )}
        </div>
    );
};

export default AiSearchPanel;
