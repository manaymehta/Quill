import React, { memo, useState, useEffect, useRef, cloneElement } from 'react';
import { createPortal, flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  MdDelete, MdCheckBoxOutlineBlank, MdCheckBox, MdRestore, 
  MdDeleteForever, MdOutlineArchive, MdOutlineUnarchive, 
  MdOutlineFolder, MdArrowOutward, MdMoreVert, 
  MdOutlineHome, MdHome 
} from "react-icons/md";
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFoldersQuery } from '../../hooks/useNotesQuery';
import { useFoldersStore } from '../../store/useFoldersStore';
import MoveToPicker from './MoveToPicker';

const animateLayoutChanges = (args) => {
  if (args.wasDragging) return false;
  return defaultAnimateLayoutChanges(args);
};

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
const InnerNoteCard = memo(({
  noteId, title, content, tags, folder, folderId, isChecklist, checklist,
  isTrash, isArchived, showInHome, isDragging, isOverlay, hideFolderBadge,
  linkPreviews, onDelete, onArchive, onToggleHome, onMove, onChecklistToggle, onRestore,
  isMenuOpen, toggleMenu, index, coords, setCoords
}) => {
  const [shouldAnimate, setShouldAnimate] = useState(true);
  const [hasBeenVisible, setHasBeenVisible] = useState(isOverlay || index < 8);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const observerTargetRef = useRef(null);

  const { setActiveDropdownNoteId } = useFoldersStore();

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

  // Unified menu item configuration matching FolderCard context menu
  const menuItems = isTrash ? [
    {
      label: "Restore Note",
      icon: <MdRestore size={14} />,
      onClick: () => onRestore && onRestore(),
      variant: "success",
      dividerBefore: false
    },
    {
      label: "Delete Forever",
      icon: <MdDeleteForever size={14} />,
      onClick: () => onDelete && onDelete(),
      variant: "danger",
      dividerBefore: true
    }
  ] : [
    ...(folderId && folder && onToggleHome ? [{
      label: showInHome ? "Remove from Home" : "Show in Home",
      icon: showInHome ? <MdHome size={14} className="text-[#e85d56]" /> : <MdOutlineHome size={14} />,
      onClick: () => onToggleHome && onToggleHome(),
      dividerBefore: false
    }] : []),
    ...(onMove ? [{
      label: "Move to Folder...",
      icon: <MdOutlineFolder size={14} />,
      onClick: () => setShowMovePicker(true),
      dividerBefore: false
    }] : []),
    ...(onArchive ? [{
      label: isArchived ? "Unarchive Note" : "Archive Note",
      icon: isArchived ? <MdOutlineUnarchive size={14} /> : <MdOutlineArchive size={14} />,
      onClick: () => onArchive && onArchive(),
      dividerBefore: false
    }] : []),
    ...(onDelete ? [{
      label: "Move to Trash",
      icon: <MdDelete size={14} />,
      onClick: () => onDelete && onDelete(),
      variant: "danger",
      dividerBefore: true
    }] : [])
  ];

  return (
    <div
      ref={observerTargetRef}
      onAnimationEnd={() => setShouldAnimate(false)}
      className={`group border w-full border-gray-700 rounded-[20px] md:rounded-3xl p-3 md:p-4 bg-[#f8ecdc] note-card relative select-none overflow-hidden transition-transform duration-200 ease-out [-webkit-touch-callout:none]
        ${shouldAnimate && !isOverlay ? 'animate-card-fade-in' : ''}
        ${isDragging ? 'opacity-30' : 'opacity-100'}
        ${isMenuOpen ? 'ring-1 ring-white/10' : ''}
        ${isOverlay ? 'shadow-2xl scale-105 opacity-95' : (isDragging ? '' : 'shadow-xs')}`}
    >
      <div className="flex flex-col">
        <div className="flex justify-between items-start gap-1">
          <h4 className="text-lg md:text-2xl font-semibold tracking-tight text-[#e85d56] leading-tight flex-1 min-w-0 pr-1">{title}</h4>
          
          {!isOverlay && (
            <div className="relative shrink-0 no-card-click">
              <button
                type="button"
                onClick={toggleMenu}
                className="p-1 -mr-1 -mt-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-black/5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all cursor-pointer flex items-center justify-center"
                title="Note options"
              >
                <MdMoreVert size={20} />
              </button>
            </div>
          )}
        </div>

        {isMenuOpen && coords && createPortal(
          <div
            style={(() => {
              const menuWidth = 175;
              const menuHeight = isTrash ? 85 : 210;
              let finalX = coords.x;
              if (finalX + menuWidth > window.innerWidth - 8) {
                finalX = Math.max(8, window.innerWidth - menuWidth - 8);
              }
              finalX = Math.max(8, finalX);
              let finalY = coords.y;
              if (finalY + menuHeight > window.innerHeight - 8) {
                finalY = Math.max(8, coords.y - menuHeight - 12);
              }
              return { position: 'fixed', left: `${finalX}px`, top: `${finalY}px`, zIndex: 9999 };
            })()}
            className="bg-[#1e1e20]/96 backdrop-blur-xl border border-white/[0.08] py-1.5 rounded-xl shadow-2xl flex flex-col min-w-[165px] context-menu-pop no-card-click select-none"
            onClick={(e) => e.stopPropagation()}
          >
            {menuItems.map((item, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && (
                  <div className="h-[1px] bg-white/[0.05] my-1 mx-2" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveDropdownNoteId(null);
                    setCoords(null);
                    item.onClick();
                  }}
                  className={`flex items-center gap-2 mx-1 px-2 py-[6px] rounded-md cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-[calc(100%-8px)] ${
                    item.variant === 'danger'
                      ? 'hover:bg-red-500/20 hover:text-red-400 text-red-400'
                      : item.variant === 'success'
                      ? 'hover:bg-emerald-500/20 hover:text-emerald-400 text-emerald-400'
                      : 'hover:bg-white/[0.15] hover:text-white text-stone-300'
                  }`}
                >
                  {cloneElement(item.icon, { className: "shrink-0" })}
                  <span>{item.label}</span>
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body
        )}

        {isChecklist ? (
          <div
            className="flex flex-col gap-1.5 mt-1.5 md:mt-2 overflow-hidden"
            style={{
              maxHeight: '9rem',
              WebkitMaskImage: checklist.length > 4 ? 'linear-gradient(to bottom, black 0, black 7.5rem, transparent 9rem)' : 'none',
              maskImage: checklist.length > 4 ? 'linear-gradient(to bottom, black 0, black 7.5rem, transparent 9rem)' : 'none',
            }}
          >
            {checklist.slice(0, 5).map((item, index) => (
              <div key={index} className="flex items-start gap-2 min-w-0">
                <div className="no-card-click mt-0.5 flex-shrink-0 cursor-pointer text-base" onClick={(e) => { e.stopPropagation(); onChecklistToggle?.(index); }}>
                  {item.completed ? <MdCheckBox className="text-[#e85d56]" /> : <MdCheckBoxOutlineBlank className="text-stone-400" />}
                </div>
                <span className={`font-medium text-[13px] md:text-sm break-words overflow-wrap-anywhere min-w-0 line-clamp-2 leading-snug ${item.completed ? 'line-through text-slate-500' : 'text-[#494949]'}`}>
                  {item.text}
                </span>
              </div>
            ))}
            {checklist.length > 5 && (
              <span className="text-xs text-slate-500 font-medium pt-0.5">...and {checklist.length - 5} more items.</span>
            )}
          </div>
        ) : (
          <div
            className="font-medium mt-1.5 md:mt-2 text-[#494949] text-[13px] md:text-sm overflow-hidden break-words"
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

        {/* Tags & Folder Row */}
        <div className="flex items-center justify-between gap-2 mt-1">
          <div 
            className="flex items-center gap-2 flex-grow overflow-hidden"
            style={{
              WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
              maskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
            }}
          >
            {!hideFolderBadge && folder && (
              <div 
                style={{ color: folder.color, backgroundColor: `${folder.color}15` }}
                className="flex items-center text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full select-none no-card-click truncate max-w-[120px] shrink-0"
                title={`In folder: ${folder.name}`}
              >
                <MdOutlineFolder size={13} className="mr-1 flex-shrink-0" />
                <span className="truncate">{folder.name}</span>
              </div>
            )}
            {tags && tags.map((t, idx) => (
              <span key={idx} className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-black/5 text-stone-600 font-semibold shrink-0 select-none no-card-click">
                #{t}
              </span>
            ))}
          </div>
        </div>

        {linkPreviews && linkPreviews.length > 0 && (
          <div className="mt-3 -mx-3 md:-mx-4 -mb-3 md:-mb-4 flex flex-col no-card-click border-t border-stone-200/80 rounded-b-[20px] md:rounded-b-3xl overflow-hidden" style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}>
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
                    alt={preview.title || ''}
                    className="w-10 h-10 object-cover rounded-md flex-shrink-0 border border-black/5 shadow-sm"
                  />
                )}
                <div className="flex-grow min-w-0 pr-1">
                  <div className="text-xs font-bold text-black/70 truncate leading-snug">{preview.title || preview.url}</div>
                  {preview.siteName && (
                    <div className="text-[10px] text-black/50 font-bold truncate mt-0.5 uppercase tracking-wider">{preview.siteName}</div>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Move to Folder Picker Modal */}
      {showMovePicker && createPortal(
        <MoveToPicker
          isOpen={showMovePicker}
          noteId={noteId}
          currentFolderId={folderId}
          onClose={() => setShowMovePicker(false)}
          onMove={onMove}
        />,
        document.body
      )}
    </div>
  );
});

InnerNoteCard.displayName = 'InnerNoteCard';

const NoteCard = ({
  id, title, content, tags,
  onEdit, onDelete,
  isChecklist, checklist, onChecklistToggle,
  isTrash, onRestore, isArchived, onArchive,
  showInHome, onToggleHome, onMove,
  isOverlay, index = 0,
  folderId,
  hideFolderBadge = false,
  linkPreviews = [],
}) => {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({
    id,
    animateLayoutChanges,
  });

  const { activeDropdownNoteId, setActiveDropdownNoteId } = useFoldersStore();
  const isMenuOpen = activeDropdownNoteId === id;
  const [coords, setCoords] = useState(null);

  const longPressTimerRef = useRef(null);
  const touchStartPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (activeDropdownNoteId !== id) return;

    const handleOutsideClick = (e) => {
      if (e.target.closest?.('.context-menu-pop')) return;
      setActiveDropdownNoteId(null);
      setCoords(null);
    };
    const handleScroll = () => {
      setActiveDropdownNoteId(null);
      setCoords(null);
    };

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('contextmenu', handleOutsideClick);
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('contextmenu', handleOutsideClick);
      document.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [activeDropdownNoteId, id, setActiveDropdownNoteId]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, [isDragging]);

  const toggleMenu = (e) => {
    e?.stopPropagation?.();
    if (isMenuOpen) {
      setActiveDropdownNoteId(null);
      setCoords(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setCoords({ x: rect.left, y: rect.bottom + 8 });
      setActiveDropdownNoteId(id);
    }
  };

  const handleTouchStart = (e) => {
    if (isDragging || isOverlay || isTrash) return;
    const { activeDropdownNoteId, activeDropdownFolderId } = useFoldersStore.getState();
    if (activeDropdownNoteId !== null || activeDropdownFolderId !== null) return;

    const touch = e.touches[0];
    if (!touch) return;
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    longPressTimerRef.current = setTimeout(() => {
      flushSync(() => {
        setCoords({ x: touchStartPosRef.current.x, y: touchStartPosRef.current.y });
        setActiveDropdownNoteId(id);
      });
    }, 500);
  };

  const handleTouchMove = (e) => {
    if (isOverlay) return;
    if (isDragging) {
      // Card is being dragged — close dropdown if open
      if (isMenuOpen) {
        setActiveDropdownNoteId(null);
        setCoords(null);
      }
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (dx > 20 || dy > 20) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (isMenuOpen) {
        setActiveDropdownNoteId(null);
        setCoords(null);
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
    zIndex: isOverlay ? 100 : (isDragging ? 0 : (isMenuOpen ? 40 : 'auto')),
    opacity: 1,
    touchAction: isDragging ? 'none' : 'pan-y',
  };

  const { data: folders = [] } = useFoldersQuery();
  const folder = folderId ? folders.find(f => f._id === folderId) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onTouchStart={(e) => {
        listeners?.onTouchStart?.(e);
        handleTouchStart(e);
      }}
      onTouchMove={(e) => {
        listeners?.onTouchMove?.(e);
        handleTouchMove(e);
      }}
      onTouchEnd={(e) => {
        listeners?.onTouchEnd?.(e);
        handleTouchEnd(e);
      }}
      onTouchCancel={(e) => {
        listeners?.onTouchCancel?.(e);
        handleTouchEnd(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isOverlay || isDragging || isMenuOpen) return;
        setCoords({ x: e.clientX, y: e.clientY });
        setActiveDropdownNoteId(id);
      }}
      onClick={(e) => {
        if (e.target.closest('.no-card-click') || isDragging || isOverlay) return;
        const { activeDropdownNoteId, activeDropdownFolderId, setActiveDropdownNoteId, setActiveDropdownFolderId } = useFoldersStore.getState();
        if (activeDropdownNoteId !== null || activeDropdownFolderId !== null) {
          e.stopPropagation();
          e.preventDefault();
          if (activeDropdownNoteId !== id) {
            setActiveDropdownNoteId(null);
            setActiveDropdownFolderId(null);
          }
          return;
        }
        onEdit?.();
      }}
      className={`w-full note-card-wrapper cursor-grab active:cursor-grabbing select-none [touch-action:manipulation] [-webkit-touch-callout:none] ${isDragging ? 'is-dragging-active touch-none' : ''}`}
    >
      <InnerNoteCard
        noteId={id}
        title={title}
        content={content}
        tags={tags}
        folder={folder}
        folderId={folderId}
        isChecklist={isChecklist}
        checklist={checklist}
        isTrash={isTrash}
        isArchived={isArchived}
        showInHome={showInHome}
        isDragging={isDragging}
        isOverlay={isOverlay}
        hideFolderBadge={hideFolderBadge}
        linkPreviews={linkPreviews}
        onEdit={onEdit}
        onDelete={onDelete}
        onArchive={onArchive}
        onToggleHome={onToggleHome}
        onMove={onMove}
        onChecklistToggle={onChecklistToggle}
        onRestore={onRestore}
        isMenuOpen={isMenuOpen}
        toggleMenu={toggleMenu}
        index={index}
        coords={coords}
        setCoords={setCoords}
      />
    </div>
  );
};

export default memo(NoteCard, (prev, next) => (
  prev.id === next.id &&
  prev.title === next.title &&
  prev.content === next.content &&
  prev.isTrash === next.isTrash &&
  prev.isArchived === next.isArchived &&
  prev.showInHome === next.showInHome &&
  prev.folderId === next.folderId &&
  prev.isOverlay === next.isOverlay &&
  prev.hideFolderBadge === next.hideFolderBadge &&
  prev.isChecklist === next.isChecklist &&
  JSON.stringify(prev.tags) === JSON.stringify(next.tags) &&
  JSON.stringify(prev.checklist) === JSON.stringify(next.checklist) &&
  JSON.stringify(prev.linkPreviews) === JSON.stringify(next.linkPreviews)
));
