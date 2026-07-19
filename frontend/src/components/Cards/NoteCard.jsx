import { memo, useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MdDelete, MdCheckBoxOutlineBlank, MdCheckBox, MdRestore, MdDeleteForever, MdOutlineArchive, MdOutlineUnarchive, MdOutlineFolder, MdArrowOutward } from "react-icons/md";
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFoldersStore } from '../../store/useFoldersStore';

// ── Markdown component overrides for the compact card preview ────────────────
const CARD_MD_COMPONENTS = {
  h1: ({ children }) => <span className="font-bold text-[#333] block">{children}</span>,
  h2: ({ children }) => <span className="font-bold text-[#444] block">{children}</span>,
  h3: ({ children }) => <span className="font-semibold text-[#444] block">{children}</span>,
  h4: ({ children }) => <span className="font-semibold block">{children}</span>,
  h5: ({ children }) => <span className="font-medium block">{children}</span>,
  h6: ({ children }) => <span className="font-medium block">{children}</span>,
  p: ({ children }) => <span className="block">{children}</span>,
  strong: ({ children }) => <span className="font-bold">{children}</span>,
  em: ({ children }) => <span className="italic">{children}</span>,
  del: ({ children }) => <span className="line-through text-stone-400">{children}</span>,
  code: ({ children }) => (
    <code className="font-mono text-xs bg-black/5 px-1 rounded">{children}</code>
  ),
  pre: ({ children }) => <span className="block font-mono text-xs bg-black/5 px-2 py-1 rounded my-0.5">{children}</span>,
  ul: ({ children }) => <ul className="list-disc pl-4 marker:text-[#9c9892]">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 marker:text-[#9c9892]">{children}</ol>,
  li: ({ children, className }) => {
    const isTask = className && className.includes('task-list-item');
    if (isTask) {
      return <li className="list-none -ml-4 pl-0">{children}</li>;
    }
    return <li className="pl-1">{children}</li>;
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
  table: () => <span className="text-xs text-stone-400 italic">[table]</span>,
};

const PREVIEW_CHARS = 150;

// ── Inner static rendering component ─────────────────────────────────────────
// This component renders the actual UI. It is heavily memoized and will skip
// rendering, markdown parsing, and diffing completely unless value props change,
// preventing massive drag-and-drop lags in large lists.
const InnerNoteCard = memo(({
  title, content, tags, folder, isChecklist, checklist,
  isTrash, isArchived, isDragging, isOverlay, hideFolderBadge,
  linkPreviews, onDelete, onArchive, onChecklistToggle, onRestore,
  index
}) => {
  const [shouldAnimate, setShouldAnimate] = useState(true);
  const [hasBeenVisible, setHasBeenVisible] = useState(isOverlay || index < 8);
  const observerTargetRef = useRef(null);

  useEffect(() => {
    const el = observerTargetRef.current;
    if (!el || hasBeenVisible || isOverlay) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasBeenVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '150px 0px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasBeenVisible, isOverlay]);

  return (
    <div
      ref={observerTargetRef}
      onAnimationEnd={() => setShouldAnimate(false)}
      className={`group border w-full border-gray-700 rounded-[20px] md:rounded-3xl p-3 md:p-4 bg-[#f8ecdc] note-card
        ${shouldAnimate && !isOverlay ? 'animate-card-fade-in' : ''}
        ${isDragging ? 'opacity-30' : 'opacity-100'}
        ${isOverlay ? 'shadow-2xl scale-105 opacity-95' : (isDragging ? '' : 'shadow-xs')}`}
    >
      <div className="flex flex-col">
        <div className="flex justify-between items-start gap-1">
          <h4 className="text-lg md:text-2xl font-semibold tracking-tight text-[#e85d56] leading-tight">{title}</h4>
        </div>
      </div>

      <div className="mt-1">
        {isChecklist ? (
          <div className="flex flex-col gap-2 mt-1">
            {checklist.slice(0, 5).map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="no-card-click" onClick={(e) => { e.stopPropagation(); onChecklistToggle(index); }}>
                  {item.completed ? <MdCheckBox /> : <MdCheckBoxOutlineBlank />}
                </div>
                <span className={item.completed ? 'line-through text-slate-500' : ''}>{item.text}</span>
              </div>
            ))}
            {checklist.length > 5 && (
              <span className="text-xs text-slate-500">...and {checklist.length - 5} more items.</span>
            )}
          </div>
        ) : (
          <div
            className="font-medium mt-1 md:mt-2 text-[#494949] text-[13px] md:text-sm overflow-hidden break-words"
            style={{
              maxHeight: '9rem',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0, black 8rem, transparent 9rem)',
              maskImage: 'linear-gradient(to bottom, black 0, black 8rem, transparent 9rem)',
            }}
          >
            {hasBeenVisible ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={CARD_MD_COMPONENTS}>
                {(content || '').slice(0, 500)}
              </ReactMarkdown>
            ) : (
              <span className="whitespace-pre-wrap">{(content || '').slice(0, PREVIEW_CHARS)}{(content || '').length > PREVIEW_CHARS ? '…' : ''}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-1">
        <div 
          className="flex items-center gap-2 flex-grow overflow-hidden"
          style={{
            WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
            maskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
          }}
        >
          {folder && !hideFolderBadge && (
            <div 
              style={{ color: folder.color, backgroundColor: `${folder.color}15` }}
              className="flex items-center text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full select-none no-card-click truncate max-w-[120px] shrink-0"
              title={`In folder: ${folder.name}`}
            >
              <MdOutlineFolder size={13} className="mr-1 flex-shrink-0" />
              <span className="truncate">{folder.name}</span>
            </div>
          )}

          {tags.map((item) => (
            <span key={item} className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-black/5 text-stone-600 font-semibold shrink-0 select-none no-card-click">
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

      {linkPreviews && linkPreviews.length > 0 && (
        <div className="mt-4 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 flex flex-col no-card-click border-t border-stone-200/80 rounded-b-[23px] overflow-hidden" style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}>
          {linkPreviews.slice(0, 3).map((preview, idx) => (
            <a 
              key={idx}
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-3.5 bg-black/[0.06] hover:bg-black/[0.12] transition-all duration-200 ${idx !== 0 ? 'border-t border-stone-200/80' : ''}`}
            >
              <MdArrowOutward size={18} className="text-black/30 flex-shrink-0 group-hover:text-black/50 transition-colors" />
              {preview.image && (
                <img 
                  src={preview.image} 
                  alt={preview.title}
                  className="w-10 h-10 object-cover rounded-md flex-shrink-0 border border-black/5 shadow-sm"
                />
              )}
              <div className="flex-grow min-w-0 pr-1">
                <div className="text-xs font-bold text-black/70 truncate leading-snug">{preview.title || preview.url}</div>
                <div className="text-[10px] text-black/50 font-bold truncate mt-0.5 uppercase tracking-wider">{preview.siteName}</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}, (prev, next) =>
  prev.title === next.title &&
  prev.content === next.content &&
  prev.folder?._id === next.folder?._id &&
  prev.folder?.color === next.folder?.color &&
  prev.folder?.name === next.folder?.name &&
  prev.isArchived === next.isArchived &&
  prev.isChecklist === next.isChecklist &&
  JSON.stringify(prev.checklist) === JSON.stringify(next.checklist) &&
  JSON.stringify(prev.tags) === JSON.stringify(next.tags) &&
  prev.isTrash === next.isTrash &&
  prev.isDragging === next.isDragging &&
  prev.isOverlay === next.isOverlay &&
  prev.hideFolderBadge === next.hideFolderBadge &&
  JSON.stringify(prev.linkPreviews) === JSON.stringify(next.linkPreviews)
);

// ── Outer dynamic draggable wrapper component ───────────────────────────────
const NoteCard = ({
  id, title, content, tags,
  onEdit, onDelete,
  isChecklist, checklist, onChecklistToggle,
  isTrash, onRestore, isArchived, onArchive,
  isOverlay, index = 0,
  folderId,
  hideFolderBadge = false,
  linkPreviews = [],
}) => {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isOverlay ? 100 : (isDragging ? 0 : 'auto'),
    opacity: 1,
  };

  const { folders } = useFoldersStore();
  const folder = folderId ? folders.find(f => f._id === folderId) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (e.target.closest('.no-card-click') || isDragging || isOverlay) return;
        onEdit();
      }}
      className={`w-full note-card-wrapper cursor-grab active:cursor-grabbing ${isDragging ? 'is-dragging-active' : ''}`}
    >
      <InnerNoteCard
        title={title}
        content={content}
        tags={tags}
        folder={folder}
        isChecklist={isChecklist}
        checklist={checklist}
        isTrash={isTrash}
        isArchived={isArchived}
        isDragging={isDragging}
        isOverlay={isOverlay}
        hideFolderBadge={hideFolderBadge}
        linkPreviews={linkPreviews}
        onDelete={onDelete}
        onArchive={onArchive}
        onChecklistToggle={onChecklistToggle}
        onRestore={onRestore}
        index={index}
      />
    </div>
  );
};

export default NoteCard;
