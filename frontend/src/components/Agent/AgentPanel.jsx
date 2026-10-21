import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IoAdd, IoSettingsOutline, IoStop } from 'react-icons/io5';
import { LuArrowUp } from 'react-icons/lu';
import { MdHistory, MdKeyboardArrowDown } from 'react-icons/md';
import axiosInstance from '../../utils/axiosInstance';
import { useAgentStore } from '../../store/useAgentStore';
import { useTabsStore } from '../../store/useTabsStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { BELOW_TABLET_QUERY } from '../../constants/breakpoints';
import { DOCK_METRICS, DOCK_MOBILE_QUERY } from '../TabDock/dockMetrics';
import AgentMessage from './AgentMessage';
import AgentSidePanel from './AgentSidePanel';
import BottomSheet from '../Modals/BottomSheet';
import { useScrollEdges } from './useScrollEdges';
import { btnRoundDark, btnRoundDarkOn, FADE_IN, FADE_OUT, HEIGHT_SPRING, OpeningNoteContext, SWAP } from './agentStyles';
import { Collapse, RenderGuard } from './agentUi';

// The agent opens like the note editor — a centred card of the editor's width — but in the dock's
// dark material: the agent's answers come back as cream cards, your messages are quiet dark bubbles.
// History and Settings open beside it like the editor's Summary panel (a bottom sheet on phones).

const CARD_MAX_W = 790;         // the editor card's width
const SIDE_W = 340;
const ROW_GAP = 16;
const NAVBAR_H = { phone: 60, desktop: 72 }; // MainLayout's top padding (pt-[60px] md:pt-[72px])
// One gap above the card (to the navbar's search row) and below it (to the compact dock), so it
// sits evenly between them. 8px on phones, the same as its side margins there.
const PANEL_GAP = { phone: 8, desktop: 12 };
const SIDE_SPRING = { type: 'spring', visualDuration: 0.28, bounce: 0.15 };
const CHAT_TITLE_MAX = 80;
const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE_FONT = { fontFamily: "'Playfair Display', Georgia, serif" };

const metaFor = (chat, isOpening) => {
  if (isOpening) return 'Opening…';
  if (!chat) return null; // the title says "New chat"
  if (chat.pinned || !chat.expiresAt) return 'Pinned';
  const days = Math.max(0, Math.ceil((new Date(chat.expiresAt).getTime() - Date.now()) / DAY_MS));
  return days <= 1 ? 'Last day' : `${days} days left`;
};

// The chat's name, in the editor title's serif; click to rename in place
const ChatTitle = ({ chat, onRename }) => {
  const [draft, setDraft] = useState(null); // null = not editing
  if (!chat) {
    return <h2 className="text-xl md:text-[26px] leading-tight text-stone-500 truncate" style={TITLE_FONT}>New chat</h2>;
  }
  const save = async () => {
    const clean = (draft || '').trim();
    if (clean && clean !== chat.title && !(await onRename(chat.chatId, clean))) return;
    setDraft(null);
  };
  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={CHAT_TITLE_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setDraft(null);
        }}
        className="w-full bg-transparent outline-none text-xl md:text-[26px] leading-tight text-[#f4eadc] border-b border-[#e85d56]/50"
        style={TITLE_FONT}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setDraft(chat.title)}
      title="Rename this chat"
      className="block max-w-full text-left text-xl md:text-[26px] leading-tight text-[#f4eadc] truncate cursor-pointer hover:text-white transition-colors"
      style={TITLE_FONT}
    >
      {chat.title}
    </button>
  );
};

// An empty chat: the header already says "New chat", so just one quiet line of what to ask, low down
// by the message box where the eye already is
const EmptyState = () => (
  <motion.p
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { y: HEIGHT_SPRING, opacity: FADE_IN } }}
    className="mt-auto px-1 pb-1 text-sm text-stone-500 leading-relaxed"
  >
    Ask about your notes — find, summarise, draft or tidy them up. Nothing changes until you say so.
  </motion.p>
);

// While the agent works: one line that changes in place (the toast's crossfade), with the earlier
// steps folded under a toggle
const WorkingLine = ({ steps }) => {
  const [showSteps, setShowSteps] = useState(false);
  const current = steps[steps.length - 1] || 'Thinking…';
  const earlier = steps.slice(0, -1);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { y: HEIGHT_SPRING, opacity: FADE_IN } }}
      className="self-start flex flex-col gap-1 px-1 py-1"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex gap-1 shrink-0">
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#e85d56] animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
        <span className="relative min-w-0 text-sm font-medium text-stone-300">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={current} {...SWAP} className="block truncate">{current}</motion.span>
          </AnimatePresence>
        </span>
        {earlier.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="shrink-0 inline-flex items-center gap-0.5 text-xs text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
          >
            {earlier.length + 1} steps
            <motion.span animate={{ rotate: showSteps ? 180 : 0 }} transition={HEIGHT_SPRING} className="flex"><MdKeyboardArrowDown /></motion.span>
          </button>
        )}
      </div>
      <Collapse isOpen={showSteps}>
        <div className="flex flex-col gap-0.5 pl-[34px] pt-0.5">
          {earlier.map((label, idx) => <span key={`${idx}-${label}`} className="text-xs text-stone-500">{label}</span>)}
        </div>
      </Collapse>
    </motion.div>
  );
};

// The round Send button (the dock's + colour); a quiet Stop while the agent works
const SendButton = ({ isBusy, canSend, onSend, onStop }) => (
  <button
    type="button"
    onClick={isBusy ? onStop : onSend}
    disabled={!isBusy && !canSend}
    title={isBusy ? 'Stop' : 'Send (Enter) · Shift+Enter for a new line'}
    className={`relative w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white overflow-hidden transition-[background-color,opacity] duration-150 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed active:scale-95 ${
      isBusy ? 'bg-stone-600 hover:bg-stone-500' : 'bg-[#dd5e57] hover:bg-[#fb6d65]'
    }`}
  >
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={isBusy ? 'stop' : 'send'}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1, transition: { scale: { type: 'spring', visualDuration: 0.2, bounce: 0.35 }, opacity: FADE_IN } }}
        exit={{ opacity: 0, scale: 0.6, transition: FADE_OUT }}
        className="flex"
      >
        {isBusy ? <IoStop className="text-sm" /> : <LuArrowUp className="text-lg" />}
      </motion.span>
    </AnimatePresence>
  </button>
);

// The message box. Its own component (and state): typing re-renders only this, not the panel.
const Composer = ({ isBusy, textareaRef }) => {
  const [draft, setDraft] = useState('');

  // Grows with its text, up to ~8 lines
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft, textareaRef]);

  const send = () => {
    const text = draft.trim();
    if (!text || isBusy) return;
    useAgentStore.getState().sendMessage(text);
    setDraft('');
  };

  return (
    <div className="flex items-end gap-2 rounded-[22px] bg-white/[0.05] border border-white/[0.08] focus-within:border-white/20 transition-colors pl-4 pr-1.5 py-1.5">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        placeholder="Ask about your notes…"
        className="flex-1 min-w-0 bg-transparent outline-none resize-none py-1.5 text-sm md:text-[15px] font-medium text-stone-100 placeholder:text-stone-500 leading-relaxed agent-scrollbar"
      />
      <SendButton isBusy={isBusy} canSend={Boolean(draft.trim())} onSend={send} onStop={useAgentStore.getState().stop} />
    </div>
  );
};

const AgentPanel = () => {
  const messages = useAgentStore((s) => s.messages);
  const isBusy = useAgentStore((s) => s.isBusy);
  const steps = useAgentStore((s) => s.steps);
  const chats = useAgentStore((s) => s.chats);
  const chatsError = useAgentStore((s) => s.chatsError);
  const activeChatId = useAgentStore((s) => s.activeChatId);
  const isOpeningChat = useAgentStore((s) => s.isOpeningChat);
  const scrollTarget = useAgentStore((s) => s.scrollTarget);
  const scopes = useAgentStore((s) => s.scopes);
  const activity = useAgentStore((s) => s.activity);
  const activityError = useAgentStore((s) => s.activityError);

  const isDockMobile = useMediaQuery(DOCK_MOBILE_QUERY);
  const isBelowTablet = useMediaQuery(BELOW_TABLET_QUERY);
  const dock = isDockMobile ? DOCK_METRICS.mobile : DOCK_METRICS.desktop;
  const gap = isBelowTablet ? PANEL_GAP.phone : PANEL_GAP.desktop;
  // The dock compacts while the chat is open (as for a note): the card ends `gap` above it
  const bottomClear = dock.height[1] + dock.paddingBottom[1] + gap;
  // …and starts `gap` below the navbar's search row — measured, since the navbar's own box is
  // taller than what you see of it (the "Quill" title's padding), which left a bigger gap on top
  const contentTop = isBelowTablet ? NAVBAR_H.phone : NAVBAR_H.desktop;
  const [navBottom, setNavBottom] = useState(null);
  // The navbar is removed while a note is open in the editor and comes back as a new element, so
  // it's looked up again each time the editor closes; a size of 0 (a row going away) is ignored —
  // read as 0, it put the card up under the navbar after opening a note from the chat.
  const isEditorActive = useTabsStore((s) => s.activeTabId !== 'home');
  useLayoutEffect(() => {
    if (isEditorActive) return undefined;
    const row = document.querySelector('[data-navbar-search]');
    if (!row) return undefined;
    const measure = () => {
      const rect = row.getBoundingClientRect();
      if (rect.height > 0) setNavBottom(Math.round(rect.bottom));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isEditorActive]);
  const topClear = (navBottom ?? contentTop - gap) + gap;

  const [sideTab, setSideTab] = useState(null); // null | 'chats' | 'activity' | 'settings'
  const [openingNoteId, setOpeningNoteId] = useState(null);
  const openingNoteRef = useRef(null);
  const messagesRef = useRef(null);
  const topLineRef = useRef(null);
  const bottomLineRef = useRef(null);
  const textareaRef = useRef(null);

  const activeChat = activeChatId ? chats?.find((c) => c.chatId === activeChatId) : null;
  // Where messages scroll under the header / composer: a divider appears and the text softens
  const updateMessagesFade = useScrollEdges(messagesRef, 12, topLineRef, bottomLineRef, messages.length);

  // Restore any saved conversation the first time the panel mounts, and start waking the (possibly
  // sleeping) assistant services while the user types
  useEffect(() => {
    const { hydrate, wake } = useAgentStore.getState();
    hydrate();
    wake();
  }, []);

  // Scrolls only the message list: scrollIntoView also scrolled the page itself, which on phones
  // (with the keyboard up the page can scroll) pushed the card up under the navbar, away from the dock
  useEffect(() => {
    const list = messagesRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isBusy, steps.length]);

  // A used split-choice / group button: bring its review list into view and briefly outline it
  useEffect(() => {
    const element = scrollTarget && document.getElementById(`agent-message-${scrollTarget.messageId}`);
    if (!element) return undefined;
    const outline = ['ring-2', 'ring-[#e85d56]/60', 'ring-offset-4', 'ring-offset-[#2a2a2a]'];
    const list = messagesRef.current;
    if (list) {
      const offset = element.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTo({ top: list.scrollTop + offset - (list.clientHeight - element.offsetHeight) / 2, behavior: 'smooth' });
    }
    element.classList.add(...outline);
    const timer = setTimeout(() => element.classList.remove(...outline), 1500);
    return () => {
      clearTimeout(timer);
      element.classList.remove(...outline);
    };
  }, [scrollTarget]);

  // Cited notes open in the editor dock. Fetched fresh so a note deleted since the chat stays honest
  // (404 -> friendly toast). Stable (reads the in-flight note from a ref); which note is opening reaches
  // the citation cards through OpeningNoteContext, so messages don't re-render for it.
  const openNote = useCallback(async (noteId) => {
    if (openingNoteRef.current) return;
    openingNoteRef.current = noteId;
    setOpeningNoteId(noteId);
    try {
      const note = (await axiosInstance.get(`/get-note/${noteId}`)).data?.note;
      if (!note) throw new Error('empty note payload');
      useTabsStore.getState().openTab(note);
    } catch {
      useTabsStore.getState().showTabToast('Could not open that note. It may have been moved or deleted.', 'error');
    } finally {
      openingNoteRef.current = null;
      setOpeningNoteId(null);
    }
  }, []);

  const openChat = useCallback(async (chatId) => {
    await useAgentStore.getState().openChat(chatId);
    if (useAgentStore.getState().activeChatId === chatId && isBelowTablet) setSideTab(null);
  }, [isBelowTablet]);

  // Everything a message can do, in one stable object
  const actions = useMemo(() => {
    const s = useAgentStore.getState();
    return {
      toggleReviewItem: s.toggleReviewItem,
      applyReviewList: s.applyReviewList,
      undoReviewList: s.undoReviewList,
      discardReviewList: s.discardReviewList,
      toggleGroupChange: s.toggleGroupChange,
      toggleGroupNote: s.toggleGroupNote,
      releaseHeld: s.releaseHeld,
      openSplitChoice: s.openSplitChoice,
      resolvePendingEdit: s.resolvePendingEdit,
      openNote,
      openChat,
    };
  }, [openNote, openChat]);

  const showSide = (tab) => {
    const s = useAgentStore.getState();
    if (tab === 'chats') s.loadChats();
    if (tab === 'activity') s.loadActivity();
    if (tab === 'settings') s.loadScopes();
    setSideTab(tab);
  };
  const toggleSide = (tab) => (sideTab && (tab === 'settings') === (sideTab === 'settings') ? setSideTab(null) : showSide(tab));

  const handleNewChat = () => {
    useAgentStore.getState().newChat();
    textareaRef.current?.focus();
  };

  const isSideOpen = sideTab !== null;
  const meta = metaFor(activeChat, isOpeningChat);
  const isHistoryOn = sideTab === 'chats' || sideTab === 'activity';

  const renderSidePanel = (onHeaderPointerDown) => isSideOpen && (
    <AgentSidePanel
      onHeaderPointerDown={onHeaderPointerDown}
      tab={sideTab}
      onTabChange={showSide}
      onClose={() => setSideTab(null)}
      chats={chats}
      chatsError={chatsError}
      activeChatId={activeChatId}
      isBusy={isBusy}
      onOpenChat={openChat}
      // From History: a new chat, and on phones the sheet steps aside so you land in it
      onNewChat={() => { handleNewChat(); if (isBelowTablet) setSideTab(null); }}
      onRename={useAgentStore.getState().renameChat}
      onTogglePin={useAgentStore.getState().togglePin}
      onDelete={useAgentStore.getState().deleteChat}
      activity={activity}
      activityError={activityError}
      onUndo={useAgentStore.getState().undoFromActivity}
      scopes={scopes}
      onScopeChange={useAgentStore.getState().setScope}
    />
  );

  return (
    // relative z-[1]: above the particle canvas (a fixed layer), which otherwise paints over any part
    // of the panel that isn't positioned or transformed — e.g. the side panel once its slide-in ends
    // Placed from the page content's top (below the navbar's box), pulled up to `topClear`
    <div className="agent-panel relative z-[1] px-2 md:px-4" style={{ marginTop: topClear - contentTop, height: `calc(100dvh - ${topClear}px - ${bottomClear}px)` }}>
      {/* The row: the card, and the side panel beside it on wider screens. Its max width widens as
          the panel opens (as the editor's row does for Summary), so the card slides aside. The card
          keeps a fixed width meanwhile (a size container measures the room): sized by what was left
          of the row, it squeezed and re-wrapped every message on every frame of the slide. It only
          narrows — once, without animating — where the screen can't fit both. */}
      <div className="h-full @container">
      <div
        className="flex h-full mx-auto w-full transition-[max-width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ maxWidth: isSideOpen && !isBelowTablet ? CARD_MAX_W + ROW_GAP + SIDE_W : CARD_MAX_W, gap: ROW_GAP }}
      >
        <div
          className="shrink-0 h-full flex flex-col rounded-[24px] overflow-hidden border border-white/[0.08] shadow-2xl bg-(--dock-fill) animate-scale-up-quick"
          style={{ width: isBelowTablet ? '100%' : `min(${CARD_MAX_W}px, 100cqw - ${isSideOpen ? ROW_GAP + SIDE_W : 0}px)` }}
        >
          {/* Header: one row — the chat's name in the editor title's serif, how long it's kept as a
              quiet note beside it (in History on phones, where the row is short), the buttons */}
          <div className="shrink-0 flex items-center gap-3 px-5 md:px-7 pt-4 md:pt-5 pb-2">
            <div className="group/title flex-1 min-w-0 flex items-baseline gap-2.5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={activeChat?.chatId || 'new'} {...SWAP} className="min-w-0 has-[input]:flex-1">
                  <ChatTitle chat={activeChat} onRename={useAgentStore.getState().renameChat} />
                </motion.div>
              </AnimatePresence>
              <AnimatePresence mode="popLayout" initial={false}>
                {meta && (
                  <motion.span key={meta} {...SWAP} className="hidden sm:inline group-has-[input]/title:hidden shrink-0 text-xs font-medium text-stone-500 whitespace-nowrap">
                    {meta}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              {/* New chat first; History and Settings as icons, like it (the History label was redundant) */}
              <button type="button" onClick={handleNewChat} disabled={isBusy} title={isBusy ? 'Wait for the answer (or press Stop) first' : 'New chat'} className={btnRoundDark}>
                <IoAdd className="text-xl" />
              </button>
              <button
                type="button"
                onClick={() => toggleSide('chats')}
                title="History — your chats and past bulk changes"
                aria-label="History"
                className={isHistoryOn ? btnRoundDarkOn : btnRoundDark}
              >
                <MdHistory className="text-lg" />
              </button>
              <button
                type="button"
                onClick={() => toggleSide('settings')}
                title="What the agent may do"
                className={sideTab === 'settings' ? btnRoundDarkOn : btnRoundDark}
              >
                <IoSettingsOutline className="text-lg" />
              </button>
            </div>
          </div>

          {/* Under the header: shows only while messages are scrolled beneath it */}
          <div className="shrink-0 px-5 md:px-7"><div ref={topLineRef} className="h-px w-full bg-white/10 opacity-0" /></div>

          {/* Messages */}
          {/* agent-scrollbar-centred: the scrollbar's lane is reserved on both sides, taken out of the
              padding, so the messages sit centred (index.css) */}
          <div ref={messagesRef} onScroll={updateMessagesFade} className="flex-1 min-h-0 overflow-y-auto agent-scrollbar agent-scrollbar-centred px-1.5 md:px-[18px] pt-2 pb-4 flex flex-col gap-3">
            {messages.length === 0 && !isBusy && !isOpeningChat && <EmptyState />}
            <OpeningNoteContext.Provider value={openingNoteId}>
              {messages.map((message) => (
                <AgentMessage key={message.id} message={message} actions={actions} />
              ))}
            </OpeningNoteContext.Provider>
            {isBusy && <WorkingLine steps={steps} />}
          </div>

          {/* Composer: the editor's bottom bar, in dark */}
          <div className="shrink-0 px-5 md:px-7"><div ref={bottomLineRef} className="h-px w-full bg-white/10 opacity-0" /></div>
          <div className="shrink-0 px-3 md:px-5 py-3">
            <Composer isBusy={isBusy} textareaRef={textareaRef} />
          </div>
        </div>

        {/* History / Settings: beside the card on wider screens */}
        {!isBelowTablet && (
          <AnimatePresence>
            {isSideOpen && (
              <motion.div
                key="agent-side"
                initial={{ opacity: 0, x: -16, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1, transition: { default: SIDE_SPRING, opacity: FADE_IN } }}
                exit={{ opacity: 0, x: -16, scale: 0.97, transition: { default: HEIGHT_SPRING, opacity: FADE_OUT } }}
                style={{ width: SIDE_W, originX: 0 }}
                className="shrink-0 h-full bg-[#1e1e1e] rounded-[24px] border border-[#333] shadow-xl overflow-hidden"
              >
                {renderSidePanel()}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
      </div>

      {/* …and a bottom sheet on phones, pulled down to close (it places itself above the dock) */}
      {isBelowTablet && (
        <AnimatePresence>
          {isSideOpen && (
            <BottomSheet key="agent-side-sheet" onClose={() => setSideTab(null)} className="agent-panel">
              {(startDrag) => renderSidePanel(startDrag)}
            </BottomSheet>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

const GuardedAgentPanel = () => (
  <RenderGuard fallback={<p className="text-sm text-red-300 p-5">The agent panel hit an error — reload the page.</p>}>
    <AgentPanel />
  </RenderGuard>
);

export default GuardedAgentPanel;
