import { useEffect, useRef, useState } from 'react';
import { RiSparkling2Fill } from 'react-icons/ri';
import { IoMdClose, IoMdSend } from 'react-icons/io';
import { IoStop } from 'react-icons/io5';
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

// One pill per note. The server de-duplicates now, but conversations saved
// before that can still hold repeats (and pills are keyed by note ID).
const uniqueCitations = (citations) => {
    const seen = new Set();
    return citations.filter((c) => !seen.has(c.noteId) && seen.add(c.noteId));
};

// Red/green line diff, same look as the editor's agent banner.
const DiffView = ({ parts }) => (
    <div className="max-h-48 overflow-y-auto editor-scrollbar rounded-lg border border-amber-200 bg-white/70 p-2 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
        {parts.map((part, idx) => (
            <span
                key={idx}
                className={part.added
                    ? 'bg-emerald-100 text-emerald-900'
                    : part.removed ? 'bg-red-100 text-red-900 line-through' : 'text-stone-400'}
            >
                {part.value}
            </span>
        ))}
    </div>
);

const pillButton = 'text-[11px] font-semibold rounded-full px-3 py-1 border transition-colors cursor-pointer disabled:opacity-50';

// An agent edit to a note with unsaved changes: nothing changes in the tab
// until the user picks Apply / Apply & save / Skip (architecture plan D21).
const PendingEditCard = ({ edit, onAction }) => {
    const [showDiff, setShowDiff] = useState(false);
    const title = edit.title || 'Untitled note';
    const working = edit.status === 'working';

    return (
        <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 flex flex-col gap-2 text-[#7a4a12]">
            <p className="text-xs font-semibold">✎ Edit to “{title}”</p>

            {(edit.status === 'pending' || working) && (
                <>
                    <p className="text-[11px] font-medium">
                        {edit.basedOnUnsaved
                            ? 'Made on your unsaved version of this note. Nothing changes until you choose.'
                            : 'This note has unsaved changes now. Nothing changes until you choose.'}
                    </p>
                    {edit.titleChange && (
                        <p className="text-[11px]">
                            Title: <span className="line-through text-red-700">{edit.titleChange.from || '(untitled)'}</span>{' → '}
                            <span className="text-emerald-700">{edit.titleChange.to || '(untitled)'}</span>
                        </p>
                    )}
                    {edit.otherChanges.length > 0 && (
                        <p className="text-[11px]">Also changes: {edit.otherChanges.map((k) => (k === 'isChecklist' ? 'checklist mode' : k)).join(', ')}</p>
                    )}
                    {edit.diff && (
                        <button onClick={() => setShowDiff((v) => !v)} className="self-start text-[11px] font-semibold underline cursor-pointer">
                            {showDiff ? 'Hide changes' : 'Show changes'}
                        </button>
                    )}
                    {showDiff && edit.diff && <DiffView parts={edit.diff} />}
                    <div className="flex flex-wrap gap-1.5">
                        <button disabled={working} onClick={() => onAction('apply')} className={`${pillButton} bg-[#dd5e57] text-white border-[#dd5e57] hover:bg-[#fb6d65]`}>Apply</button>
                        <button disabled={working} onClick={() => onAction('applySave')} className={`${pillButton} border-amber-400 hover:bg-amber-100`}>Apply &amp; save</button>
                        <button disabled={working} onClick={() => onAction('skip')} className={`${pillButton} border-stone-300 text-stone-600 hover:bg-stone-100`}>Skip</button>
                    </div>
                </>
            )}

            {edit.status === 'conflict' && (
                <>
                    <p className="text-[11px] font-medium">
                        This note changed since the assistant read it. Applying replaces those changes with the assistant’s version.
                    </p>
                    {edit.showConflictDiff && edit.conflictDiff && <DiffView parts={edit.conflictDiff} />}
                    <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => onAction('toggleConflictDiff')} className={`${pillButton} border-amber-400 hover:bg-amber-100`}>
                            {edit.showConflictDiff ? 'Hide changes' : 'View changes'}
                        </button>
                        <button onClick={() => onAction('applyAnyway')} className={`${pillButton} bg-[#dd5e57] text-white border-[#dd5e57] hover:bg-[#fb6d65]`}>Apply anyway</button>
                        <button onClick={() => onAction('skip')} className={`${pillButton} border-stone-300 text-stone-600 hover:bg-stone-100`}>Skip</button>
                    </div>
                </>
            )}

            {edit.status === 'applied' && (
                <p className="text-[11px] font-medium">
                    {edit.saved ? 'Applied and saving…' : 'Applied — open in your dock, unsaved. “Revert agent edit” there puts back what you had.'}
                </p>
            )}
            {edit.status === 'skipped' && <p className="text-[11px] font-medium">Skipped — your note is unchanged.</p>}
            {edit.status === 'failed' && <p className="text-[11px] font-medium text-red-700">{edit.reason || 'Could not apply this edit.'}</p>}
        </div>
    );
};

const AgentChatPanel = () => {
    const messages = useAgentStore((state) => state.messages);
    const isBusy = useAgentStore((state) => state.isBusy);
    const steps = useAgentStore((state) => state.steps);
    const sendMessage = useAgentStore((state) => state.sendMessage);
    const stop = useAgentStore((state) => state.stop);
    const wake = useAgentStore((state) => state.wake);
    const resetConversation = useAgentStore((state) => state.resetConversation);
    const resolvePendingEdit = useAgentStore((state) => state.resolvePendingEdit);
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

    // Restore any persisted conversation the first time the panel mounts, and
    // start waking the (possibly sleeping) assistant services while the user
    // types.
    useEffect(() => {
        hydrate();
        wake();
    }, [hydrate, wake]);

    useEffect(() => {
        scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages.length, isBusy, steps.length]);

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
                        Ask anything about your notes. I can search and summarize them, list your
                        tags and folders, and draft new notes or edits for you to review — nothing
                        is saved until you save it.
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
                                {message.pendingEdits?.length > 0 && (
                                    <div className="mt-2 flex flex-col gap-2">
                                        {message.pendingEdits.map((edit, idx) => (
                                            <PendingEditCard
                                                key={`${edit.noteId}-${idx}`}
                                                edit={edit}
                                                onAction={(action) => resolvePendingEdit(message.id, idx, action)}
                                            />
                                        ))}
                                    </div>
                                )}
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
                                        {uniqueCitations(message.citations).map((citation) => (
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
                    <div className="self-start flex flex-col gap-1 px-4 py-3">
                        {/* Progress lines from the server; the last one is the current step. */}
                        {steps.map((label, idx) => (
                            <span
                                key={`${idx}-${label}`}
                                className={`text-xs font-medium ${
                                    idx === steps.length - 1 ? 'text-[#494949]' : 'text-stone-400'
                                }`}
                            >
                                {label}
                            </span>
                        ))}
                        <div className="flex gap-1.5 pt-1">
                            {[0, 1, 2].map(i => (
                                <span
                                    key={i}
                                    className="w-2 h-2 rounded-full bg-[#e85d56] animate-bounce"
                                    style={{ animationDelay: `${i * 0.15}s` }}
                                />
                            ))}
                        </div>
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
                    {isBusy ? (
                        <button
                            onClick={stop}
                            title="Stop"
                            className="shrink-0 p-2 rounded-full bg-stone-600 text-white hover:bg-stone-500 transition-colors cursor-pointer"
                        >
                            <IoStop className="text-base" />
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={!draft.trim()}
                            title="Send"
                            className="shrink-0 p-2 rounded-full bg-[#dd5e57] text-white hover:bg-[#fb6d65] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                            <IoMdSend className="text-base" />
                        </button>
                    )}
                </div>
                <p className="text-[10px] text-stone-400 font-medium mt-2">
                    Enter to send · Shift+Enter for a new line · restores after refresh, auto-clears in 3 days
                </p>
            </div>
        </div>
    );
};

export default AgentChatPanel;
