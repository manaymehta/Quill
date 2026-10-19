import { useCallback, useEffect, useRef, useState } from 'react';
import { IoAdd } from 'react-icons/io5';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LuUndo2 } from 'react-icons/lu';
import { MdMoreVert, MdOutlineEdit, MdDeleteOutline, MdClose, MdLock } from 'react-icons/md';
import { BsPinAngle, BsPinAngleFill } from 'react-icons/bs';
import { CHAT_LIMIT } from '../../store/useAgentStore';
import { useModalStore } from '../Modals/useModalStore';
import { useEdgeFade } from '../TabDock/useEdgeFade';
import { btnRoundDark, changeTitle, FADE_IN, FADE_OUT, HEIGHT_SPRING, plural, SWAP } from './agentStyles';
import { TickIcon } from './agentUi';

const CHAT_TITLE_MAX = 80;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECEIPT_TTL_DAYS = 10;
const THUMB_SPRING = { type: 'spring', visualDuration: 0.22, bounce: 0.2 };

const SIDE_TABS = [
  { id: 'chats', label: 'Chats', title: 'Your chats' },
  { id: 'activity', label: 'Activity', title: 'Activity' },
  { id: 'settings', label: 'Settings', title: 'Settings' },
];

const expiryHint = (chat) => {
  if (chat.pinned || !chat.expiresAt) return 'Pinned · kept until you delete it';
  const days = Math.max(0, Math.ceil((new Date(chat.expiresAt).getTime() - Date.now()) / DAY_MS));
  return days <= 1 ? 'Erased within a day if unused' : `Erased in ${days} days if unused`;
};

// Notes the change originally touched: undo turns 'applied' ops into 'undone' (or 'undo-skipped'
// when the user had edited them since)
const changedCount = (r) => r.counts.applied + r.counts.undone + r.counts.undoSkipped;

const Hint = ({ children, className = '' }) => <p className={`px-3 text-sm text-stone-500 ${className}`}>{children}</p>;

// A row leaving collapses in place (as in the long-press notes list)
const rowMotion = {
  initial: false,
  exit: { height: 0, opacity: 0, transition: { height: HEIGHT_SPRING, opacity: FADE_OUT } },
};

// ── The note card's shutter menu, for a chat row ──
const MENU_W = 170;
const shutter = {
  closed: { opacity: 0, scaleY: 0.82, y: -8, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
  open: { opacity: 1, scaleY: 1, y: 0, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } },
};
const shutterItem = {
  closed: { opacity: 0, y: -4, transition: { duration: 0.1, ease: [0.4, 0, 1, 1] } },
  open: { opacity: 1, y: 0, transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] } },
};

const RowMenu = ({ anchor, items, onClose }) => {
  useEffect(() => {
    if (!anchor) return undefined;
    const close = () => onClose();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // Next tick: the click that opened the menu must not close it
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('scroll', close, { passive: true, capture: true });
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
      document.removeEventListener('scroll', close, { capture: true });
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <AnimatePresence>
      {anchor && (
        <motion.div
          key="agent-row-menu"
          initial="closed"
          animate="open"
          exit="closed"
          variants={shutter}
          style={{
            position: 'fixed',
            top: anchor.bottom + 6,
            left: Math.max(8, Math.min(anchor.right - MENU_W, window.innerWidth - MENU_W - 8)),
            width: MENU_W,
            zIndex: 9999,
            transformOrigin: 'top',
          }}
          className="bg-[#2a2a2c] border border-white/10 p-1 rounded-2xl shadow-2xl flex flex-col gap-[5px] select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <motion.button
              key={item.label}
              type="button"
              variants={shutterItem}
              onClick={() => { onClose(); item.onClick(); }}
              className={`flex items-center justify-between gap-3 px-2 py-[6px] rounded-xl cursor-pointer transition-colors duration-75 text-left text-[13px] font-medium w-full ${
                item.danger ? 'text-red-400 hover:bg-red-500/20' : 'text-stone-300 hover:bg-white/[0.15] hover:text-white'
              }`}
            >
              <span>{item.label}</span>
              {item.icon}
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

// ── Chats ──
const ChatRow = ({ chat, isActive, disabled, onOpen, onRename, onTogglePin, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  const saveTitle = async () => {
    const clean = title.trim();
    if (clean && clean !== chat.title && !(await onRename(clean))) return;
    setTitle(clean || chat.title);
    setIsEditing(false);
  };

  const confirmDelete = () => useModalStore.getState().openConfirmModal({
    title: 'Delete this chat?',
    message: 'Changes already applied stay in Activity, with their Undo.',
    confirmLabel: 'Delete',
    variant: 'danger',
    onConfirm: onDelete,
  });

  const menuItems = [
    { label: 'Rename', icon: <MdOutlineEdit size={14} />, onClick: () => { setTitle(chat.title); setIsEditing(true); } },
    { label: chat.pinned ? 'Unpin' : 'Pin', icon: chat.pinned ? <BsPinAngleFill size={13} /> : <BsPinAngle size={13} />, onClick: onTogglePin },
    ...(disabled && isActive ? [] : [{ label: 'Delete', icon: <MdDeleteOutline size={14} />, onClick: confirmDelete, danger: true }]),
  ];

  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); setMenuAnchor(e.currentTarget.getBoundingClientRect()); }}
      // The open chat: one quiet signal in the panel's own terms — a lighter row and a cream title (it
      // was a dark red fill, a coral title, a coral dot and "Open now" all at once)
      className={`group relative flex items-center gap-1 rounded-xl pr-1 transition-colors duration-200 ${isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
    >
      {isEditing ? (
        <div className="flex-1 min-w-0 px-3 py-2.5">
          <input
            autoFocus
            value={title}
            maxLength={CHAT_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') { setTitle(chat.title); setIsEditing(false); }
            }}
            className="w-full bg-[#282a2d] rounded-lg px-2 py-1 text-sm font-medium text-white outline-none ring-1 ring-[#e85d56]/50"
          />
        </div>
      ) : (
        <button
          onClick={onOpen}
          disabled={disabled}
          title={disabled ? 'Wait for the answer (or press Stop) first' : 'Open this chat'}
          className="flex-1 min-w-0 text-left px-3 py-2.5 cursor-pointer disabled:cursor-not-allowed"
        >
          <span className={`flex items-center gap-1.5 text-sm font-medium truncate ${isActive ? 'text-[#f4eadc]' : 'text-stone-300'}`}>
            {chat.pinned && <BsPinAngleFill className="shrink-0 text-xs text-[#e85d56]" />}
            <span className="truncate">{chat.title}</span>
          </span>
          <span className="block text-xs text-stone-500 mt-0.5 truncate">{expiryHint(chat)}</span>
        </button>
      )}
      {!isEditing && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuAnchor(menuAnchor ? null : e.currentTarget.getBoundingClientRect()); }}
          title="Chat options"
          className="shrink-0 p-1.5 rounded-full text-stone-500 hover:text-stone-200 hover:bg-white/10 transition-all cursor-pointer opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MdMoreVert size={18} />
        </button>
      )}
      <RowMenu anchor={menuAnchor} items={menuItems} onClose={closeMenu} />
    </div>
  );
};

// A new chat, at the end of the list (the header's + as well): centred, the header's round button
const NewChatButton = ({ isBusy, isFull, onNew }) => (
  <div className="flex justify-center pt-3 pb-1">
    <button
      type="button"
      onClick={onNew}
      disabled={isBusy || isFull}
      title={isBusy ? 'Wait for the answer (or press Stop) first' : isFull ? `${CHAT_LIMIT} chats is the limit — delete one to start a new chat` : 'New chat'}
      aria-label="New chat"
      className={btnRoundDark}
    >
      <IoAdd className="text-xl" />
    </button>
  </div>
);

const ChatList = ({ chats, error, activeChatId, isBusy, onOpen, onRename, onTogglePin, onDelete, onNew }) => {
  if (error) return <Hint className="text-red-400">{error}</Hint>;
  if (!chats) return <Hint>Loading chats…</Hint>;
  if (chats.length === 0) {
    return (
      <div className="flex flex-col">
        <Hint>No saved chats yet. A chat is saved when you send its first message.</Hint>
        <NewChatButton isBusy={isBusy} isFull={false} onNew={onNew} />
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <p className="px-3 pb-2 text-[11px] md:text-xs font-medium tracking-[0.15em] uppercase text-stone-500">{chats.length} of {CHAT_LIMIT} chats</p>
      <AnimatePresence initial={false}>
        {chats.map((chat) => (
          <motion.div key={chat.chatId} {...rowMotion} className="overflow-hidden">
            <div className="pb-0.5">
              <ChatRow
                chat={chat}
                isActive={chat.chatId === activeChatId}
                disabled={isBusy}
                onOpen={() => onOpen(chat.chatId)}
                onRename={(title) => onRename(chat.chatId, title)}
                onTogglePin={() => onTogglePin(chat.chatId)}
                onDelete={() => onDelete(chat.chatId)}
              />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <NewChatButton isBusy={isBusy} isFull={chats.length >= CHAT_LIMIT} onNew={onNew} />
    </div>
  );
};

// ── Activity (past bulk changes, backed by receipts) ──
// What happened, in words: "Renamed 8 tags", "Moved 3 notes to Books" — every entry used to read
// "Changed N notes", so none could be told apart.
const activityHeadline = (r) => {
  const changes = r.changes?.length ? r.changes : [{ action: r.action, params: r.params || {} }];
  const notes = plural(changedCount(r), 'note');
  const actions = new Set(changes.map((c) => c.action));
  if (actions.size === 1) {
    const action = [...actions][0];
    if (action === 'tag') {
      const isRename = (c) => (c.params?.add || []).length === 1 && (c.params?.remove || []).length === 1;
      return changes.every(isRename) ? `Renamed ${plural(changes.length, 'tag')} · ${notes}` : `Changed tags on ${notes}`;
    }
    if (action === 'move') {
      const p = changes.length === 1 ? changes[0].params || {} : {};
      const folder = p.newFolderName || p.targetFolderName;
      if (changes.length > 1) return `Moved ${notes}`;
      return folder ? `Moved ${notes} to ${folder}` : `Moved ${notes} out of folders`;
    }
    if (action === 'archive') return changes[0].params?.archived === false ? `Unarchived ${notes}` : `Archived ${notes}`;
    if (action === 'trash') return `Sent ${notes} to trash`;
  }
  return `${changes.length} changes · ${notes}`;
};

// "Today, 1:01 PM", "Yesterday, 9:12 AM", "16 Oct, 11:45 AM" (with the year only when it isn't this one)
const shortWhen = (date) => {
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - new Date(date).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days <= 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`;
};

const ActivityLog = ({ activity, error, onUndo }) => {
  if (error) return <Hint className="text-red-400">{error}</Hint>;
  if (!activity) return <Hint>Loading activity…</Hint>;
  if (activity.length === 0) return <Hint>No bulk changes yet. They'll be listed here, with Undo, for {RECEIPT_TTL_DAYS} days.</Hint>;
  return (
    <div className="flex flex-col gap-0.5">
      {activity.map((r) => {
        const created = new Date(r.createdAt);
        const until = new Date(created.getTime() + RECEIPT_TTL_DAYS * DAY_MS);
        const isApplied = r.status === 'applied';
        // The changes themselves, on one line (`instruction` holds the list's filter text, e.g.
        // "tagged #containers", so it's only the fallback for receipts without changes)
        const detail = r.changes?.length ? r.changes.map(changeTitle).join(', ') : r.instruction || null;
        const meta = [
          shortWhen(created),
          isApplied && `undo until ${until.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
          !isApplied && r.counts.undoSkipped > 0 && `${plural(r.counts.undoSkipped, 'note')} kept your newer edits`,
        ].filter(Boolean).join(' · ');
        return (
          <div key={r.receiptId} className="flex items-start gap-2 rounded-xl px-3 py-2.5">
            <div className={`flex-1 min-w-0 ${isApplied ? '' : 'opacity-55'}`}>
              <p className="text-sm font-medium text-stone-200 truncate">{activityHeadline(r)}</p>
              {detail && <p title={detail} className="text-xs text-stone-400 mt-0.5 truncate">{detail}</p>}
              <p className="text-xs text-stone-500 mt-0.5">{meta}</p>
              {r.counts.skippedChanged > 0 && (
                <p className="text-xs text-amber-400/80 mt-0.5">{plural(r.counts.skippedChanged, 'note')} skipped (had changed before Apply)</p>
              )}
            </div>
            {isApplied ? (
              <button
                onClick={() => onUndo(r.receiptId)}
                // A real button, not text: the safety net for a bulk change should be easy to find. The
                // toast's see-through Undo, as a pill — visible without competing with Apply's coral.
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.08] border border-white/15 text-xs font-medium text-stone-100 hover:bg-white/[0.16] hover:border-white/25 active:scale-95 transition-all cursor-pointer"
              >
                <LuUndo2 className="text-sm" /> Undo
              </button>
            ) : (
              <span className="shrink-0 mt-0.5 rounded-full bg-white/5 px-2 py-0.5 text-xs text-stone-400">
                {r.status === 'partially-undone' ? 'Partly undone' : 'Undone'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Settings (what the agent may do) ──
const ScopeRow = ({ label, hint, checked, locked, disabled, onToggle }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    disabled={locked || disabled}
    onClick={onToggle}
    className={`w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${locked || disabled ? 'cursor-default' : 'hover:bg-white/[0.06] cursor-pointer'} ${disabled ? 'opacity-50' : ''}`}
  >
    {locked ? <MdLock className="shrink-0 text-lg text-stone-500" /> : <TickIcon checked={checked} tone="cream" />}
    <span className="min-w-0">
      <span className="block text-sm font-medium text-stone-200">{label}</span>
      <span className="block text-xs text-stone-500 mt-0.5 leading-snug">{hint}</span>
    </span>
  </button>
);

const AgentSettings = ({ scopes, onChange }) => {
  if (!scopes) return <Hint>Loading settings…</Hint>;
  return (
    <div className="flex flex-col gap-0.5">
      <Hint className="pb-2 text-xs">What the agent may do. Anything turned off is simply not offered to it.</Hint>
      {/* The lock already says it's always on */}
      <ScopeRow label="Read & search" hint="Search, read and summarise your notes." checked locked />
      <ScopeRow label="Compose" hint="Draft new notes and propose edits. Nothing is saved until you save it."
        checked={scopes.compose} onToggle={() => onChange('compose', !scopes.compose)} />
      <ScopeRow label="Organise" hint="Prepare bulk moves, tags and archiving as a review list you approve."
        checked={scopes.organize} onToggle={() => onChange('organize', !scopes.organize)} />
      <ScopeRow label="Send to trash" hint="Let bulk changes move notes to the trash — always recoverable, never deleted for good."
        checked={scopes.organize && scopes.destructive} disabled={!scopes.organize}
        onToggle={() => onChange('destructive', !scopes.destructive)} />
    </div>
  );
};

// ── The panel's contents: a title, a segmented switch, the chosen list ──
const SegmentedTabs = ({ tab, onChange }) => (
  <div className="flex p-1 rounded-full bg-white/5 border border-white/5">
    {SIDE_TABS.map((t) => (
      <button
        key={t.id}
        type="button"
        onClick={() => onChange(t.id)}
        className={`relative flex-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${tab === t.id ? 'text-[#333]' : 'text-stone-400 hover:text-stone-200'}`}
      >
        {tab === t.id && (
          <motion.span layoutId="agent-side-thumb" transition={THUMB_SPRING} className="absolute inset-0 rounded-full bg-[#f4eadc] shadow-sm" />
        )}
        <span className="relative">{t.label}</span>
      </button>
    ))}
  </div>
);

const AgentSidePanel = ({ tab, onTabChange, onClose, chats, chatsError, activeChatId, isBusy, onOpenChat, onNewChat, onRename, onTogglePin, onDelete, activity, activityError, onUndo, scopes, onScopeChange }) => {
  const title = SIDE_TABS.find((t) => t.id === tab)?.title;
  const listRef = useRef(null);
  const updateListFade = useEdgeFade(listRef, 'y', 24, `${tab}:${chats?.length}:${activity?.length}`);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3 shrink-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.h3 key={title} {...SWAP} className="text-2xl font-medium text-[#f4eadc] truncate" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            {title}
          </motion.h3>
        </AnimatePresence>
        <button onClick={onClose} title="Close" className={btnRoundDark}><MdClose className="text-lg" /></button>
      </div>
      <div className="px-5 pb-3 shrink-0">
        <SegmentedTabs tab={tab} onChange={onTabChange} />
      </div>
      <div ref={listRef} onScroll={updateListFade} className="flex-1 min-h-0 overflow-y-auto agent-scrollbar px-2 pb-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { y: HEIGHT_SPRING, opacity: FADE_IN } }}
            exit={{ opacity: 0, transition: FADE_OUT }}
          >
            {tab === 'chats' && (
              <ChatList chats={chats} error={chatsError} activeChatId={activeChatId} isBusy={isBusy}
                onOpen={onOpenChat} onRename={onRename} onTogglePin={onTogglePin} onDelete={onDelete} onNew={onNewChat} />
            )}
            {tab === 'activity' && <ActivityLog activity={activity} error={activityError} onUndo={onUndo} />}
            {tab === 'settings' && <AgentSettings scopes={scopes} onChange={onScopeChange} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default AgentSidePanel;
