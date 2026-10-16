import { Component, useEffect, useRef, useState } from 'react';
import { RiSparkling2Fill } from 'react-icons/ri';
import { IoMdSend } from 'react-icons/io';
import { IoAdd, IoSettingsOutline, IoStop } from 'react-icons/io5';
import { MdDeleteOutline, MdHistory, MdOutlineEdit } from 'react-icons/md';
import { BsPinAngle, BsPinAngleFill } from 'react-icons/bs';
import ReactMarkdown from 'react-markdown';
import axiosInstance from '../../utils/axiosInstance';
import { bulkDoneLabel, CHAT_LIMIT, reviewPicks, useAgentStore } from '../../store/useAgentStore';
import { useTabsStore } from '../../store/useTabsStore';

const CHAT_TITLE_MAX = 80;

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

// Catches a render error below it and shows `fallback` instead, so one bad
// message (e.g. a list saved in a shape the screen doesn't expect) can't
// blank the whole app. The error still goes to the console.
class RenderGuard extends Component {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error, info) {
        console.error('[agent] render failed:', error, info?.componentStack);
    }

    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

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

// A change in a few words (the server sends `title`; older lists don't).
const changeTitle = (c) => {
    if (c.title) return c.title;
    if (c.action === 'move' && c.params?.newFolderName) return `Move to new folder “${c.params.newFolderName}”`;
    if (c.action === 'move') return c.params?.targetFolderId ? `Move to “${c.params?.targetFolderName || 'that folder'}”` : 'Move out of folders';
    if (c.action === 'tag') return `Tags ${[...(c.params?.add || []).map((t) => `+#${t}`), ...(c.params?.remove || []).map((t) => `−#${t}`)].join(' ')}`;
    if (c.action === 'archive') return c.params?.archived === false ? 'Unarchive' : 'Archive';
    return 'Send to trash (recoverable)';
};

const reviewHeading = (p, otherChanges) => {
    const found = `${plural(p.candidates.length, 'note')}`;
    if (p.groups.length > 0 && otherChanges.length === 0) return `${plural(p.groups.length, 'group')} of related notes — ${found}`;
    if (p.changes.length === 1) return `${changeTitle(p.changes[0])} — ${found} found`;
    return `${p.changes.length} changes — ${found}`;
};

// Grouping: one block per group — its two changes ("move to a new folder",
// "tag") as tick boxes for the whole group, and its notes (each can be left
// out; ones that may not fit start out).
const GroupBlock = ({ group, proposal, editable, onToggleChange, onToggleNote, onOpenNote }) => {
    const notes = new Map(proposal.candidates.map((c) => [c.noteId, c]));
    const titles = new Map(proposal.changes.map((c) => [c.key, changeTitle(c)]));
    const isOn = (change) => group.noteIds.some((id) => proposal.ticked.includes(`${id}|${change}`));
    return (
        <div className="rounded-lg border border-stone-200 bg-white/80 p-2.5 flex flex-col gap-1.5">
            <p className="text-xs font-semibold">{group.name} <span className="font-normal text-stone-500">· {plural(group.noteIds.length, 'note')}</span></p>
            <div className="flex flex-col gap-0.5">
                {group.changes.map((change) => (
                    <label key={change} className={`flex items-center gap-2 text-[11px] font-semibold ${editable ? 'cursor-pointer' : ''}`}>
                        <input type="checkbox" className="accent-[#dd5e57]" checked={isOn(change)} disabled={!editable} onChange={() => onToggleChange(change)} />
                        {titles.get(change)}
                    </label>
                ))}
            </div>
            <div className="flex flex-col gap-0.5 pl-1 border-l-2 border-stone-200">
                {group.noteIds.map((noteId) => {
                    const c = notes.get(noteId);
                    if (!c) return null;
                    const out = proposal.excluded.includes(noteId);
                    const misfit = c.items.find((i) => i.verdict !== 'likely');
                    return (
                        <label key={noteId} className={`flex items-start gap-2 pl-1.5 text-[11px] ${editable ? 'cursor-pointer' : ''} ${out ? 'opacity-60' : ''}`}>
                            <input type="checkbox" className="mt-0.5 accent-[#dd5e57]" checked={!out} disabled={!editable} onChange={() => onToggleNote(noteId)} />
                            <span className="min-w-0 flex-1">
                                <button type="button" onClick={(e) => { e.preventDefault(); onOpenNote(noteId); }}
                                    className="font-semibold text-stone-700 hover:text-[#e85d56] hover:underline cursor-pointer text-left">
                                    {c.title || 'Untitled note'}
                                </button>
                                {misfit && <span className="text-amber-700"> · may not fit: {misfit.reason}</span>}
                            </span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
};

// Changes prepared while another list was pending: kept aside (not appliable)
// until the user adds them to that list or shows them after finishing it.
const HeldCard = ({ proposal, onRelease, onDiscard }) => {
    const busy = Boolean(proposal.releasing);
    const tooMany = proposal.heldReason === 'too-many';
    // Found by a topic search, some notes may be unlikely matches (they'd
    // start unticked): count the likely ones.
    const likely = proposal.candidates.filter((c) => c.items.some((i) => i.verdict === 'likely')).length;
    const unlikely = proposal.candidates.length - likely;
    return (
        <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 flex flex-col gap-2 text-[#5c4a2a]">
            <p className="text-xs font-semibold">
                Prepared: {proposal.changes.map(changeTitle).join(' · ')} — {plural(likely, 'note')}
                {unlikely > 0 && <span className="font-normal"> (+{unlikely} unlikely, unticked)</span>}
            </p>
            <p className="text-[11px]">
                {tooMany
                    ? 'Adding these would take your pending list over 50 notes, so they wait until you apply or discard it.'
                    : 'You have a review list waiting for Apply, so these are kept separate for now.'}
            </p>
            <div className="flex flex-wrap gap-1.5">
                {!tooMany && (
                    <button disabled={busy} onClick={() => onRelease('add')} className={`${pillButton} bg-[#dd5e57] text-white border-[#dd5e57] hover:bg-[#fb6d65]`}>
                        {proposal.releasing === 'add' ? 'Adding…' : 'Add to the pending list'}
                    </button>
                )}
                <button disabled={busy} onClick={() => onRelease('show')} className={`${pillButton} border-amber-400 hover:bg-amber-100`}>
                    {proposal.releasing === 'show' ? 'Opening…' : 'Show it after'}
                </button>
                <button disabled={busy} onClick={onDiscard} className={`${pillButton} border-stone-300 text-stone-600 hover:bg-stone-100`}>Discard</button>
            </div>
            {proposal.error && <p className="text-[11px] text-red-700">{proposal.error}</p>}
        </div>
    );
};

// One change on one note: tick box, what it does to this note, why it's listed.
const ReviewItem = ({ item, checked, editable, onToggle, titles, showLabel }) => (
    <label className={`flex items-start gap-2 ${editable ? 'cursor-pointer' : ''}`}>
        <input type="checkbox" className="mt-0.5 accent-[#dd5e57]" checked={checked} disabled={!editable} onChange={onToggle} />
        <span className={`min-w-0 flex-1 text-[11px] ${item.verdict === 'rejected' && !checked ? 'opacity-60' : ''}`}>
            {showLabel && item.label && <span className="font-semibold text-stone-700">{item.label} · </span>}
            <span className={item.verdict === 'unjudged' ? 'text-amber-700' : 'text-stone-500'}>
                {item.verdict === 'unjudged' ? '⚠ ' : ''}{item.reason}
            </span>
            {item.clashesWith?.length > 0 && (
                <span className="block text-amber-700">
                    Clashes with {item.clashesWith.map((k) => titles.get(k) || k).join(', ')} — tick one.
                </span>
            )}
        </span>
    </label>
);

// A bulk change waiting for approval (architecture plan §2.3): one row per
// note with a tick box per change, one Apply for everything ticked, then
// Done · Undo.
const ReviewList = ({ proposal, onToggle, onApply, onUndo, onDiscard, onOpenNote, onToggleGroupChange, onToggleGroupNote, onRelease, onOpenChat, isBusy }) => {
    if (proposal.status === 'moved') {
        const { movedTo } = proposal;
        if (!movedTo) return <p className="text-[11px] text-stone-500 italic">This list moved to a newer message — it's kept up to date there.</p>;
        return (
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] text-stone-500 italic">This list moved to your chat “{movedTo.title}” — it's kept up to date there.</p>
                <button
                    onClick={() => onOpenChat(movedTo.chatId)}
                    disabled={isBusy}
                    title={isBusy ? 'Wait for the answer (or press Stop) first' : undefined}
                    className={`${pillButton} border-stone-300 text-stone-600 hover:bg-stone-100 disabled:cursor-not-allowed`}
                >
                    Open that chat
                </button>
            </div>
        );
    }
    if (proposal.status === 'held') return <HeldCard proposal={proposal} onRelease={onRelease} onDiscard={onDiscard} />;
    // Closed without applying: one line, no rows.
    if (proposal.status === 'discarded' || proposal.status === 'replaced') {
        return (
            <p className="text-[11px] text-stone-500 italic">
                {proposal.changes.map(changeTitle).join(' · ')} — {proposal.status === 'discarded' ? 'discarded, nothing was changed.' : 'replaced by a newer list.'}
            </p>
        );
    }
    const { status, ticked, receipt } = proposal;
    const editable = status === 'open';
    const titles = new Map(proposal.changes.map((c) => [c.key, changeTitle(c)]));
    // Changes shown per group (grouping) vs per note (everything else).
    const grouped = new Set(proposal.groups.flatMap((g) => g.changes));
    const otherChanges = proposal.changes.filter((c) => !grouped.has(c.key));
    const rows = proposal.candidates
        .map((c) => ({ ...c, items: c.items.filter((i) => !grouped.has(i.change)) }))
        .filter((c) => c.items.length > 0);
    // Per-note labels say more than the heading when there are several
    // changes, or for tags ("#Work → #work-z").
    const showLabel = otherChanges.length > 1 || otherChanges[0]?.action === 'tag';
    const noteCount = reviewPicks(proposal).length;
    return (
        <div className="rounded-xl border border-stone-300 bg-white/70 p-3 flex flex-col gap-2 text-[#494949]">
            <p className="text-xs font-semibold">{reviewHeading(proposal, otherChanges)}</p>
            {otherChanges.length > 1 && (
                <p className="text-[11px] text-stone-500 -mt-1">{otherChanges.map(changeTitle).join(' · ')}</p>
            )}
            <div className="flex flex-col gap-1 max-h-72 overflow-y-auto editor-scrollbar">
                {proposal.groups.map((group, index) => (
                    <GroupBlock
                        key={group.name}
                        group={group}
                        proposal={proposal}
                        editable={editable}
                        onToggleChange={(change) => onToggleGroupChange(index, change)}
                        onToggleNote={(noteId) => onToggleGroupNote(index, noteId)}
                        onOpenNote={onOpenNote}
                    />
                ))}
                {rows.map((c) => (
                    <div key={c.noteId} className={`flex flex-col gap-0.5 rounded-lg px-1.5 py-1 ${editable ? 'hover:bg-stone-100' : ''}`}>
                        <button
                            type="button"
                            onClick={() => onOpenNote(c.noteId)}
                            className="text-xs font-semibold truncate max-w-full text-left hover:text-[#e85d56] hover:underline cursor-pointer"
                            title="Open this note"
                        >
                            {c.title || 'Untitled note'}
                            <span className="font-normal text-stone-400"> · {c.folder || 'No folder'}</span>
                        </button>
                        {c.items.map((item) => (
                            <ReviewItem
                                key={item.change}
                                item={item}
                                checked={ticked.includes(`${c.noteId}|${item.change}`)}
                                editable={editable}
                                onToggle={() => onToggle(c.noteId, item.change)}
                                titles={titles}
                                showLabel={showLabel}
                            />
                        ))}
                    </div>
                ))}
            </div>

            {status === 'expired' && (
                <p className="text-[11px] text-stone-600">This list expired — ask again to get a fresh one.</p>
            )}
            {status === 'replaced' && (
                <p className="text-[11px] text-stone-600">Replaced by a newer list below — it includes these changes.</p>
            )}
            {status === 'discarded' && (
                <p className="text-[11px] text-stone-600">Discarded — nothing was changed.</p>
            )}
            {(status === 'open' || status === 'applying') && (
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={onApply}
                        disabled={status === 'applying' || noteCount === 0}
                        className="text-xs font-semibold rounded-full px-4 py-1.5 bg-[#dd5e57] text-white hover:bg-[#fb6d65] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {status === 'applying' ? 'Applying…' : `Apply to ${plural(noteCount, 'note')}`}
                    </button>
                    {status === 'open' && (
                        <button onClick={onDiscard} className={`${pillButton} border-stone-300 text-stone-600 hover:bg-stone-100`}>
                            Discard
                        </button>
                    )}
                </div>
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
        {choices.expired && <p className="text-[11px] text-stone-600">These choices expired — ask again to get fresh ones.</p>}
        <div className="flex flex-wrap gap-1.5">
            {choices.parts.map((part) => (
                <button
                    key={part.index}
                    onClick={() => onOpen(part.index)}
                    disabled={choices.opening !== null || choices.expired}
                    className="text-[11px] font-semibold rounded-full px-3 py-1 border border-stone-300 hover:bg-stone-100 disabled:opacity-50 cursor-pointer"
                >
                    {choices.opening === part.index ? 'Opening…' : `${part.label} (${part.count})`}
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

// ── Chat list (up to CHAT_LIMIT): open, rename, pin, delete ──
const DAY_MS = 24 * 60 * 60 * 1000;

const expiryHint = (chat) => {
    if (chat.pinned || !chat.expiresAt) return 'Pinned — kept until you delete it';
    const days = Math.max(0, Math.ceil((new Date(chat.expiresAt).getTime() - Date.now()) / DAY_MS));
    return days <= 1 ? 'Erased within a day if unused' : `Erased in ${days} days if unused`;
};

const iconButton = 'p-1 rounded-full text-stone-400 hover:text-[#e85d56] hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

const ChatRow = ({ chat, isActive, disabled, onOpen, onRename, onTogglePin, onDelete }) => {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(chat.title);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const saveTitle = async () => {
        const clean = title.trim();
        if (clean && clean !== chat.title && !(await onRename(clean))) return;
        setTitle(clean || chat.title);
        setEditing(false);
    };

    return (
        <div className={`rounded-xl border p-2.5 flex flex-col gap-1 ${isActive ? 'border-[#e85d56]/50 bg-white' : 'border-stone-300 bg-white/70'}`}>
            <div className="flex items-center gap-1.5 min-w-0">
                {editing ? (
                    <input
                        autoFocus
                        value={title}
                        maxLength={CHAT_TITLE_MAX}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') saveTitle();
                            if (e.key === 'Escape') { setTitle(chat.title); setEditing(false); }
                        }}
                        className="flex-1 min-w-0 text-sm font-semibold text-[#494949] bg-white border border-stone-300 rounded-lg px-2 py-0.5 outline-none focus:border-[#e85d56]/60"
                    />
                ) : (
                    <button
                        onClick={onOpen}
                        disabled={disabled}
                        title={disabled ? 'Wait for the answer (or press Stop) first' : 'Open this chat'}
                        className="flex-1 min-w-0 text-left text-sm font-semibold text-[#494949] truncate hover:text-[#e85d56] cursor-pointer disabled:cursor-not-allowed"
                    >
                        {chat.pinned && <BsPinAngleFill className="inline text-[#e85d56] text-xs mr-1 -mt-0.5" />}
                        {chat.title}
                    </button>
                )}
                <button onClick={() => setEditing(true)} title="Rename" className={iconButton}><MdOutlineEdit className="text-base" /></button>
                <button onClick={onTogglePin} title={chat.pinned ? 'Unpin (erased 3 days after its last message)' : 'Pin (never erased)'} className={iconButton}>
                    {chat.pinned ? <BsPinAngleFill className="text-sm text-[#e85d56]" /> : <BsPinAngle className="text-sm" />}
                </button>
                <button onClick={() => setConfirmingDelete(true)} disabled={disabled && isActive} title="Delete" className={iconButton}>
                    <MdDeleteOutline className="text-base" />
                </button>
            </div>
            {confirmingDelete ? (
                <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-stone-600">Delete this chat? Changes already applied stay in Activity.</span>
                    <button onClick={() => { setConfirmingDelete(false); onDelete(); }} className={`${pillButton} border-red-300 text-red-700 hover:bg-red-50`}>Delete</button>
                    <button onClick={() => setConfirmingDelete(false)} className={`${pillButton} border-stone-300 text-stone-600 hover:bg-stone-100`}>Cancel</button>
                </div>
            ) : (
                <p className="text-[11px] text-stone-500">
                    {isActive ? 'Open now · ' : ''}{expiryHint(chat)}
                </p>
            )}
        </div>
    );
};

const ChatList = ({ chats, error, activeChatId, isBusy, onOpen, onRename, onTogglePin, onDelete }) => {
    if (error) return <p className="text-sm text-red-700 px-1">{error}</p>;
    if (!chats) return <p className="text-sm text-stone-500 px-1">Loading chats…</p>;
    if (chats.length === 0) return <p className="text-sm text-stone-500 px-1">No saved chats yet. A chat is saved when you send its first message.</p>;
    return (
        <div className="flex flex-col gap-2">
            <p className="text-[11px] text-stone-500 px-1">{chats.length} of {CHAT_LIMIT} chats</p>
            {chats.map((chat) => (
                <ChatRow
                    key={chat.chatId}
                    chat={chat}
                    isActive={chat.chatId === activeChatId}
                    disabled={isBusy}
                    onOpen={() => onOpen(chat.chatId)}
                    onRename={(title) => onRename(chat.chatId, title)}
                    onTogglePin={() => onTogglePin(chat.chatId)}
                    onDelete={() => onDelete(chat.chatId)}
                />
            ))}
        </div>
    );
};

// ── Activity log (past bulk changes, backed by receipts) ──
const RECEIPT_TTL_DAYS = 10;
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
                        {r.changes?.length > 1 && (
                            <p className="text-[11px] text-stone-600">{r.changes.map(changeTitle).join(' · ')}</p>
                        )}
                        <p className="text-[11px] text-stone-500">
                            {created.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                            {r.instruction && !(r.changes?.length > 1) ? ` · “${r.instruction}”` : ''}
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
    const chats = useAgentStore((state) => state.chats);
    const chatsError = useAgentStore((state) => state.chatsError);
    const activeChatId = useAgentStore((state) => state.activeChatId);
    const isOpeningChat = useAgentStore((state) => state.isOpeningChat);
    const scrollTarget = useAgentStore((state) => state.scrollTarget);
    const loadChats = useAgentStore((state) => state.loadChats);
    const openChat = useAgentStore((state) => state.openChat);
    const newChat = useAgentStore((state) => state.newChat);
    const renameChat = useAgentStore((state) => state.renameChat);
    const togglePin = useAgentStore((state) => state.togglePin);
    const deleteChat = useAgentStore((state) => state.deleteChat);
    const resolvePendingEdit = useAgentStore((state) => state.resolvePendingEdit);
    const toggleReviewItem = useAgentStore((state) => state.toggleReviewItem);
    const discardReviewList = useAgentStore((state) => state.discardReviewList);
    const applyReviewList = useAgentStore((state) => state.applyReviewList);
    const undoReviewList = useAgentStore((state) => state.undoReviewList);
    const openSplitChoice = useAgentStore((state) => state.openSplitChoice);
    const toggleGroupChange = useAgentStore((state) => state.toggleGroupChange);
    const toggleGroupNote = useAgentStore((state) => state.toggleGroupNote);
    const releaseHeld = useAgentStore((state) => state.releaseHeld);
    const scopes = useAgentStore((state) => state.scopes);
    const activity = useAgentStore((state) => state.activity);
    const activityError = useAgentStore((state) => state.activityError);
    const loadScopes = useAgentStore((state) => state.loadScopes);
    const setScope = useAgentStore((state) => state.setScope);
    const loadActivity = useAgentStore((state) => state.loadActivity);
    const undoFromActivity = useAgentStore((state) => state.undoFromActivity);
    // 'chat' | 'history' | 'settings' — the panel shows one at a time. History
    // holds the chat list and the activity log (two tabs, one button).
    const [view, setView] = useState('chat');
    const [historyTab, setHistoryTab] = useState('chats');
    const showHistoryTab = (tab) => {
        if (tab === 'chats') loadChats();
        else loadActivity();
        setHistoryTab(tab);
    };
    const switchView = (next) => {
        const target = view === next ? 'chat' : next;
        if (target === 'history') showHistoryTab(historyTab);
        if (target === 'settings') loadScopes();
        setView(target);
    };
    const handleOpenChat = async (chatId) => {
        await openChat(chatId);
        if (useAgentStore.getState().activeChatId === chatId) setView('chat');
    };
    const handleNewChat = () => {
        newChat();
        if (useAgentStore.getState().activeChatId === null && useAgentStore.getState().messages.length === 0) setView('chat');
    };
    const activeTitle = activeChatId ? chats?.find((c) => c.chatId === activeChatId)?.title : null;
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

    // A used split-choice / group-card button: bring its review list into
    // view and briefly outline it.
    useEffect(() => {
        const element = scrollTarget && document.getElementById(`agent-message-${scrollTarget.messageId}`);
        if (!element) return undefined;
        const outline = ['ring-2', 'ring-[#e85d56]/60'];
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add(...outline);
        const timer = setTimeout(() => element.classList.remove(...outline), 1500);
        return () => {
            clearTimeout(timer);
            element.classList.remove(...outline);
        };
    }, [scrollTarget]);

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
                        onClick={handleNewChat}
                        disabled={isBusy}
                        title={isBusy ? 'Wait for the answer (or press Stop) first' : 'New chat'}
                        className="p-1 rounded-full transition-colors cursor-pointer text-stone-400 hover:text-[#e85d56] hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <IoAdd className="text-xl" />
                    </button>
                    <button
                        onClick={() => switchView('history')}
                        title={view === 'history' ? 'Back to chat' : 'History — your chats and past bulk changes'}
                        className={`p-1 rounded-full transition-colors cursor-pointer ${view === 'history' ? 'text-[#e85d56] bg-red-50' : 'text-stone-400 hover:text-[#e85d56] hover:bg-red-50'}`}
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
                </div>
            </div>

            {view === 'settings' && (
                <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
                    <AgentSettings scopes={scopes} onChange={setScope} />
                </div>
            )}

            {view === 'history' && (
                <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 flex flex-col gap-3">
                    <div className="flex gap-1.5">
                        {[['chats', 'Chats'], ['activity', 'Activity']].map(([tab, label]) => (
                            <button
                                key={tab}
                                onClick={() => showHistoryTab(tab)}
                                className={`${pillButton} ${historyTab === tab ? 'bg-[#dd5e57] text-white border-[#dd5e57]' : 'border-stone-300 text-stone-600 hover:bg-stone-100'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {historyTab === 'chats' ? (
                        <ChatList
                            chats={chats}
                            error={chatsError}
                            activeChatId={activeChatId}
                            isBusy={isBusy}
                            onOpen={handleOpenChat}
                            onRename={renameChat}
                            onTogglePin={togglePin}
                            onDelete={deleteChat}
                        />
                    ) : (
                        <ActivityLog activity={activity} error={activityError} onUndo={undoFromActivity} />
                    )}
                </div>
            )}

            {view === 'chat' && <>
            {/* messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 flex flex-col gap-3">
                {(activeTitle || isOpeningChat) && (
                    <p className="text-[11px] font-semibold text-stone-500 truncate">
                        {isOpeningChat ? 'Opening chat…' : activeTitle}
                    </p>
                )}
                {messages.length === 0 && !isBusy && !isOpeningChat && (
                    <p className="text-[#494949] text-sm font-medium leading-relaxed border-l-[3px] border-[#e85d56]/50 pl-4">
                        Ask anything about your notes. I can search and summarize them, list your
                        tags and folders, and draft new notes or edits for you to review — nothing
                        is saved until you save it.
                    </p>
                )}

                {messages.map((message) => (
                    <div
                        key={message.id}
                        id={`agent-message-${message.id}`}
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed font-medium transition-shadow ${
                            message.role === 'user'
                                ? 'self-end bg-[#dd5e57] text-white whitespace-pre-wrap'
                                : message.isError
                                    ? 'self-start bg-red-50 text-red-700 border border-red-200 whitespace-pre-wrap'
                                    : 'self-start bg-white/60 text-[#494949] border border-black/5'
                        }`}
                    >
                        {message.role === 'assistant' && !message.isError ? (
                            <RenderGuard fallback={<p className="text-[11px] text-red-700">This message couldn't be shown.</p>}>
                                <ReactMarkdown components={markdownComponents}>
                                    {message.text}
                                </ReactMarkdown>
                                {message.proposal && (
                                    <div className="mt-2">
                                        <ReviewList
                                            proposal={message.proposal}
                                            onToggle={(noteId, change) => toggleReviewItem(message.id, noteId, change)}
                                            onApply={() => applyReviewList(message.id)}
                                            onUndo={() => undoReviewList(message.id)}
                                            onDiscard={() => discardReviewList(message.id)}
                                            onOpenNote={handleOpenCitation}
                                            onToggleGroupChange={(index, change) => toggleGroupChange(message.id, index, change)}
                                            onToggleGroupNote={(index, noteId) => toggleGroupNote(message.id, index, noteId)}
                                            onRelease={(how) => releaseHeld(message.id, how)}
                                            onOpenChat={handleOpenChat}
                                            isBusy={isBusy}
                                        />
                                    </div>
                                )}
                                {message.splitChoices && (
                                    <div className="mt-2">
                                        <SplitChoices choices={message.splitChoices} onOpen={(index) => openSplitChoice(message.id, index)} />
                                    </div>
                                )}
                                {message.oldGroupCards && (
                                    <p className="mt-2 text-[11px] text-stone-500 italic">These group suggestions are from an older version — ask again to get them as a review list.</p>
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
                            </RenderGuard>
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
                    Enter to send · Shift+Enter for a new line · each chat is erased 3 days after its last message, unless pinned
                </p>
            </div>
            </>}
        </div>
    );
};

const GuardedAgentChatPanel = () => (
    <RenderGuard fallback={<p className="text-sm text-red-700 p-5">The agent panel hit an error — reload the page.</p>}>
        <AgentChatPanel />
    </RenderGuard>
);

export default GuardedAgentChatPanel;
