import { memo, useContext, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { MdErrorOutline, MdOutlineEdit, MdArrowForward } from 'react-icons/md';
import { useTabsStore } from '../../store/useTabsStore';
import PendingEditCard from './PendingEditCard';
import ReviewList, { SplitChoices } from './ReviewList';
import { FADE_IN, OpeningNoteContext, RISE_SPRING } from './agentStyles';
import { RenderGuard } from './agentUi';
import { useEdgeFade } from '../TabDock/useEdgeFade';

// Markdown inside the agent's cream card, in the note card's style
const markdownComponents = {
  p: ({ node, ...props }) => <p className="mb-3 last:mb-0" data-type={node?.type} {...props} />,
  strong: ({ node, ...props }) => <strong className="font-semibold text-[#333]" data-type={node?.type} {...props} />,
  h1: ({ node, ...props }) => <p className="text-base font-semibold text-[#333] mb-2" data-type={node?.type} {...props} />,
  h2: ({ node, ...props }) => <p className="text-base font-semibold text-[#333] mb-2" data-type={node?.type} {...props} />,
  h3: ({ node, ...props }) => <p className="font-semibold text-[#333] mb-1.5" data-type={node?.type} {...props} />,
  ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-3 last:mb-0 marker:text-[#9c9892]" data-type={node?.type} {...props} />,
  ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-3 last:mb-0 marker:text-[#9c9892]" data-type={node?.type} {...props} />,
  li: ({ node, ...props }) => <li className="mb-1 pl-0.5" data-type={node?.type} {...props} />,
  a: ({ node, ...props }) => <a className="text-[#d97757] underline underline-offset-2 hover:text-[#e85d56]" data-type={node?.type} {...props} />,
  code: ({ node, ...props }) => <code className="font-mono text-[0.85em] bg-black/5 px-1 py-px rounded" data-type={node?.type} {...props} />,
  pre: ({ node, ...props }) => <pre className="font-mono text-xs bg-black/5 rounded-xl p-3 my-2 overflow-x-auto whitespace-pre-wrap" data-type={node?.type} {...props} />,
  blockquote: ({ node, ...props }) => <blockquote className="pl-3 border-l-2 border-[#e8dcc8] text-stone-500 italic mb-3" data-type={node?.type} {...props} />,
};

// One card per note. The server de-duplicates now, but conversations saved before that can still
// hold repeats (and cards are keyed by note ID).
const uniqueCitations = (citations) => {
  const seen = new Set();
  return citations.filter((c) => !seen.has(c.noteId) && seen.add(c.noteId));
};

const MetaLine = ({ children }) => (
  <p className="px-1 text-[11px] md:text-xs font-medium tracking-[0.15em] uppercase text-stone-500">{children}</p>
);

// Cited notes as small versions of the home grid's note cards; tap opens the note in the dock.
// On phones a row that scrolls sideways (no scrollbar, its edges fading like the dock's strip).
const Citations = ({ citations, onOpen }) => {
  const openingNoteId = useContext(OpeningNoteContext);
  const rowRef = useRef(null);
  const updateRowFade = useEdgeFade(rowRef, 'x', 24, citations.length);
  return (
  <div className="flex flex-col gap-2">
    <MetaLine>Sources</MetaLine>
    <div ref={rowRef} onScroll={updateRowFade} className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:overflow-visible">
      {uniqueCitations(citations).map((citation) => (
        <button
          key={citation.noteId}
          onClick={() => onOpen(citation.noteId)}
          title="Open this note"
          disabled={Boolean(openingNoteId)}
          className={`w-[220px] shrink-0 sm:w-auto text-left agent-cream rounded-[20px] bg-[#f8ecdc] border border-gray-700 p-3 md:p-3.5 min-w-0 cursor-pointer transition-colors duration-150 hover:bg-[#f2e3cf] disabled:cursor-default disabled:hover:bg-[#f8ecdc] ${
            openingNoteId === citation.noteId ? 'animate-pulse' : openingNoteId ? 'opacity-60' : ''
          }`}
        >
          <p className="text-base font-semibold tracking-tight text-[#e85d56] leading-tight truncate">
            {citation.title || 'Untitled note'}
          </p>
          {citation.snippet && (
            <p className="text-[13px] font-medium leading-snug text-[#494949] mt-1 line-clamp-2">{citation.snippet}</p>
          )}
          {citation.tags?.length > 0 && (
            <div className="flex gap-1.5 mt-2 overflow-hidden">
              {citation.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="shrink-0 text-xs font-semibold text-stone-600 bg-black/5 rounded-full px-2 py-0.5">#{tag}</span>
              ))}
            </div>
          )}
        </button>
      ))}
    </div>
  </div>
  );
};

// A draft or edit the agent put in the dock, as a mini note card (the sources' style): tap to open its
// tab and review it. Once that tab is closed, an edit opens the note as it is now; a closed draft is
// gone, so its card just says so. (It used to be a coral chip that said "in your dock" and did nothing,
// with the same note again under Sources.)
const StagedCard = ({ staged, onOpenNote }) => {
  const isOpen = useTabsStore((s) => s.openTabs.some((t) => t._id === staged.tabId));
  const isEdit = staged.kind === 'edit';
  const canOpen = isOpen || isEdit;
  const open = () => {
    if (isOpen) useTabsStore.getState().setActiveTab(staged.tabId);
    else if (isEdit) onOpenNote(staged.tabId);
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={!canOpen}
      title={canOpen ? 'Open it' : undefined}
      className="group/staged w-[220px] shrink-0 sm:w-auto text-left agent-cream rounded-[20px] bg-[#f8ecdc] border border-gray-700 p-3 md:p-3.5 min-w-0 transition-colors duration-150 cursor-pointer hover:bg-[#f2e3cf] disabled:cursor-default disabled:hover:bg-[#f8ecdc] disabled:opacity-60"
    >
      <p className="flex items-center gap-1 text-[11px] md:text-xs font-medium tracking-[0.12em] uppercase text-stone-500">
        <MdOutlineEdit className="shrink-0" />
        {isOpen ? (isEdit ? 'Unsaved edit' : 'New draft · unsaved') : (isEdit ? 'Edit · tab closed' : 'Draft · closed')}
      </p>
      <p className="mt-1 text-base font-semibold tracking-tight text-[#e85d56] leading-tight truncate">{staged.title || 'Untitled note'}</p>
      {canOpen && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-stone-500 group-hover/staged:text-[#333] transition-colors">
          {isOpen ? 'Open to review' : 'Open the note'}
          <MdArrowForward className="transition-transform duration-150 group-hover/staged:translate-x-0.5" />
        </p>
      )}
    </button>
  );
};

const StagedCards = ({ drafts, onOpenNote }) => (
  <div className="flex flex-col gap-2">
    <MetaLine>To review</MetaLine>
    <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:overflow-visible">
      {drafts.map((staged, idx) => <StagedCard key={`${staged.tabId}-${idx}`} staged={staged} onOpenNote={onOpenNote} />)}
    </div>
  </div>
);

// Something arriving: rises a little and settles, growing from its own side
const Arrive = ({ side, className, children, ...props }) => (
  <motion.div
    initial={{ opacity: 0, y: 8, scale: 0.98 }}
    animate={{ opacity: 1, y: 0, scale: 1, transition: { default: RISE_SPRING, opacity: FADE_IN } }}
    style={{ originX: side === 'right' ? 1 : 0, originY: 1 }}
    className={className}
    {...props}
  >
    {children}
  </motion.div>
);

const AgentMessage = memo(({ message, actions }) => {
  const id = `agent-message-${message.id}`;
  // Parsed once per text: ticking a review-list box makes a new message object, which would
  // otherwise parse the whole answer again
  const answer = useMemo(
    () => (message.text ? <ReactMarkdown components={markdownComponents}>{message.text}</ReactMarkdown> : null),
    [message.text],
  );

  if (message.role === 'user') {
    return (
      <Arrive side="right" id={id} className="self-end max-w-[85%] md:max-w-[75%] rounded-[20px] rounded-br-md bg-white/[0.07] border border-white/5 px-4 py-2.5 text-sm md:text-[15px] leading-relaxed font-medium text-stone-200 whitespace-pre-wrap break-words">
        {message.text}
      </Arrive>
    );
  }

  if (message.isError) {
    return (
      <Arrive side="left" id={id} className="self-start max-w-[92%] flex items-start gap-2 rounded-[20px] rounded-bl-md bg-red-500/10 border border-red-400/20 px-4 py-3 text-sm md:text-[15px] font-medium text-red-300 whitespace-pre-wrap">
        <MdErrorOutline className="shrink-0 text-base mt-0.5" />
        <span>{message.text}</span>
      </Arrive>
    );
  }

  const { proposal, splitChoices, pendingEdits, drafts, citations } = message;
  const stagedIds = new Set((drafts || []).filter((d) => d.kind === 'edit').map((d) => d.tabId));
  const sources = (citations || []).filter((c) => !stagedIds.has(c.noteId));
  return (
    // The id + ring: a used split-choice / group button scrolls here and outlines it briefly
    // The agent's side stops short of the right edge (your messages own that side), so the two read
    // apart at a glance; a margin, so the jump-to outline still hugs the reply
    <Arrive side="left" id={id} className="self-stretch mr-8 md:mr-16 flex flex-col gap-2 rounded-[22px] transition-shadow">
      <RenderGuard fallback={<p className="px-1 text-xs text-red-300">This message couldn't be shown.</p>}>
        {message.text && (
          <div className="agent-cream self-start max-w-full rounded-[20px] rounded-bl-md bg-[#f4eadc] border border-[#e8dcc8] px-4 md:px-5 py-3 md:py-3.5 text-sm md:text-[15px] leading-relaxed font-medium text-[#494949] break-words">
            {answer}
          </div>
        )}
        {proposal && (
          <ReviewList
            proposal={proposal}
            onToggle={(noteId, change) => actions.toggleReviewItem(message.id, noteId, change)}
            onApply={() => actions.applyReviewList(message.id)}
            onUndo={() => actions.undoReviewList(message.id)}
            onDiscard={() => actions.discardReviewList(message.id)}
            onOpenNote={actions.openNote}
            onToggleGroupChange={(index, change) => actions.toggleGroupChange(message.id, index, change)}
            onToggleGroupNote={(index, noteId) => actions.toggleGroupNote(message.id, index, noteId)}
            onRelease={(how) => actions.releaseHeld(message.id, how)}
            onOpenChat={actions.openChat}
          />
        )}
        {splitChoices && <SplitChoices choices={splitChoices} onOpen={(index) => actions.openSplitChoice(message.id, index)} />}
        {message.oldGroupCards && (
          <p className="px-1 text-xs text-stone-400">These group suggestions are from an older version — ask again to get them as a review list.</p>
        )}
        {pendingEdits?.map((edit, idx) => (
          <PendingEditCard key={`${edit.noteId}-${idx}`} edit={edit} onAction={(action) => actions.resolvePendingEdit(message.id, idx, action)} />
        ))}
        {drafts?.length > 0 && <StagedCards drafts={drafts} onOpenNote={actions.openNote} />}
        {/* Sources, minus any note already shown above as an edit to review */}
        {sources.length > 0 && <Citations citations={sources} onOpen={actions.openNote} />}
      </RenderGuard>
    </Arrive>
  );
});
AgentMessage.displayName = 'AgentMessage';

export default AgentMessage;
