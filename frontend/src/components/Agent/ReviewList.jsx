import { LuArrowRight, LuUndo2 } from 'react-icons/lu';
import {
  MdOutlineFolder, MdOutlineArchive, MdOutlineUnarchive, MdDeleteOutline, MdCheck, MdErrorOutline, MdArrowOutward,
  MdKeyboardArrowDown,
} from 'react-icons/md';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { bulkDoneLabel, reviewPicks, useAgentStore } from '../../store/useAgentStore';
import { btnChip, btnPrimary, btnQuiet, changeTitle, HEIGHT_SPRING, plural, SWAP } from './agentStyles';
import { Collapse, Sheet, SheetFooter, SheetHeader, TickIcon } from './agentUi';

// A review list: the changes the agent prepared, for the user to tick and Apply. Several changes are
// shown one section per change, its notes as pills to tap (a tag rename used to repeat itself on
// every note's row); a single change as rows, each note with its own reason; grouping as a section
// per group. One surface (the cream sheet), sections set apart by space; coral only for what's new and
// for Apply; a note left out is what stands out, not the default of everything in.

// What kind of changes, when they're all one kind ("8 tag changes")
const ACTION_NOUNS = { tag: 'tag changes', move: 'moves', archive: 'archive changes' };

const reviewHeading = (p, otherChanges) => {
  const found = plural(p.candidates.length, 'note');
  if (p.groups.length > 0 && otherChanges.length === 0) return `${plural(p.groups.length, 'group')} of related notes · ${found}`;
  if (p.changes.length === 1) return found;
  const actions = new Set(p.changes.map((c) => c.action));
  const noun = (actions.size === 1 && ACTION_NOUNS[[...actions][0]]) || 'changes';
  return `${p.changes.length} ${noun} · ${found}`;
};

// ── A change, drawn ──
// Old tag muted, new tag dark and bold — the change reads at a glance without a colour of its own
const TagChip = ({ tag, isNew = false, removed = false }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
    isNew ? 'bg-[#fbf7f0] border border-black/10 font-semibold text-[#333]' : 'bg-black/[0.05] font-medium text-stone-500'
  } ${removed ? 'line-through decoration-stone-400' : ''}`}>
    #{tag}
  </span>
);

const Arrow = () => <LuArrowRight className="shrink-0 text-stone-400 text-sm" />;

// Tag changes as the editor's tag chips (old muted, new coral); moves, archiving and trash as an icon
// and a word. Falls back to the change's own title.
export const ChangeLabel = ({ change }) => {
  const p = change.params || {};
  if (change.action === 'tag') {
    const add = p.add || [];
    const remove = p.remove || [];
    if (add.length === 1 && remove.length === 1) {
      return <span className="inline-flex flex-wrap items-center gap-1.5"><TagChip tag={remove[0]} /><Arrow /><TagChip tag={add[0]} isNew /></span>;
    }
    if (add.length || remove.length) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {add.map((t) => <span key={`+${t}`} className="inline-flex items-center gap-1 text-xs text-stone-500">add <TagChip tag={t} isNew /></span>)}
          {remove.map((t) => <span key={`-${t}`} className="inline-flex items-center gap-1 text-xs text-stone-500">remove <TagChip tag={t} removed /></span>)}
        </span>
      );
    }
  }
  if (change.action === 'move') {
    const name = p.newFolderName || p.targetFolderName;
    if (!p.targetFolderId && !p.newFolderName) return <span className="font-semibold text-[#333]">Move out of folders</span>;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-stone-500">
        Move to
        <span className="inline-flex items-center gap-1 font-semibold text-[#333]"><MdOutlineFolder className="text-stone-500" />{name || 'that folder'}</span>
        {p.newFolderName && <span className="text-xs text-stone-400">new folder</span>}
      </span>
    );
  }
  if (change.action === 'archive') {
    const un = p.archived === false;
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-[#333]">
        {un ? <MdOutlineUnarchive className="text-stone-500" /> : <MdOutlineArchive className="text-stone-500" />}{un ? 'Unarchive' : 'Archive'}
      </span>
    );
  }
  if (change.action === 'trash') {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-[#333]">
        <MdDeleteOutline className="text-stone-500" />Send to trash <span className="font-normal text-xs text-stone-400">recoverable</span>
      </span>
    );
  }
  return <span className="font-semibold text-[#333]">{changeTitle(change)}</span>;
};

// ── Notes ──
// A note as a pill: tap to put it in or leave it out of this change; ↗ opens it. In: a plain light
// pill (the default, so it stays quiet). Out: a dashed outline, its name struck through — the change
// you made is what shows.
const NotePill = ({ title, checked, editable, warn, onToggle, onOpen }) => (
  <span className={`group/pill inline-flex items-center max-w-full rounded-full border transition-colors duration-150 ${
    checked ? 'bg-[#fbf7f0] border-black/[0.08]' : 'border-dashed border-stone-300'
  } ${editable ? (checked ? 'hover:border-black/20' : 'hover:border-stone-400') : ''} ${warn ? 'ring-1 ring-amber-500/50' : ''}`}>
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={!editable}
      onClick={onToggle}
      className={`min-w-0 pl-2.5 pr-1 py-0.5 rounded-l-full text-xs md:text-[13px] font-medium truncate transition-colors ${
        checked ? 'text-[#333]' : 'text-stone-400 line-through decoration-stone-300'
      } ${editable ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {title || 'Untitled note'}
    </button>
    <button
      type="button"
      onClick={onOpen}
      title="Open this note"
      className="shrink-0 pl-0.5 pr-2 py-0.5 rounded-r-full text-stone-400 hover:text-[#333] transition-all cursor-pointer opacity-70 md:opacity-0 md:group-hover/pill:opacity-100 focus-visible:opacity-100"
    >
      <MdArrowOutward className="text-sm" />
    </button>
  </span>
);

// A note's folder, when it's in one (the note card's badge, without the colour: lists carry only its name)
const FolderChip = ({ name }) => (
  <span className="shrink-0 inline-flex items-center gap-1 max-w-[140px] text-xs font-medium px-2 py-0.5 rounded-full bg-black/5 text-stone-500">
    <MdOutlineFolder className="shrink-0" />
    <span className="truncate">{name}</span>
  </span>
);

// Something to look at under a section: a clash, a note that may not fit, one that couldn't be judged
const Notice = ({ tone = 'amber', children }) => (
  <p className={`flex items-start gap-1.5 text-xs leading-snug ${tone === 'amber' ? 'text-amber-700' : 'text-stone-500'}`}>
    <MdErrorOutline className="shrink-0 mt-px" />
    <span>{children}</span>
  </p>
);

// A section sits straight on the sheet, set apart by space alone (no tinted box, no divider)
const Section = ({ children }) => <div className="flex flex-col gap-1.5">{children}</div>;

// A shared reason is the list's filter ("tagged #containers"): worth one line, unless it only says
// what the change already shows (renaming #containers, found by being tagged #containers)
const sharedReason = (items, change) => {
  if (items.length === 0 || items.some((i) => i.verdict !== 'likely' || i.reason !== items[0].reason)) return null;
  const reason = items[0].reason;
  const removed = change?.action === 'tag' ? change.params?.remove || [] : [];
  return removed.some((t) => reason === `tagged #${t}`) ? null : reason;
};

// Several changes: one line per change — its tick turns it on/off for all its notes, "3 notes ▾" opens
// them as pills (each can be left out). Folded by default: a note shared by several changes was
// listed under each, and the notes are detail. Opens by itself when something needs a look (a clash,
// a note that may not fit, one that couldn't be judged). Memoised on this change's ticks.
const ChangeSection = memo(({ change, notes, tickedKey, editable, titles, onToggle, onOpenNote }) => {
  const ticked = new Set(tickedKey ? tickedKey.split(',') : []);
  const keyOf = (noteId) => `${noteId}|${change.key}`;
  const onCount = notes.filter((n) => ticked.has(keyOf(n.noteId))).length;
  const all = notes.length > 0 && onCount === notes.length;
  const some = onCount > 0 && !all;
  const hasNotice = notes.some((n) => n.item.clashesWith?.length > 0 || n.item.verdict !== 'likely');
  const [isOpen, setIsOpen] = useState(hasNotice);
  const toggleAll = () => {
    for (const n of notes) if (ticked.has(keyOf(n.noteId)) !== !all) onToggle(n.noteId, change.key);
  };
  const reason = sharedReason(notes.map((n) => n.item), change);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          role="checkbox"
          aria-checked={all ? true : some ? 'mixed' : false}
          disabled={!editable}
          onClick={toggleAll}
          className={`flex items-center gap-2.5 min-w-0 flex-1 py-1 -ml-1.5 pl-1.5 rounded-lg text-left text-xs md:text-[13px] transition-[opacity,background-color] duration-150 ${
            onCount === 0 ? 'opacity-40' : ''
          } ${editable ? 'cursor-pointer hover:bg-black/[0.04]' : 'cursor-default'}`}
        >
          <TickIcon checked={all} partial={some} />
          <ChangeLabel change={change} />
        </button>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          aria-expanded={isOpen}
          title={isOpen ? 'Hide the notes' : 'Show the notes'}
          className="shrink-0 inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs text-stone-500 hover:text-[#333] hover:bg-black/5 transition-colors cursor-pointer"
        >
          {hasNotice && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
          <LiveText>{some ? `${onCount} of ${plural(notes.length, 'note')}` : plural(notes.length, 'note')}</LiveText>
          <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={HEIGHT_SPRING} className="flex">
            <MdKeyboardArrowDown className="text-sm" />
          </motion.span>
        </button>
      </div>
      <Collapse isOpen={isOpen}>
        <div className="pl-[28px] pt-0.5 pb-2 flex flex-col gap-1.5">
          {reason && <p className="text-xs text-stone-400">{reason}</p>}
          <div className="flex flex-wrap gap-1">
            {notes.map((n) => (
              <NotePill
                key={n.noteId}
                title={n.title}
                checked={ticked.has(keyOf(n.noteId))}
                editable={editable}
                warn={n.item.clashesWith?.length > 0 || n.item.verdict === 'unjudged'}
                onToggle={() => onToggle(n.noteId, change.key)}
                onOpen={() => onOpenNote(n.noteId)}
              />
            ))}
          </div>
          {notes.map((n) => {
            const { item } = n;
            const name = <span className="font-semibold">{n.title || 'Untitled note'}</span>;
            return (
              <div key={`notice-${n.noteId}`} className="flex flex-col gap-1 empty:hidden">
                {item.clashesWith?.length > 0 && (
                  <Notice>{name}: clashes with {item.clashesWith.map((k) => titles.get(k) || k).join(', ')} — tick one.</Notice>
                )}
                {!reason && item.verdict === 'unjudged' && <Notice>{name}: {item.reason}</Notice>}
                {!reason && item.verdict === 'rejected' && <Notice tone="stone">{name} may not fit: {item.reason}</Notice>}
              </div>
            );
          })}
        </div>
      </Collapse>
    </div>
  );
});
ChangeSection.displayName = 'ChangeSection';

// One change: a row per note — a round check, the note, its folder, and why it's listed (unless every
// note shares one reason, which then shows once under the heading)
const NoteRow = memo(({ row, change, checked, editable, showReason, titles, onToggle, onOpenNote }) => {
  const item = row.items.find((i) => i.change === change.key);
  if (!item) return null;
  const dimmed = item.verdict === 'rejected' && !checked;
  const toggle = () => editable && onToggle(row.noteId, change.key);
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-disabled={!editable}
      tabIndex={editable ? 0 : -1}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
      className={`group/row flex items-start gap-3 px-2.5 py-1.5 rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#e85d56]/40 ${
        editable ? 'cursor-pointer hover:bg-black/[0.04]' : 'cursor-default'
      } ${dimmed ? 'opacity-60' : ''}`}
    >
      <span className="pt-0.5"><TickIcon checked={checked} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className={`truncate text-sm font-medium ${checked ? 'text-[#333]' : 'text-stone-500'}`}>{row.title || 'Untitled note'}</span>
          {row.folder && <FolderChip name={row.folder} />}
        </span>
        {showReason && (
          <span className={`block mt-0.5 text-xs leading-snug ${item.verdict === 'unjudged' ? 'text-amber-700' : 'text-stone-500'}`}>{item.reason}</span>
        )}
        {item.clashesWith?.length > 0 && (
          <span className="block mt-1"><Notice>Clashes with {item.clashesWith.map((k) => titles.get(k) || k).join(', ')} — tick one.</Notice></span>
        )}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpenNote(row.noteId); }}
        title="Open this note"
        className="shrink-0 p-1 -m-0.5 rounded-full text-stone-400 hover:text-[#e85d56] hover:bg-black/5 transition-all cursor-pointer opacity-70 md:opacity-0 md:group-hover/row:opacity-100 focus-visible:opacity-100"
      >
        <MdArrowOutward className="text-sm" />
      </button>
    </div>
  );
});
NoteRow.displayName = 'NoteRow';

// Grouping: a section per group — its changes ("move to a new folder", "tag") as chips for the whole
// group, its notes as pills (each can be left out; ones that may not fit start out)
const GroupSection = ({ group, proposal, editable, onToggleChange, onToggleNote, onOpenNote }) => {
  const notes = new Map(proposal.candidates.map((c) => [c.noteId, c]));
  const changes = new Map(proposal.changes.map((c) => [c.key, c]));
  const isOn = (change) => group.noteIds.some((id) => proposal.ticked.includes(`${id}|${change}`));
  return (
    <Section>
      <p className="text-sm font-semibold text-[#333]">
        {group.name} <span className="font-medium text-xs text-stone-400">{plural(group.noteIds.length, 'note')}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {group.changes.map((change) => {
          const on = isOn(change);
          return (
            <button
              key={change}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={!editable}
              onClick={() => onToggleChange(change)}
              className={`inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border text-xs md:text-[13px] transition-colors duration-150 ${
                on ? 'bg-[#fbf7f0] border-black/[0.08]' : 'border-dashed border-stone-300'
              } ${editable ? (on ? 'cursor-pointer hover:border-black/20' : 'cursor-pointer hover:border-stone-400') : 'cursor-default'}`}
            >
              <TickIcon checked={on} small />
              {changes.get(change) ? <ChangeLabel change={changes.get(change)} /> : <span>{change}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {group.noteIds.map((noteId) => {
          const c = notes.get(noteId);
          if (!c) return null;
          const misfit = c.items.find((i) => i.verdict !== 'likely');
          return (
            <NotePill
              key={noteId}
              title={c.title}
              checked={!proposal.excluded.includes(noteId)}
              editable={editable}
              warn={Boolean(misfit)}
              onToggle={() => onToggleNote(noteId)}
              onOpen={() => onOpenNote(noteId)}
            />
          );
        })}
      </div>
      {group.noteIds.map((noteId) => {
        const c = notes.get(noteId);
        const misfit = c?.items.find((i) => i.verdict !== 'likely');
        return misfit ? <Notice key={`misfit-${noteId}`}><span className="font-semibold">{c.title || 'Untitled note'}</span> may not fit: {misfit.reason}</Notice> : null;
      })}
    </Section>
  );
};

// Changes prepared while another list was pending: kept aside (not appliable) until the user adds
// them to that list or shows them after finishing it. Dashed — visibly waiting.
const HeldSheet = ({ proposal, onRelease, onDiscard }) => {
  const busy = Boolean(proposal.releasing);
  const tooMany = proposal.heldReason === 'too-many';
  // Found by a topic search, some notes may be unlikely matches (they'd start unticked): count the likely ones.
  const likely = proposal.candidates.filter((c) => c.items.some((i) => i.verdict === 'likely')).length;
  const unlikely = proposal.candidates.length - likely;
  return (
    <Sheet dashed>
      <SheetHeader
        title={<>Prepared · {plural(likely, 'note')}{unlikely > 0 && <span className="font-medium text-stone-500"> (+{unlikely} unlikely, unticked)</span>}</>}
        subtitle={tooMany
          ? 'Adding these would take your pending list over 50 notes, so they wait until you apply or discard it.'
          : 'You have a review list waiting for Apply, so these are kept separate for now.'}
      />
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {proposal.changes.map((c) => <span key={c.key} className="inline-flex items-center rounded-full border border-black/10 px-2.5 py-1 text-xs md:text-[13px]"><ChangeLabel change={c} /></span>)}
      </div>
      {proposal.error && <p className="px-4 pb-2 text-xs text-[#c0493f]">{proposal.error}</p>}
      <SheetFooter stateKey={proposal.releasing || 'held'}>
        <button disabled={busy} onClick={onDiscard} className={`${btnQuiet} mr-auto`}>Discard</button>
        <button disabled={busy} onClick={() => onRelease('show')} className={btnChip}>
          {proposal.releasing === 'show' ? 'Opening…' : 'Show it after'}
        </button>
        {!tooMany && (
          <button disabled={busy} onClick={() => onRelease('add')} className={btnPrimary}>
            {proposal.releasing === 'add' ? 'Adding…' : 'Add to the pending list'}
          </button>
        )}
      </SheetFooter>
    </Sheet>
  );
};

// A number that changes in place (the toast's crossfade), so the counts read as live
const LiveText = ({ children }) => (
  <span className="relative inline-flex">
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={String(children)} {...SWAP}>{children}</motion.span>
    </AnimatePresence>
  </span>
);

// The footer of a review list, by status
const ReviewFooter = ({ proposal, noteCount, onApply, onDiscard, onUndo, sticky }) => {
  const { status, receipt } = proposal;
  if (status === 'open' || status === 'applying') {
    return (
      <SheetFooter stateKey="open" sticky={sticky}>
        <span className="px-1.5 mr-auto text-xs text-stone-400">
          {noteCount === 0 ? 'Nothing selected' : <><LiveText>{plural(noteCount, 'note')}</LiveText> will change</>}
        </span>
        {status === 'open' && <button onClick={onDiscard} className={btnQuiet}>Discard</button>}
        <button onClick={onApply} disabled={status === 'applying' || noteCount === 0} className={`${btnPrimary} active:scale-[0.97]`}>
          {/* One span: as separate flex items the button's gap spaced the count too wide */}
          {status === 'applying' ? 'Applying…' : <span>Apply to <LiveText>{plural(noteCount, 'note')}</LiveText></span>}
        </button>
      </SheetFooter>
    );
  }
  if ((status === 'applied' || status === 'undoing') && receipt) {
    return (
      <SheetFooter stateKey="applied" sticky={sticky}>
        <span className="flex items-center gap-1.5 px-1.5 mr-auto text-xs font-medium text-[#494949]">
          <MdCheck className="text-base text-emerald-600 shrink-0" />
          <span>
            {bulkDoneLabel(proposal)} {plural(receipt.counts.applied, 'note')}
            {receipt.counts.skippedChanged > 0 && <span className="text-amber-700"> · {plural(receipt.counts.skippedChanged, 'note')} skipped (changed since this list was made)</span>}
            {receipt.counts.skippedUnchanged > 0 && <span className="text-stone-400"> · {plural(receipt.counts.skippedUnchanged, 'note')} already like that</span>}
          </span>
        </span>
        {/* A real button (the editor's chip), not text: easy to find, without competing with Apply */}
        <button onClick={onUndo} disabled={status === 'undoing'} className={`${btnChip} active:scale-95`}>
          <LuUndo2 className="text-sm" />
          {status === 'undoing' ? 'Undoing…' : 'Undo'}
        </button>
      </SheetFooter>
    );
  }
  const line = status === 'undone' && receipt
    ? `Undone.${receipt.counts.undoSkipped > 0
      ? ` ${plural(receipt.counts.undoSkipped, 'note')} kept your newer edits and ${receipt.counts.undoSkipped === 1 ? 'was' : 'were'} left as they are.`
      : ''}`
    : status === 'expired' ? 'This list expired — ask again to get a fresh one.'
      : null;
  if (!line) return null;
  return (
    <SheetFooter stateKey={status}>
      <span className="px-1.5 text-xs text-stone-500">{line}</span>
    </SheetFooter>
  );
};

// A quiet line under the answer, for a list that lives on elsewhere or was closed
const ClosedPill = ({ proposal }) => {
  const grouped = new Set((proposal.groups || []).flatMap((g) => g.changes));
  const otherChanges = proposal.changes.filter((c) => !grouped.has(c.key));
  const what = proposal.changes.length === 1 && !proposal.groups?.length
    ? `${changeTitle(proposal.changes[0])} · ${plural(proposal.candidates.length, 'note')}`
    : reviewHeading(proposal, otherChanges);
  const discarded = proposal.status === 'discarded';
  return (
    <div className="self-start max-w-full inline-flex items-center rounded-full bg-white/[0.04] border border-white/[0.08] px-3 py-1 text-xs text-stone-400"
      title={proposal.changes.map(changeTitle).join(' · ')}>
      <span className="truncate">
        <span className="text-stone-300">{what}</span> — {discarded ? 'discarded, nothing changed' : 'replaced by a newer list'}
      </span>
    </div>
  );
};

const QuietLine = ({ children }) => (
  <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-stone-400">{children}</div>
);

// A list moved to another chat. Reads "busy" itself, so a turn starting or ending doesn't re-render
// every message.
const MovedLine = ({ movedTo, onOpenChat }) => {
  const isBusy = useAgentStore((s) => s.isBusy);
  return (
    <QuietLine>
      <span>This list moved to your chat “{movedTo.title}” — it's kept up to date there.</span>
      <button
        onClick={() => onOpenChat(movedTo.chatId)}
        disabled={isBusy}
        title={isBusy ? 'Wait for the answer (or press Stop) first' : undefined}
        className="inline-flex items-center gap-1 font-semibold text-stone-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Open that chat <MdArrowOutward />
      </button>
    </QuietLine>
  );
};

// A bulk change waiting for approval (architecture plan §2.3): everything ticked goes in one Apply,
// then Done · Undo
const ReviewList = ({ proposal, onToggle, onApply, onUndo, onDiscard, onOpenNote, onToggleGroupChange, onToggleGroupNote, onRelease, onOpenChat }) => {
  if (proposal.status === 'moved') {
    const { movedTo } = proposal;
    if (!movedTo) return <QuietLine>This list moved to a newer message — it's kept up to date there.</QuietLine>;
    return <MovedLine movedTo={movedTo} onOpenChat={onOpenChat} />;
  }
  if (proposal.status === 'held') return <HeldSheet proposal={proposal} onRelease={onRelease} onDiscard={onDiscard} />;
  // Closed without applying: one small pill — what it was, in the heading's words, and what happened
  // (every change spelled out was a wall of text louder than the live lists). The full list on hover.
  if (proposal.status === 'discarded' || proposal.status === 'replaced') {
    return <ClosedPill proposal={proposal} />;
  }

  return <OpenReviewList proposal={proposal} onToggle={onToggle} onApply={onApply} onUndo={onUndo} onDiscard={onDiscard}
    onOpenNote={onOpenNote} onToggleGroupChange={onToggleGroupChange} onToggleGroupNote={onToggleGroupNote} />;
};

// The list itself (open, applying, applied, undone, expired): heading, sections or rows, footer
const OpenReviewList = ({ proposal, onToggle, onApply, onUndo, onDiscard, onOpenNote, onToggleGroupChange, onToggleGroupNote }) => {
  const { status, ticked } = proposal;
  const editable = status === 'open';
  // Worked out from what ticking leaves untouched (the store keeps the same changes / groups /
  // candidates), so sections and rows stay the same objects and only what changed redraws
  const titles = useMemo(() => new Map(proposal.changes.map((c) => [c.key, changeTitle(c)])), [proposal.changes]);
  // Changes shown per group (grouping) vs on their own (everything else)
  const grouped = useMemo(() => new Set(proposal.groups.flatMap((g) => g.changes)), [proposal.groups]);
  const otherChanges = useMemo(() => proposal.changes.filter((c) => !grouped.has(c.key)), [proposal.changes, grouped]);
  // Per change: its notes, each with its item for that change
  const sections = useMemo(() => otherChanges.map((change) => ({
    change,
    notes: proposal.candidates
      .map((c) => ({ noteId: c.noteId, title: c.title, item: c.items.find((i) => i.change === change.key) }))
      .filter((n) => n.item),
  })), [otherChanges, proposal.candidates]);
  // A stable toggle for the memoised sections and rows (the parent's is remade on every render)
  const onToggleRef = useRef(onToggle);
  useLayoutEffect(() => {
    onToggleRef.current = onToggle;
  });
  const toggle = useCallback((noteId, change) => onToggleRef.current(noteId, change), []);
  const noteCount = reviewPicks(proposal).length;

  // Only a bar with something to press sticks (Apply, or Undo once applied)
  const hasAction = ['open', 'applying', 'applied', 'undoing'].includes(status);
  // A closed list (expired, undone) is shown as a record: dimmed, nothing to act on
  const isClosed = status === 'expired' || status === 'undone';

  const single = otherChanges.length === 1 ? sections[0] : null;
  // One change: a reason every note shares is the filter — shown once, under the heading
  const singleReason = single ? sharedReason(single.notes.map((n) => n.item), single.change) : null;

  return (
    <Sheet>
      <SheetHeader
        title={single && proposal.groups.length === 0 ? <ChangeLabel change={single.change} /> : reviewHeading(proposal, otherChanges)}
        subtitle={single && proposal.groups.length === 0
          ? [plural(single.notes.length, 'note'), singleReason].filter(Boolean).join(' · ')
          : null}
      />
      {/* The rows and the footer share a box that doesn't hold the heading: a sticky footer can't
          leave its box, so it pins to the chat's bottom edge only once the heading has scrolled
          above it, and never covers it. Plain CSS sticky the whole way, so it glides in and out
          with the scroll (switching it on in JS when the list was "reached" came late and popped). */}
      <div>
      <div className={`px-4 pb-3 flex flex-col ${proposal.groups.length > 0 ? 'gap-3' : 'gap-0.5'} transition-opacity ${isClosed ? 'opacity-50' : ''}`}>
        {proposal.groups.map((group, index) => (
          <GroupSection
            key={group.name}
            group={group}
            proposal={proposal}
            editable={editable}
            onToggleChange={(change) => onToggleGroupChange(index, change)}
            onToggleNote={(noteId) => onToggleGroupNote(index, noteId)}
            onOpenNote={onOpenNote}
          />
        ))}
        {single && (
          <div className="flex flex-col">
            {proposal.candidates.map((row) => (
              <NoteRow
                key={row.noteId}
                row={row}
                change={single.change}
                checked={ticked.includes(`${row.noteId}|${single.change.key}`)}
                editable={editable}
                showReason={!singleReason}
                titles={titles}
                onToggle={toggle}
                onOpenNote={onOpenNote}
              />
            ))}
          </div>
        )}
        {!single && sections.map(({ change, notes }) => (
          <ChangeSection
            key={change.key}
            change={change}
            notes={notes}
            // This change's ticks as one string: unchanged for every other section when one is ticked
            tickedKey={ticked.filter((k) => k.endsWith(`|${change.key}`)).join(',')}
            editable={editable}
            titles={titles}
            onToggle={toggle}
            onOpenNote={onOpenNote}
          />
        ))}
      </div>
      {proposal.error && <p className="px-4 pb-2 text-xs text-[#c0493f]">{proposal.error}</p>}
      <ReviewFooter proposal={proposal} noteCount={noteCount} onApply={onApply} onDiscard={onDiscard} onUndo={onUndo} sticky={hasAction} />
      </div>
    </Sheet>
  );
};

// More than 50 matches: pick a part; each opens its own review list
export const SplitChoices = ({ choices, onOpen }) => (
  <Sheet>
    <SheetHeader
      title={`${choices.total} notes matched — too many for one review list`}
      subtitle={choices.expired ? 'These choices expired — ask again to get fresh ones.' : 'Pick a part; each opens its own list.'}
    />
    <div className="flex flex-wrap gap-1.5 px-4 pb-4 pt-1">
      {choices.parts.map((part) => (
        <button
          key={part.index}
          onClick={() => onOpen(part.index)}
          disabled={choices.opening !== null || choices.expired}
          className={btnChip}
        >
          {choices.opening === part.index ? 'Opening…' : <>{part.label} <span className="text-stone-400">· {part.count}</span></>}
        </button>
      ))}
    </div>
  </Sheet>
);

export default ReviewList;
