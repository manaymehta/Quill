import { memo, useState, useEffect, useRef, useCallback } from 'react';
import moment from 'moment';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MdOutlinePushPin, MdDelete, MdCheckBoxOutlineBlank, MdCheckBox, MdRestore, MdDeleteForever, MdOutlineArchive, MdOutlineUnarchive } from "react-icons/md";
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Markdown component overrides for the compact card preview ────────────────
// All block-level elements are rendered as <span>s so they stay inside the
// fixed-height (4.5 rem) overflow:hidden preview without breaking card layout.
const CARD_MD_COMPONENTS = {
  h1: ({ children }) => <span className="font-bold text-[#333] block">{children}</span>,
  h2: ({ children }) => <span className="font-bold text-[#444] block">{children}</span>,
  h3: ({ children }) => <span className="font-semibold text-[#444] block">{children}</span>,
  h4: ({ children }) => <span className="font-semibold block">{children}</span>,
  h5: ({ children }) => <span className="font-mmedium block">{children}</span>,
  h6: ({ children }) => <span className="font-medium block">{children}</span>,
  p: ({ children }) => <span className="block">{children}</span>,
  strong: ({ children }) => <span className="font-bold">{children}</span>,
  em: ({ children }) => <span className="italic">{children}</span>,
  del: ({ children }) => <span className="line-through text-stone-400">{children}</span>,
  code: ({ children }) => (
    <code className="font-mono text-xs bg-black/5 px-1 rounded">{children}</code>
  ),
  pre: ({ children }) => <span className="block font-mono text-xs bg-black/5 px-2 py-1 rounded my-0.5">{children}</span>,
  ul: ({ children }) => <span className="block">{children}</span>,
  ol: ({ children }) => <span className="block">{children}</span>,
  li: ({ children, className }) => {
    const isTask = className && className.includes('task-list-item');
    return (
      <span className={`block pl-2 ${isTask ? '' : "before:content-['•'] before:mr-1.5 before:text-[#9c9892]"}`}>
        {children}
      </span>
    );
  },
  input: ({ type, checked }) => {
    if (type === 'checkbox') {
      return checked ? (
        <MdCheckBox className="inline text-[#e85d56] mr-1.5 align-text-bottom text-lg" />
      ) : (
        <MdCheckBoxOutlineBlank className="inline text-[#9c9892] mr-1.5 align-text-bottom text-lg" />
      );
    }
    return <input type={type} checked={checked} readOnly />;
  },
  a: ({ children }) => <span className="text-[#d97757] underline">{children}</span>,
  blockquote: ({ children }) => (
    <span className="block pl-2 border-l-2 border-[#e8dcc8] text-[#78716c] italic">{children}</span>
  ),
  hr: () => <span className="block border-t border-[#e8dcc8] my-1" />,
  // Tables are too wide for a card preview — collapse to a placeholder
  table: () => <span className="text-xs text-stone-400 italic">[table]</span>,
};

// Cheap fallback rendered for cards that are still off-screen. Just plain text,
// no react-markdown parsing, so off-screen cards cost almost nothing on load.
const PREVIEW_CHARS = 150;


const NoteCard = ({
  id, title, date, content, tags,
  isPinned, onEdit, onDelete, onPinned,
  isChecklist, checklist, onChecklistToggle,
  isTrash, onRestore, isArchived, onArchive,
  isOverlay, index = 0,
}) => {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id });

  const style = {
    // Translate instead of Transform preserves exact dimensions without squishing text
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isOverlay ? 100 : (isDragging ? 0 : 'auto'),
    opacity: isOverlay ? 1 : (isDragging ? 0.3 : 1),
  };

  // ── Lazy markdown rendering via Intersection Observer ───────────────────────
  // Problem 3 fix: cards outside the viewport get a cheap plain-text preview.
  // Once a card enters the viewport (or is within 150 px of it), we swap in
  // the full react-markdown render and disconnect the observer permanently.
  // This means a 200-note grid does ~N_visible parses on load, not 200.
  // We initialize the first few notes as true to prevent layout shift on load.
  const [hasBeenVisible, setHasBeenVisible] = useState(index < 8);
  const observerTargetRef = useRef(null);

  // Combine dnd-kit's setNodeRef with our IntersectionObserver ref so both
  // can point at the same root element without conflicting.
  const combinedRef = useCallback((el) => {
    setNodeRef(el);
    observerTargetRef.current = el;
  }, [setNodeRef]);

  useEffect(() => {
    const el = observerTargetRef.current;
    // Skip if already visible once, or element not mounted yet
    if (!el || hasBeenVisible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasBeenVisible(true);
          observer.disconnect(); // one-shot — never fires again
        }
      },
      { rootMargin: '150px 0px' }, // start loading 150px before it enters view
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasBeenVisible]);


  return (
    <div
      ref={combinedRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (e.target.closest('.no-card-click') || isDragging || isOverlay) return;
        onEdit();
      }}
      className={`group border w-full border-gray-700 rounded-[20px] md:rounded-3xl p-3 md:p-4 bg-[#f8ecdc] hover:bg-[#d8cec1] transition-transform transition-shadow duration-200 ease-in-out cursor-grab active:cursor-grabbing
        ${isOverlay ? 'shadow-2xl scale-105 opacity-95' : (isDragging ? '' : 'shadow-xs hover:shadow-xl hover:-translate-y-1')}`}
    >
      <div className="flex flex-col">
        <div className="flex justify-between items-start gap-1">
          <h4 className="text-lg md:text-2xl font-semibold tracking-tight text-[#e85d56] leading-tight">{title}</h4>
          <MdOutlinePushPin
            className={`icon-btn no-card-click transition-opacity duration-200 ${isPinned ? 'text-[#e85d56] opacity-100' : 'text-[#a6a6a6] opacity-0 group-hover:opacity-100'} ${isTrash || isArchived ? 'hidden' : ''} hover:text-slate-600`}
            onClick={onPinned}
          />
        </div>
        <span className="font-medium text-xs text-[#9c9892] mt-1">
          {moment(date).format("Do MMM YYYY")}
        </span>
      </div>

      <div className="mt-2">
        {isChecklist ? (
          <div className="flex flex-col gap-2 mt-2">
            {checklist.slice(0, 3).map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="no-card-click" onClick={(e) => { e.stopPropagation(); onChecklistToggle(index); }}>
                  {item.completed ? <MdCheckBox /> : <MdCheckBoxOutlineBlank />}
                </div>
                <span className={item.completed ? 'line-through text-slate-500' : ''}>{item.text}</span>
              </div>
            ))}
            {checklist.length > 3 && (
              <span className="text-xs text-slate-500">...and {checklist.length - 3} more items.</span>
            )}
          </div>
        ) : (
          <div
            className="font-medium mt-1 md:mt-2 text-[#494949] text-[13px] md:text-sm overflow-hidden whitespace-pre-wrap break-words"
            style={{
              maxHeight: '6rem',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0, black 4.5rem, transparent 6rem)',
              maskImage: 'linear-gradient(to bottom, black 0, black 4.5rem, transparent 6rem)',
            }}
          >
            {hasBeenVisible ? (
              // Full markdown render — only reached once the card is on-screen
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={CARD_MD_COMPONENTS}>
                {(content || '').slice(0, 500)}
              </ReactMarkdown>
            ) : (
              // Lightweight off-screen placeholder — plain text, zero parse cost
              <span>{(content || '').slice(0, PREVIEW_CHARS)}{(content || '').length > PREVIEW_CHARS ? '…' : ''}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        <div 
          className="flex items-center gap-1 flex-1 overflow-hidden"
          style={{
            WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
            maskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
          }}
        >
          {tags.map((item) => (
            <span key={item} className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-[#e3d7c9] text-gray-700 font-medium shrink-0">
              #{item}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {isTrash ? (
            <>
              <MdRestore
                className="icon-btn hover:text-green-600 no-card-click text-[#bdbdbd]"
                onClick={onRestore}
                title="Restore"
              />
              <MdDeleteForever
                className="icon-btn hover:text-red-600 no-card-click text-[#bdbdbd]"
                onClick={onDelete}
                title="Delete Forever"
              />
            </>
          ) : (
            <>
              <div
                className="icon-btn hover:text-blue-600 no-card-click text-[#bdbdbd]"
                onClick={onArchive}
                title={isArchived ? "Unarchive" : "Archive"}
              >
                {isArchived ? <MdOutlineUnarchive size={22} /> : <MdOutlineArchive size={22} />}
              </div>
              <MdDelete
                className="icon-btn hover:text-[#e85d56] no-card-click text-[#bdbdbd]"
                onClick={onDelete}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── React.memo with value-aware comparator ────────────────────────────────────
// After every getAllNotes() call, the server returns fresh JSON so tag arrays
// are new references even when values haven't changed, defeating === equality.
// JSON.stringify checks VALUE equality so unchanged tags don't trigger a re-render.
// the problem actually is that the tags are not being updated when the tags are updated
// the solution is to use JSON.stringify to compare the tags
// the efficiency is not compromised because the tags are not updated very often
export default memo(NoteCard, (prev, next) =>
  prev.id === next.id &&
  prev.title === next.title &&
  prev.content === next.content &&
  prev.isPinned === next.isPinned &&
  prev.isArchived === next.isArchived &&
  prev.isChecklist === next.isChecklist &&
  prev.checklist === next.checklist &&
  JSON.stringify(prev.tags) === JSON.stringify(next.tags) &&  // what happens here is 
  prev.isTrash === next.isTrash &&
  prev.isDragging === next.isDragging &&
  prev.isOverlay === next.isOverlay
);
