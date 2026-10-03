import { useEffect, useRef, useState } from 'react';
import { RiSparkling2Fill } from 'react-icons/ri';
import { IoMdClose, IoMdSend } from 'react-icons/io';
import ReactMarkdown from 'react-markdown';
import axiosInstance from '../../utils/axiosInstance';
import { useAgentStore } from '../../store/useAgentStore';
import { useTabsStore } from '../../store/useTabsStore';

const markdownComponents = {
    p: ({node, ...props}) => <p className="mb-3 last:mb-0" data-type={node?.type} {...props} />,
    strong: ({node, ...props}) => <strong className="font-bold text-stone-700" data-type={node?.type} {...props} />,
    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3" data-type={node?.type} {...props} />,
    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3" data-type={node?.type} {...props} />,
    li: ({node, ...props}) => <li className="mb-1" data-type={node?.type} {...props} />,
    a: ({node, ...props}) => <a className="text-[#e85d56] hover:underline" data-type={node?.type} {...props} />,
};

const AgentChatPanel = () => {
    const messages = useAgentStore((state) => state.messages);
    const isBusy = useAgentStore((state) => state.isBusy);
    const sendMessage = useAgentStore((state) => state.sendMessage);
    const resetConversation = useAgentStore((state) => state.resetConversation);
    const hydrate = useAgentStore((state) => state.hydrate);
    const [draft, setDraft] = useState('');
    const scrollAnchorRef = useRef(null);
    const [openingNoteId, setOpeningNoteId] = useState(null);

    // Citations open their note in the editor dock. Fetched fresh so a note
    // deleted since the chat stays honest (404 -> friendly toast).
    const handleOpenCitation = async (noteId) => {
        if (openingNoteId) return;
        setOpeningNoteId(noteId);
        try {
            const response = await axiosInstance.get(`/get-note/${noteId}`);
            const note = response.data?.note;
            if (note) {
                useTabsStore.getState().openTab(note);
            } else {
                throw new Error('empty note payload');
            }
        } catch {
            useTabsStore.getState().showTabToast('Could not open that note. It may have been moved or deleted.', 'error');
        } finally {
            setOpeningNoteId(null);
        }
    };

    // Restore any persisted conversation the first time the panel mounts.
    useEffect(() => {
        hydrate();
    }, [hydrate]);

    useEffect(() => {
        scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages.length, isBusy]);

    const handleSend = () => {
        const text = draft.trim();
        if (!text || isBusy) return;
        sendMessage(text);
        setDraft('');
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col rounded-3xl bg-[#f8ecdc] border border-gray-700 shadow-sm h-[calc(100vh-220px)] max-h-[85vh] overflow-hidden animate-scale-up">
            {/* header */}
            <div className="flex items-center justify-between p-5 pb-3 shrink-0">
                <div className="flex items-center gap-2">
                    <RiSparkling2Fill className="text-[#e85d56] text-xl" />
                    <span className="text-base font-bold text-[#e85d56]">Notes Agent</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 border border-stone-300 rounded-full px-2 py-0.5">
                        preview
                    </span>
                </div>
                <button
                    onClick={resetConversation}
                    title="Clear conversation"
                    className="text-stone-400 hover:text-red-500 hover:bg-red-50 p-1 rounded-full transition-colors cursor-pointer"
                >
                    <IoMdClose className="text-xl" />
                </button>
            </div>

            {/* messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 flex flex-col gap-3">
                {messages.length === 0 && !isBusy && (
                    <p className="text-[#494949] text-sm font-medium leading-relaxed border-l-[3px] border-[#e85d56]/50 pl-4">
                        Ask anything about your notes. This preview can search and discuss them;
                        it can't change anything yet.
                    </p>
                )}

                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed font-medium ${
                            message.role === 'user'
                                ? 'self-end bg-[#dd5e57] text-white whitespace-pre-wrap'
                                : message.isError
                                    ? 'self-start bg-red-50 text-red-700 border border-red-200 whitespace-pre-wrap'
                                    : 'self-start bg-white/60 text-[#494949] border border-black/5'
                        }`}
                    >
                        {message.role === 'assistant' && !message.isError ? (
                            <>
                                <ReactMarkdown components={markdownComponents}>
                                    {message.text}
                                </ReactMarkdown>
                                {message.drafts?.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-black/5 flex flex-wrap gap-1.5">
                                        {message.drafts.map((staged, idx) => (
                                            <span
                                                key={`${staged.tabId}-${idx}`}
                                                className="text-[10px] font-semibold text-[#7a4a12] bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5"
                                            >
                                                {staged.kind === 'edit' ? '✎ edit staged' : '✎ draft staged'}{staged.title ? `: ${staged.title || 'Untitled'}` : ''} — review in dock
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {message.citations?.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-black/5 flex flex-wrap gap-1.5">
                                        {message.citations.map((citation) => (
                                            <button
                                                key={citation.noteId}
                                                onClick={() => handleOpenCitation(citation.noteId)}
                                                title="Open this note"
                                                disabled={Boolean(openingNoteId)}
                                                className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border transition-colors cursor-pointer disabled:opacity-50 ${
                                                    openingNoteId === citation.noteId
                                                        ? 'text-[#e85d56] bg-red-50 border-[#e85d56]/40 animate-pulse'
                                                        : 'text-stone-500 bg-stone-100 border-stone-200 hover:text-[#e85d56] hover:border-[#e85d50]/40'
                                                }`}
                                            >
                                                {citation.title || 'Untitled note'}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            message.text
                        )}
                    </div>
                ))}

                {isBusy && (
                    <div className="self-start flex gap-1.5 px-4 py-3">
                        {[0, 1, 2].map(i => (
                            <span
                                key={i}
                                className="w-2 h-2 rounded-full bg-[#e85d56] animate-bounce"
                                style={{ animationDelay: `${i * 0.15}s` }}
                            />
                        ))}
                    </div>
                )}

                <div ref={scrollAnchorRef} />
            </div>

            {/* composer */}
            <div className="shrink-0 p-4 pt-2 border-t border-black/5">
                <div className="flex items-end gap-2 bg-white/70 border border-black/10 rounded-2xl px-4 py-2">
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        placeholder="Ask about your notes…"
                        className="flex-1 bg-transparent outline-none text-sm text-[#494949] font-medium resize-none py-2 max-h-32"
                    />
                    <button
                        onClick={handleSend}
                        disabled={isBusy || !draft.trim()}
                        title="Send"
                        className="shrink-0 p-2 rounded-full bg-[#dd5e57] text-white hover:bg-[#fb6d65] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                        <IoMdSend className="text-base" />
                    </button>
                </div>
                <p className="text-[10px] text-stone-400 font-medium mt-2">
                    Enter to send · Shift+Enter for a new line · restores after refresh, auto-clears in 3 days
                </p>
            </div>
        </div>
    );
};

export default AgentChatPanel;
