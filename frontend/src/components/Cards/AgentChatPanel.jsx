import { useEffect, useRef, useState } from 'react';
import { RiSparkling2Fill } from 'react-icons/ri';
import { IoMdClose, IoMdSend } from 'react-icons/io';
import { IoSettingsOutline, IoStop } from 'react-icons/io5';
import { MdHistory } from 'react-icons/md';
import ReactMarkdown from 'react-markdown';
import axiosInstance from '../../utils/axiosInstance';
import { bulkDoneLabel, useAgentStore } from '../../store/useAgentStore';
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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const reviewHeading = (p) => {
    const found = `${plural(p.candidates.length, 'note')} found`;
    if (p.action === 'move') return `Move to “${p.params?.targetFolderName || 'No folder'}” — ${found}`;
    if (p.action === 'tag') {
        const changes = [...(p.params?.add || []).map((t) => `+#${t}`), ...(p.params?.remove || []).map((t) => `−#${t}`)];
        return `Tags ${changes.join(' ')} — ${found}`;
    }
    if (p.action === 'archive') return `${p.params?.archived === false ? 'Unarchive' : 'Archive'} — ${found}`;
    return `Send to trash (recoverable) — ${found}`;
};

// A bulk change waiting for approval (architecture plan §2.3): one row per
// note with a tick box, one Apply for everything ticked, then Done · Undo.
const ReviewList = ({ proposal, onToggle, onApply, onUndo, onOpenNote }) => {
    const { status, ticked, receipt } = proposal;
    const editable = status === 'open';
    return (
        <div className="rounded-xl border border-stone-300 bg-white/70 p-3 flex flex-col gap-2 text-[#494949]">
            <p className="text-xs font-semibold">{reviewHeading(proposal)}</p>
            <div className="flex flex-col gap-1 max-h-72 overflow-y-auto editor-scrollbar">
                {proposal.candidates.map((c) => (
                    <label key={c.noteId} className={`flex items-start gap-2 rounded-lg px-1.5 py-1 ${editable ? 'hover:bg-stone-100 cursor-pointer' : ''}`}>
                        <input
                            type="checkbox"
                            className="mt-0.5 accent-[#dd5e57]"
                            checked={ticked.includes(c.noteId)}
                            disabled={!editable}
                            onChange={() => onToggle(c.noteId)}
                        />
                        <span className={`min-w-0 flex-1 ${c.verdict === 'rejected' && !ticked.includes(c.noteId) ? 'opacity-60' : ''}`}>
                            <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); onOpenNote(c.noteId); }}
                                className="text-xs font-semibold truncate max-w-full text-left hover:text-[#e85d56] hover:underline cursor-pointer"
                                title="Open this note"
                            >
                                {c.title || 'Untitled note'}
                            </button>
                            <span className={`block text-[11px] ${c.verdict === 'unjudged' ? 'text-amber-700' : 'text-stone-500'}`}>
                                {c.folder || 'No folder'} · {c.verdict === 'unjudged' ? '⚠ ' : ''}{c.reason}
                            </span>
                        </span>
                    </label>
                ))}
            </div>

            {(status === 'open' || status === 'applying') && (
                <button
                    onClick={onApply}
                    disabled={status === 'applying' || ticked.length === 0}
                    className="self-start text-xs font-semibold rounded-full px-4 py-1.5 bg-[#dd5e57] text-white hover:bg-[#fb6d65] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                    {status === 'applying' ? 'Applying…' : `Apply to ${plural(ticked.length, 'note')}`}
                </button>
            )}
            {(status === 'applied' || status === 'undoing') && receipt && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-semibold text-emerald-700">
                        Done — {bulkDoneLabel(proposal).toLowerCase()} {plural(receipt.counts.applied, 'note')}.
                    </span>
                    {receipt.counts.skippedChanged > 0 && (
                        <span className="text-amber-700">{plural(receipt.counts.skippedChanged, 'note')} skipped (changed since this list was made).</span>
                    )}
                    {receipt.counts.skippedUnchanged > 0 && (
                        <span className="text-stone-500">{plural(receipt.counts.skippedUnchanged, 'note')} already like that.</span>
                    )}
                    <button
                        onClick={onUndo}
                        disabled={status === 'undoing'}
                        className="font-semibold rounded-full px-3 py-1 border border-stone-300 hover:bg-stone-100 disabled:opacity-50 cursor-pointer"
                    >
                        {status === 'undoing' ? 'Undoing…' : 'Undo'}
                    </button>
                </div>
            )}
            {status === 'undone' && receipt && (
                <p className="text-[11px] text-stone-600">
                    Undone.{receipt.counts.undoSkipped > 0
                        ? ` ${plural(receipt.counts.undoSkipped, 'note')} kept your newer edits and ${receipt.counts.undoSkipped === 1 ? 'was' : 'were'} left as they are.`
                        : ''}
                </p>
            )}
            {proposal.error && <p className="text-[11px] text-red-700">{proposal.error}</p>}
        </div>
    );
};

// More than 50 matches: pick a part; each opens its own review list.
const SplitChoices = ({ choices, onOpen }) => (
    <div className="rounded-xl border border-stone-300 bg-white/70 p-3 flex flex-col gap-2 text-[#494949]">
        <p className="text-xs font-semibold">{choices.total} notes matched — too many for one review list. Pick a part:</p>
        <div className="flex flex-wrap gap-1.5">
            {choices.parts.map((part) => (
                <button
                    key={part.index}
                    onClick={() => onOpen(part.index)}
                    disabled={choices.opening !== null}
                    className="text-[11px] font-semibold rounded-full px-3 py-1 border border-stone-300 hover:bg-stone-100 disabled:opacity-50 cursor-pointer"
                >
                    {choices.opening === part.index ? 'Opening…' : `${part.label} (${part.count})`}
                    {choices.opened.includes(part.index) ? ' ✓' : ''}
                </button>
            ))}
        </div>
    </div>
);

// ── Settings (permission toggles) ──
const ScopeRow = ({ label, hint, checked, disabled, onToggle }) => (
    <label className={`flex items-start gap-3 rounded-xl px-3 py-2 ${disabled ? 'opacity-60' : 'hover:bg-white/60 cursor-pointer'}`}>
        <input type="checkbox" className="mt-1 accent-[#dd5e57]" checked={checked} disabled={disabled} onChange={onToggle} />
        <span>
            <span className="block text-sm font-semibold text-[#494949]">{label}</span>
            <span className="block text-xs text-stone-500">{hint}</span>
        </span>
    </label>
);

const AgentSettings = ({ scopes, onChange }) => {
    if (!scopes) return <p className="text-sm text-stone-500 px-3">Loading settings…</p>;
    return (
        <div className="flex flex-col gap-1">
            <p className="text-xs text-stone-500 px-3 pb-2">What the agent may do. Anything turned off is simply not offered to it.</p>
            <ScopeRow label="Read & search" hint="Always on — search, read and summarize your notes." checked disabled />
            <ScopeRow label="Compose" hint="Draft new notes and propose edits. Nothing is saved until you save it."
                checked={scopes.compose} onToggle={() => onChange('compose', !scopes.compose)} />
            <ScopeRow label="Organize" hint="Prepare bulk moves, tags and archiving as a review list you approve."
                checked={scopes.organize} onToggle={() => onChange('organize', !scopes.organize)} />
            <ScopeRow label="Send to trash" hint="Let bulk changes move notes to the trash (always recoverable; never deletes permanently)."
                checked={scopes.organize && scopes.destructive} disabled={!scopes.organize}
                onToggle={() => onChange('destructive', !scopes.destructive)} />
        </div>
    );
};

// ── Activity log (past bulk changes, backed by receipts) ──
const RECEIPT_TTL_DAYS = 30;
// Notes the change originally touched: undo turns 'applied' ops into
// 'undone' (or 'undo-skipped' when the user had edited them since).
const changedCount = (r) => r.counts.applied + r.counts.undone + r.counts.undoSkipped;

const ActivityLog = ({ activity, error, onUndo }) => {
    if (error) return <p className="text-sm text-red-700 px-1">{error}</p>;
    if (!activity) return <p className="text-sm text-stone-500 px-1">Loading activity…</p>;
    if (activity.length === 0) return <p className="text-sm text-stone-500 px-1">No bulk changes yet. They'll be listed here, with Undo, for {RECEIPT_TTL_DAYS} days.</p>;
    return (
        <div className="flex flex-col gap-2">
            {activity.map((r) => {
                const created = new Date(r.createdAt);
                const until = new Date(created.getTime() + RECEIPT_TTL_DAYS * 24 * 60 * 60 * 1000);
                return (
                    <div key={r.receiptId} className="rounded-xl border border-stone-300 bg-white/70 p-3 flex flex-col gap-1 text-[#494949]">
                        <p className="text-xs font-semibold">
                            {bulkDoneLabel(r)} {plural(changedCount(r), 'note')}
                            {r.action === 'move' && r.params?.targetFolderName ? ` → “${r.params.targetFolderName}”` : ''}
                        </p>
                        <p className="text-[11px] text-stone-500">
                            {created.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                            {r.instruction ? ` · “${r.instruction}”` : ''}
                        </p>
                        {r.counts.skippedChanged > 0 && (
                            <p className="text-[11px] text-amber-700">{plural(r.counts.skippedChanged, 'note')} skipped (had changed before Apply).</p>
                        )}
                        {r.status === 'applied' ? (
                            <div className="flex items-center gap-2 text-[11px]">
                                <button onClick={() => onUndo(r.receiptId)}
                                    className="font-semibold rounded-full px-3 py-1 border border-stone-300 hover:bg-stone-100 cursor-pointer">
                                    Undo
                                </button>
                                <span className="text-stone-500">available until {until.toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
                            </div>
                        ) : (
                            <p className="text-[11px] text-stone-600">
                                {r.status === 'partially-undone' ? 'Partly undone' : 'Undone'}
                                {r.counts.undoSkipped > 0 ? ` — ${plural(r.counts.undoSkipped, 'note')} kept your newer edits.` : '.'}
                            </p>
                        )}
                    </div>
                );
            })}
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
    const toggleReviewNote = useAgentStore((state) => state.toggleReviewNote);
    const applyReviewList = useAgentStore((state) => state.applyReviewList);
    const undoReviewList = useAgentStore((state) => state.undoReviewList);
    const openSplitChoice = useAgentStore((state) => state.openSplitChoice);
    const scopes = useAgentStore((state) => state.scopes);
    const activity = useAgentStore((state) => state.activity);
    const activityError = useAgentStore((state) => state.activityError);
    const loadScopes = useAgentStore((state) => state.loadScopes);
    const setScope = useAgentStore((state) => state.setScope);
    const loadActivity = useAgentStore((state) => state.loadActivity);
    const undoFromActivity = useAgentStore((state) => state.undoFromActivity);
    // 'chat' | 'activity' | 'settings' — the panel shows one at a time.
    const [view, setView] = useState('chat');
    const switchView = (next) => {
        const target = view === next ? 'chat' : next;
        if (target === 'activity') loadActivity();
        if (target === 'settings') loadScopes();
        setView(target);
    };
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
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => switchView('activity')}
                        title={view === 'activity' ? 'Back to chat' : 'Activity — past bulk changes, with Undo'}
                        className={`p-1 rounded-full transition-colors cursor-pointer ${view === 'activity' ? 'text-[#e85d56] bg-red-50' : 'text-stone-400 hover:text-[#e85d56] hover:bg-red-50'}`}
                    >
                        <MdHistory className="text-xl" />
                    </button>
                    <button
                        onClick={() => switchView('settings')}
                        title={view === 'settings' ? 'Back to chat' : 'Agent settings — what the agent may do'}
                        className={`p-1 rounded-full transition-colors cursor-pointer ${view === 'settings' ? 'text-[#e85d56] bg-red-50' : 'text-stone-400 hover:text-[#e85d56] hover:bg-red-50'}`}
                    >
                        <IoSettingsOutline className="text-lg" />
                    </button>
                    {view === 'chat' && (
                        <button
                            onClick={resetConversation}
                            title="Clear conversation"
                            className="text-stone-400 hover:text-red-500 hover:bg-red-50 p-1 rounded-full transition-colors cursor-pointer"
                        >
                            <IoMdClose className="text-xl" />
                        </button>
                    )}
                </div>
            </div>

            {view !== 'chat' && (
                <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
                    {view === 'settings'
                        ? <AgentSettings scopes={scopes} onChange={setScope} />
                        : <ActivityLog activity={activity} error={activityError} onUndo={undoFromActivity} />}
                </div>
            )}

            {view === 'chat' && <>
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
                                {message.proposal && (
                                    <div className="mt-2">
                                        <ReviewList
                                            proposal={message.proposal}
                                            onToggle={(noteId) => toggleReviewNote(message.id, noteId)}
                                            onApply={() => applyReviewList(message.id)}
                                            onUndo={() => undoReviewList(message.id)}
                                            onOpenNote={handleOpenCitation}
                                        />
                                    </div>
                                )}
                                {message.splitChoices && (
                                    <div className="mt-2">
                                        <SplitChoices choices={message.splitChoices} onOpen={(index) => openSplitChoice(message.id, index)} />
                                    </div>
                                )}
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
                                    // Cited notes as small note cards; click to open in the dock.
                                    <div className="mt-2 pt-2 border-t border-black/5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {uniqueCitations(message.citations).map((citation) => (
                                            <button
                                                key={citation.noteId}
                                                onClick={() => handleOpenCitation(citation.noteId)}
                                                title="Open this note"
                                                disabled={Boolean(openingNoteId)}
                                                className={`text-left rounded-xl bg-[#f4eadc] border p-3 transition-all cursor-pointer disabled:opacity-60 min-w-0 ${
                                                    openingNoteId === citation.noteId
                                                        ? 'border-[#e85d56]/50 animate-pulse'
                                                        : 'border-[#e8dcc8] hover:border-[#e85d56]/40 hover:shadow-md'
                                                }`}
                                            >
                                                <p
                                                    className="text-sm font-medium text-[#333] truncate"
                                                    style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                                                >
                                                    {citation.title || 'Untitled note'}
                                                </p>
                                                {citation.snippet && (
                                                    <p className="text-[11px] leading-snug text-stone-500 mt-1 line-clamp-2">
                                                        {citation.snippet}
                                                    </p>
                                                )}
                                                {citation.tags?.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                        {citation.tags.map((tag) => (
                                                            <span key={tag} className="text-[10px] text-[#d55343] bg-[#f2dfd2] rounded-full px-1.5 py-0.5">
                                                                #{tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
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
            </>}
        </div>
    );
};

export default AgentChatPanel;
