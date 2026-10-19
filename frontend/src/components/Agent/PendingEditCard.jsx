import { useState } from 'react';
import { motion } from 'framer-motion';
import { MdKeyboardArrowDown, MdCheck, MdErrorOutline } from 'react-icons/md';
import { btnChip, btnPrimary, btnQuiet, HEIGHT_SPRING } from './agentStyles';
import { Collapse, Sheet, SheetFooter, SheetHeader } from './agentUi';

// The line diff, in the editor's code-box style: added in soft green, removed in soft coral
export const DiffView = ({ parts }) => (
  <div className="max-h-56 overflow-y-auto editor-scrollbar rounded-xl bg-black/5 p-3 text-xs leading-relaxed whitespace-pre-wrap font-mono">
    {parts.map((part, idx) => (
      <span
        key={idx}
        className={part.added
          ? 'bg-emerald-600/15 text-emerald-900 rounded-sm'
          : part.removed ? 'bg-[#e85d56]/15 text-[#a8392f] line-through rounded-sm' : 'text-stone-500'}
      >
        {part.value}
      </span>
    ))}
  </div>
);

// A chip that shows / hides something below it; its chevron turns
const ToggleChip = ({ isOpen, onClick, children }) => (
  <button type="button" onClick={onClick} className={btnChip}>
    {children}
    <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={HEIGHT_SPRING} className="flex">
      <MdKeyboardArrowDown className="text-base" />
    </motion.span>
  </button>
);

const ResultLine = ({ icon, className = 'text-stone-600', children }) => (
  <p className={`flex items-center gap-1.5 px-1.5 text-xs font-medium ${className}`}>{icon}{children}</p>
);

// An agent edit to a note with unsaved changes: nothing changes in the tab until the user picks
// Apply / Apply & save / Skip (architecture plan D21).
const PendingEditCard = ({ edit, onAction }) => {
  const [showDiff, setShowDiff] = useState(false);
  const title = edit.title || 'Untitled note';
  const isWorking = edit.status === 'working';
  const isPending = edit.status === 'pending' || isWorking;
  const isConflict = edit.status === 'conflict';

  const subtitle = isPending
    ? (edit.basedOnUnsaved
      ? 'Made on your unsaved version. Nothing changes until you choose.'
      : 'This note has unsaved changes now. Nothing changes until you choose.')
    : isConflict
      ? 'This note changed since the agent read it. Applying replaces those changes.'
      : null;

  return (
    <Sheet>
      <SheetHeader title={<>Edit to “{title}”</>} subtitle={subtitle} />

      {isPending && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          {edit.titleChange && (
            <p className="text-xs">
              <span className="text-stone-500">Title </span>
              <span className="line-through text-[#c0493f]">{edit.titleChange.from || '(untitled)'}</span>
              <span className="text-stone-400"> → </span>
              <span className="font-semibold text-[#333]">{edit.titleChange.to || '(untitled)'}</span>
            </p>
          )}
          {edit.otherChanges.length > 0 && (
            <p className="text-xs text-stone-500">
              Also changes {edit.otherChanges.map((k) => (k === 'isChecklist' ? 'checklist mode' : k)).join(', ')}
            </p>
          )}
          {edit.diff && (
            <>
              <div><ToggleChip isOpen={showDiff} onClick={() => setShowDiff((v) => !v)}>{showDiff ? 'Hide changes' : 'Show changes'}</ToggleChip></div>
              <Collapse isOpen={showDiff}><DiffView parts={edit.diff} /></Collapse>
            </>
          )}
        </div>
      )}

      {isConflict && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          <div><ToggleChip isOpen={Boolean(edit.showConflictDiff)} onClick={() => onAction('toggleConflictDiff')}>{edit.showConflictDiff ? 'Hide changes' : 'View changes'}</ToggleChip></div>
          <Collapse isOpen={Boolean(edit.showConflictDiff && edit.conflictDiff)}><DiffView parts={edit.conflictDiff || []} /></Collapse>
        </div>
      )}

      <SheetFooter stateKey={edit.status === 'working' ? 'pending' : edit.status}>
        {isPending && (
          <>
            <button disabled={isWorking} onClick={() => onAction('skip')} className={`${btnQuiet} mr-auto`}>Skip</button>
            <button disabled={isWorking} onClick={() => onAction('applySave')} className={btnChip}>Apply &amp; save</button>
            <button disabled={isWorking} onClick={() => onAction('apply')} className={btnPrimary}>Apply</button>
          </>
        )}
        {isConflict && (
          <>
            <button onClick={() => onAction('skip')} className={`${btnQuiet} mr-auto`}>Skip</button>
            <button onClick={() => onAction('applyAnyway')} className={btnPrimary}>Apply anyway</button>
          </>
        )}
        {edit.status === 'applied' && (
          <ResultLine icon={<MdCheck className="text-base text-emerald-600" />}>
            {edit.saved ? 'Applied and saving…' : 'Applied — open in your dock, unsaved. “Revert agent edit” there puts back what you had.'}
          </ResultLine>
        )}
        {edit.status === 'skipped' && <ResultLine>Skipped — your note is unchanged.</ResultLine>}
        {edit.status === 'failed' && (
          <ResultLine icon={<MdErrorOutline className="text-base" />} className="text-[#c0493f]">
            {edit.reason || 'Could not apply this edit.'}
          </ResultLine>
        )}
      </SheetFooter>
    </Sheet>
  );
};

export default PendingEditCard;
