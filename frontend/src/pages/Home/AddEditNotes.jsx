import { memo, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { MdAdd, MdClose, MdRefresh, MdKeyboardArrowDown, MdCheckBoxOutlineBlank, MdCheckBox, MdNotes, MdOutlineDragIndicator, MdViewSidebar, MdOutlineFolder, MdOpenInFull, MdCloseFullscreen, MdOutlineLink } from 'react-icons/md'
import { FaWandMagicSparkles, FaTag } from 'react-icons/fa6'
import { RiSparkling2Fill } from 'react-icons/ri'
import { LuUndo2 } from 'react-icons/lu'
import axiosInstance from '../../utils/axiosInstance';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import MoveToPicker from '../../components/Cards/MoveToPicker';
import { useQueryClient } from '@tanstack/react-query';
import { useFoldersQuery, QUERY_KEYS } from '../../hooks/useNotesQuery';
import { useToastStore } from '../../store/useToastStore';
import { editorRegistry } from '../../utils/editorRegistry';
import { generateObjectId } from '../../utils/objectId';
import { noteIndexingFailed } from '../../utils/noteIndexing';
import { useKeyboardTop } from '../../utils/virtualKeyboard';
import { useTabsStore } from '../../store/useTabsStore';
import { useUIStore } from '../../store/useUIStore';
import FadeTitle from '../../components/TabDock/FadeTitle';
import { EDITOR_CARD_STYLE, EDITOR_TOOLBAR_H_PX, EDITOR_TOOLBAR_DOT_SLOT_MARGIN_PX, fullscreenToolbarHeight } from '../../components/Editor/editorChrome';
import { DOCK_METRICS, DOCK_MOBILE_QUERY } from '../../components/TabDock/dockMetrics';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { BELOW_TABLET_QUERY } from '../../constants/breakpoints';
import { LiveMarkdownEditor, ReadOnlyMarkdown } from '../../components/Editor/markdownEditorLoader';

// Only shown while reviewing an agent's edit, so it loads when first needed
const AgentDiffView = lazy(() => import('../../components/Editor/AgentDiffView'));

// "Apply & save" from the agent chat marks a tab pendingSave; the editor runs
// its normal save once when it opens. Claimed per tab + revision so React
// StrictMode's double effects can't save twice.
const claimedAgentSaves = new Set();

// The agent strip's controls: exactly the Folder chip (its fill, border, shadow, height, regular-weight
// grey label, lighter icon). The view you're on is the same chip pressed: its hover shade, dark text.
const AGENT_CHIP = 'flex items-center h-(--chip-h) rounded-full border border-[#e0d2bf] shadow-sm text-xs md:text-sm font-sans font-normal transition-colors duration-200 cursor-pointer';
const AGENT_CHIP_OFF = 'bg-[#ebe0d3] hover:bg-[#e4d7c8] text-stone-500 hover:text-[#333]';
const AGENT_CHIP_ON = 'bg-[#e4d7c8] text-[#333]';

// While the text area's chunk loads (markdownEditorLoader): the note's text as plain text, in the
// editor's font and spacing, so the card is never blank and CodeMirror takes over in place
const TextAreaPlaceholder = ({ text }) => (
  <div className="font-['Lora',Georgia,serif] text-[#333] whitespace-pre-wrap break-words" aria-hidden="true">
    {text || <span className="text-[#a8a29e]">Start typing...</span>}
  </div>
);

const isMobileOrTouch = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches || window.matchMedia(BELOW_TABLET_QUERY).matches);

const SortableChecklistItem = ({ id, item, index, toggleChecklistItem, handleChecklistItemChange, removeChecklistItem }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    // Translate instead of Transform preserves exact dimensions without squishing over lines of text
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 0 : 'auto',
    opacity: isDragging ? 0.3 : 1, // Dim the original item during drag
  };

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col gap-1 relative w-full group min-w-0">
      <div className={`flex items-center gap-2.5 mb-2.5 transition-colors ${isDragging ? '' : ''}`}>
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500 transition-colors flex-shrink-0">
          <MdOutlineDragIndicator className="text-xl" />
        </button>
        <button className='cursor-pointer text-stone-500 hover:text-[#e85d56] transition-colors text-xl flex-shrink-0' onClick={() => toggleChecklistItem(index)}>
          {item.completed ? <MdCheckBox className="text-[#e85d56]" /> : <MdCheckBoxOutlineBlank />}
        </button>
        <input
          type="text"
          value={item.text}
          onChange={(e) => handleChecklistItemChange(index, e.target.value)}
          className={`text-base bg-transparent outline-none w-full min-w-0 break-words border-b border-transparent focus:border-black/10 transition-colors py-1 caret-[#e85d56] cursor-text ${item.completed ? 'line-through text-stone-400' : 'text-[#333]'}`}
          placeholder='Checklist item'
        />
        <button className='cursor-pointer text-stone-400 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:text-[#e85d56] flex-shrink-0 p-0.5' onClick={() => removeChecklistItem(index)} title="Remove item">
          <MdClose className="text-xl" />
        </button>
      </div>
    </div>
  );
};



const AddEditNotes = ({ type, noteData, onUpdateTabState, onClose, onSaveSuccess, showToastMessage, isActive, onToggleMockPanel, onSummaryReceived }) => {
  const queryClient = useQueryClient();
  const { data: folders = [] } = useFoldersQuery();
  const [tags, setTags] = useState(noteData?.tags || []);
  const [content, setContent] = useState(noteData?.content || "");
  const [title, setTitle] = useState(noteData?.title || "");
  const [folderId, setFolderId] = useState(noteData?.folderId || null);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const isEditorFullscreen = useUIStore((s) => s.isEditorFullscreen);
  const toggleEditorFullscreen = useUIStore((s) => s.toggleEditorFullscreen);
  // Toolbar height: card mode's, easing to the full-screen one (fits the dock's dot) along the
  // full-screen transition (--fs, set by GlobalEditorOverlay)
  const dockMetrics = useMediaQuery(DOCK_MOBILE_QUERY) ? DOCK_METRICS.mobile : DOCK_METRICS.desktop;
  const isBelowTablet = useMediaQuery(BELOW_TABLET_QUERY);
  const toolbarCardH = isBelowTablet ? EDITOR_TOOLBAR_H_PX.phone : EDITOR_TOOLBAR_H_PX.desktop;
  // a touch screen or a small one: the text area doesn't take focus by itself (it would pop the keyboard)
  const isMobileOrTouchScreen = useMediaQuery('(pointer: coarse)') || isBelowTablet;
  const toolbarHeight = `calc(${toolbarCardH}px + ${fullscreenToolbarHeight(dockMetrics) - toolbarCardH}px * var(--fs, 0))`;
  const dotSlotWidth = dockMetrics.height[1] + 2 * EDITOR_TOOLBAR_DOT_SLOT_MARGIN_PX;
  const [error, setError] = useState("")
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isChecklist, setIsChecklist] = useState(noteData?.isChecklist || false);
  const [checklist, setChecklist] = useState(() => (noteData?.checklist || []).map((item, i) => item.id ? item : { ...item, id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}` }));
  const [tagInputValue, setTagInputValue] = useState("");
  const [editingTagIndex, setEditingTagIndex] = useState(null);
  const [editingTagValue, setEditingTagValue] = useState("");
  const [activeChecklistId, setActiveChecklistId] = useState(null);

  // Ref to the CodeMirror editor view for programmatic focus
  const cmViewRef = useRef(null);

  // The scrolling area's reserved scrollbar gutter (always kept, see .editor-scrollbar) is taken
  // back out of its right padding (.editor-column in index.css), so its left and right margins
  // match. Its width depends on the browser and zoom, so it's measured: the element's width minus
  // the width available to its content (it has no border). Re-measured on resize (e.g. zoom).
  const scrollAreaRef = useRef(null);
  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const measure = () => el.style.setProperty('--scrollbar-gutter-w', `${el.offsetWidth - el.clientWidth}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The on-screen keyboard covers the page while the editor is open (utils/virtualKeyboard): the
  // editor keeps its size and the part of the scroll area under the keyboard is made reachable (a
  // spacer of that height at the end), so the line you're on can sit above it. CodeMirror keeps its
  // cursor there (MarkdownEditor); other fields (checklist items, tags) are scrolled up on focus.
  const keyboardTop = useKeyboardTop();
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);
  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    const overlap = keyboardTop === null || !el ? 0 : Math.max(0, Math.round(el.getBoundingClientRect().bottom - keyboardTop));
    setKeyboardOverlap(overlap);
  }, [keyboardTop]);
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || keyboardTop === null) return undefined;
    const keepFieldVisible = () => {
      const field = document.activeElement;
      if (!field || !el.contains(field) || field.closest('.cm-editor')) return;
      const overshoot = field.getBoundingClientRect().bottom + 24 - keyboardTop;
      if (overshoot > 0) el.scrollBy({ top: overshoot, behavior: 'smooth' });
    };
    keepFieldVisible();
    el.addEventListener('focusin', keepFieldVisible);
    return () => el.removeEventListener('focusin', keepFieldVisible);
  }, [keyboardTop]);

  const currentNoteId = noteData?._id;

  const tagScrollContainerRef = useRef(null);
  const tagInputRef = useRef(null);
  const [showPinnedAddButton, setShowPinnedAddButton] = useState(false);

  const checkTagOverflow = useCallback(() => {
    const el = tagScrollContainerRef.current;
    if (!el) return;
    const isOverflowing = el.scrollWidth > el.clientWidth + 8;
    const isScrolledToEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 16;
    setShowPinnedAddButton(isOverflowing && !isScrolledToEnd);
  }, []);

  useEffect(() => {
    checkTagOverflow();
    window.addEventListener('resize', checkTagOverflow);
    return () => window.removeEventListener('resize', checkTagOverflow);
  }, [tags, checkTagOverflow]);

  const handleScrollToTagInput = () => {
    if (tagScrollContainerRef.current) {
      tagScrollContainerRef.current.scrollTo({
        left: tagScrollContainerRef.current.scrollWidth,
        behavior: 'smooth',
      });
    }
    setTimeout(() => {
      tagInputRef.current?.focus();
    }, 150);
  };

  const [linkPreviews, setLinkPreviews] = useState(noteData?.linkPreviews || []);
  const [isLinkPreviewsOpen, setIsLinkPreviewsOpen] = useState(true);
  const userExpandedLinkPreviewsRef = useRef(false);
  const fetchingUrls = useRef(new Set());
  const fetchingPromises = useRef(new Map());
  const dismissedUrlsRef = useRef(new Set());
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const fetchPreview = useCallback(async (url) => {
    dismissedUrlsRef.current.delete(url);
    fetchingUrls.current.add(url);

    // Initial fallback for instantaneous 0ms display on paste
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      // ignore
    }
    const siteName = host.startsWith("www.") ? host.substring(4) : host;
    const initialFallback = {
      url,
      title: url,
      description: "",
      image: "",
      siteName: siteName
    };
    setLinkPreviews(prev => {
      if (prev.some(p => p.url === url)) return prev;
      return [...prev, initialFallback];
    });

    const p = (async () => {
      try {
        const response = await axiosInstance.post("/notes/extract-preview", { url });
        if (response.data && response.data.preview) {
          setLinkPreviews(prev => {
            // Double check if the URL still exists in the latest content before adding it
            const currentUrls = contentRef.current.match(/(https?:\/\/[^\s]+)/g) || [];
            const currentCleanUrls = currentUrls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
            if (!currentCleanUrls.includes(url)) return prev.filter(p => p.url !== url);
            return prev.map(p => (p.url === url ? response.data.preview : p));
          });
          return response.data.preview;
        }
        return initialFallback;
      } catch (err) {
        console.error("Failed to fetch link preview for", url, err);
        return initialFallback;
      } finally {
        fetchingUrls.current.delete(url);
        fetchingPromises.current.delete(url);
      }
    })();
    fetchingPromises.current.set(url, p);
    return p;
  }, []);

  const getImmediatePreviewsForSave = useCallback((currentContent, currentPreviews) => {
    if (isChecklist) return [];
    const urls = currentContent.match(/(https?:\/\/[^\s]+)/g) || [];
    const cleanUrls = urls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
    const uniqueUrls = [...new Set(cleanUrls)];

    return uniqueUrls.map(url => {
      const existing = currentPreviews.find(p => p.url === url);
      if (existing) return existing;
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
        // ignore
      }
      const siteName = host.startsWith("www.") ? host.substring(4) : host;
      return {
        url,
        title: url,
        description: "",
        image: "",
        siteName
      };
    });
  }, [isChecklist]);

  useEffect(() => {
    if (isChecklist) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkPreviews(prev => (prev.length > 0 ? [] : prev));
      return;
    }
    const urls = content.match(/(https?:\/\/[^\s]+)/g) || [];
    const cleanUrls = urls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
    const uniqueUrls = [...new Set(cleanUrls)];

    // Sync linkPreviews state to only keep previews of URLs that actually still exist in content
    setLinkPreviews(prev => {
      if (prev.length === 0) return prev;
      const filtered = prev.filter(p => uniqueUrls.includes(p.url));
      if (filtered.length !== prev.length) {
        return filtered;
      }
      return prev;
    });
  }, [content, isChecklist]);

  const [refreshingUrls, setRefreshingUrls] = useState(new Set());

  const isSimplePreview = useCallback((preview) => (
    !preview.image && (!preview.description || preview.title === preview.url)
  ), []);

  const handleRefreshPreview = useCallback(async (url) => {
    if (refreshingUrls.has(url)) return;
    setRefreshingUrls((prev) => new Set(prev).add(url));

    try {
      const response = await axiosInstance.post("/notes/extract-preview", { url });
      if (response.data && response.data.preview) {
        const enriched = response.data.preview;
        const currentUrls = contentRef.current.match(/(https?:\/\/[^\s]+)/g) || [];
        const currentCleanUrls = currentUrls.map((u) => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
        if (!currentCleanUrls.includes(url)) return;

        let updatedPreviews = [];
        setLinkPreviews((prev) => {
          const updated = prev.map((p) => (p.url === url ? enriched : p));
          updatedPreviews = updated;
          return updated;
        });

        // Sync active draft in editorRegistry
        if (currentNoteId) {
          const draft = editorRegistry.getDraft(currentNoteId);
          if (draft) {
            editorRegistry.setDraft(currentNoteId, { ...draft, linkPreviews: updatedPreviews });
          }
        }

        // If note is an existing saved note, update draft & baseline and sync query cache
        if (currentNoteId && !noteData?.isDraft) {
          axiosInstance.put(`/edit-note/${currentNoteId}`, { linkPreviews: updatedPreviews }).catch((err) => {
            console.error("Failed to background-save refreshed preview:", err);
          });
          const baseline = editorRegistry.getBaseline(currentNoteId);
          if (baseline) {
            editorRegistry.setBaseline(currentNoteId, { ...baseline, linkPreviews: updatedPreviews });
          }
          const patchList = (list) =>
            list.map((n) => (n._id === currentNoteId ? { ...n, linkPreviews: updatedPreviews } : n));
          const previous = queryClient.getQueriesData({ queryKey: QUERY_KEYS.NOTES });
          for (const [key, list] of previous) {
            if (!Array.isArray(list)) continue;
            if (list.some((n) => n._id === currentNoteId)) {
              queryClient.setQueryData(key, patchList(list));
            }
          }
        }
        useToastStore.getState().showToast("Preview updated", "success");
      } else {
        useToastStore.getState().showToast("No rich preview available for this link", "info");
      }
    } catch (err) {
      console.error("Failed to refresh link preview for", url, err);
      useToastStore.getState().showToast("Failed to refresh preview", "warning");
    } finally {
      setRefreshingUrls((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }
  }, [refreshingUrls, currentNoteId, noteData, queryClient]);

  const handleRemoveLinkPreview = useCallback((urlToRemove) => {
    dismissedUrlsRef.current.add(urlToRemove);
    setLinkPreviews(prev => prev.filter(p => p.url !== urlToRemove));
  }, []);

  const toggleLinkPreviews = useCallback(() => {
    setIsLinkPreviewsOpen((prev) => {
      if (!prev) {
        userExpandedLinkPreviewsRef.current = true;
      }
      return !prev;
    });
  }, []);

  // Stable on purpose: a new onChange makes the text area reconfigure CodeMirror (see MarkdownEditor)
  const handleContentChange = useCallback((val) => {
    setContent(val);
    setError("");
  }, []);

  // Auto-focus the CodeMirror editor when this tab becomes the active tab (desktop only)
  useEffect(() => {
    if (isActive && !isChecklist && cmViewRef.current && !isMobileOrTouch()) {
      // Small delay lets the display:none → display:block paint happen first
      const t = setTimeout(() => cmViewRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isActive, isChecklist]);

  const charCount = content.length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;


  useEffect(() => {
    if (onUpdateTabState) onUpdateTabState({ title });
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (!onUpdateTabState) return;
    const timer = setTimeout(() => {
      onUpdateTabState({ content, tags, isChecklist, checklist, folderId, linkPreviews });
    }, 250);
    return () => clearTimeout(timer);
  }, [content, tags, isChecklist, checklist, folderId, linkPreviews]); // eslint-disable-line react-hooks/exhaustive-deps

  const latestDraftRef = useRef();
  // The tab revision this editor was opened with; a different one at unmount
  // means the tab was changed from outside (agent edit, revert).
  const mountRevRef = useRef(noteData?.externalRev || 0);

  // Keep in-memory registry draft immediately up to date for dirty-check evaluations
  useEffect(() => {
    const currentDraft = {
      title,
      content,
      tags,
      isChecklist,
      checklist,
      folderId,
      linkPreviews,
    };
    latestDraftRef.current = currentDraft;
    if (currentNoteId) {
      editorRegistry.setDraft(currentNoteId, currentDraft);
    }
  }, [currentNoteId, title, content, tags, isChecklist, checklist, folderId, linkPreviews]);

  // Whether what this editor holds may be written back on closing: only while the tab is still
  // open (so a discarded tab isn't resurrected) and wasn't changed from outside (agent edit, revert:
  // this copy is stale and would overwrite the new contents)
  const canWriteBackOnClose = useCallback(() => {
    if (!currentNoteId) return false;
    const liveTab = useTabsStore.getState().openTabs.find((t) => t._id === currentNoteId);
    return Boolean(liveTab) && (liveTab.externalRev || 0) === mountRevRef.current;
  }, [currentNoteId]);

  // On unmount (e.g. switching tabs), flush the latest draft. The text area saves its own CodeMirror
  // state (cursor, undo history) under the same rule (MarkdownEditor).
  useEffect(() => () => {
    if (canWriteBackOnClose() && onUpdateTabState && latestDraftRef.current) {
      onUpdateTabState(latestDraftRef.current);
    }
  }, [canWriteBackOnClose, onUpdateTabState]);


  const handleAddTag = () => {
    if (tagInputValue.trim() !== "") {
      const newTag = tagInputValue.trim();
      if (!tags.includes(newTag)) {
        setTags([...tags, newTag]);
      }
      setTagInputValue("");
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags((prevTags) => prevTags.filter((tag) => tag !== tagToRemove));
  };

  const handleSaveEditedTag = (index) => {
    if (editingTagIndex !== index) return;
    const trimmed = editingTagValue.trim().replace(/^#+/, '');
    if (trimmed === "") {
      setTags((prevTags) => prevTags.filter((_, i) => i !== index));
    } else {
      setTags((prevTags) => {
        const updated = [...prevTags];
        const existingIdx = updated.indexOf(trimmed);
        if (existingIdx !== -1 && existingIdx !== index) {
          updated.splice(index, 1);
        } else {
          updated[index] = trimmed;
        }
        return updated;
      });
    }
    setEditingTagIndex(null);
    setEditingTagValue("");
  };


  const handleChecklistItemChange = (index, newText) => {
    const newChecklist = [...checklist];
    newChecklist[index].text = newText;
    setChecklist(newChecklist);
  };

  const toggleChecklistItem = (index) => {
    const newChecklist = [...checklist];
    newChecklist[index].completed = !newChecklist[index].completed;
    setChecklist(newChecklist);
  };

  const addChecklistItem = () => {
    setChecklist([...checklist, { id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: '', completed: false }]);
  };

  const removeChecklistItem = (index) => {
    const newChecklist = [...checklist];
    newChecklist.splice(index, 1);
    setChecklist(newChecklist);
  };


  const handleSaveNote = useCallback(() => {
    try {
      const immediatePreviews = getImmediatePreviewsForSave(content, linkPreviews);
      // eslint-disable-next-line no-unused-vars
      const cleanedChecklist = checklist.map(({ id, ...rest }) => rest);

      const isDraft = Boolean(noteData?.isDraft || type === 'add');
      const targetNoteId = isDraft ? generateObjectId() : currentNoteId;

      const showInHome = Boolean(noteData?.showInHome);
      const noteObject = {
        _id: targetNoteId,
        title: title || " ",
        content: isChecklist ? "" : content,
        tags,
        isChecklist,
        checklist: cleanedChecklist,
        folderId: folderId || null,
        showInHome,
        linkPreviews: immediatePreviews,
        createdAt: noteData?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 1. Optimistic TanStack Query cache update
      if (isDraft) {
        if (!noteObject.folderId || noteObject.showInHome) {
          queryClient.setQueryData(QUERY_KEYS.HOME_NOTES, (prev = []) => (Array.isArray(prev) ? [...prev, noteObject] : [noteObject]));
        }
        if (noteObject.folderId) {
          queryClient.setQueryData(QUERY_KEYS.FOLDER_NOTES(noteObject.folderId), (prev = []) => (Array.isArray(prev) ? [...prev, noteObject] : [noteObject]));
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDER_NOTE_COUNTS });
        }
      } else {
        const patchNoteInList = (list) => list.map((n) => (n._id === targetNoteId ? { ...n, ...noteObject } : n));
        const previous = queryClient.getQueriesData({ queryKey: QUERY_KEYS.NOTES });
        for (const [key, list] of previous) {
          if (!Array.isArray(list)) continue;
          if (list.some((n) => n._id === targetNoteId)) {
            queryClient.setQueryData(key, patchNoteInList(list));
          }
        }
      }

      // 2. Register baseline & draft in editorRegistry
      editorRegistry.setBaseline(targetNoteId, noteObject);
      editorRegistry.setDraft(targetNoteId, noteObject);

      // 3. Tab closes immediately on frame 0
      onSaveSuccess();

      const notify = showToastMessage || useToastStore.getState().showToast;
      notify(isDraft ? "Note added successfully" : "Note updated successfully", "success");

      // 4. Background persistence with 1-retry transient policy
      const savePayload = {
        title: noteObject.title,
        content: noteObject.content,
        tags: noteObject.tags,
        isChecklist: noteObject.isChecklist,
        checklist: noteObject.checklist,
        folderId: noteObject.folderId,
        showInHome: noteObject.showInHome,
        linkPreviews: noteObject.linkPreviews,
      };
      if (isDraft) savePayload._id = targetNoteId;

      const performSave = async (retryCount = 0) => {
        try {
          const response = isDraft
            ? await axiosInstance.post("/add-note", savePayload)
            : await axiosInstance.put(`/edit-note/${targetNoteId}`, savePayload);

          if (response.data && response.data.note) {
            editorRegistry.setBaseline(targetNoteId, response.data.note);
            editorRegistry.setDraft(targetNoteId, response.data.note);
            if (response.data.indexing) {
              noteIndexingFailed(targetNoteId).then((failed) => {
                if (failed) useToastStore.getState().showToast("Note saved. Embedding failed.", "warning");
              });
            }
          }
        } catch (error) {
          const status = error.response?.status;
          const isTransient = !status || status >= 500 || error.code === 'ECONNABORTED';
          if (isTransient && retryCount < 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return performSave(retryCount + 1);
          }

          // Permanent failure or retry exhausted:
          // Rollback optimistic cache update
          if (isDraft) {
            if (!noteObject.folderId || noteObject.showInHome) {
              queryClient.setQueryData(QUERY_KEYS.HOME_NOTES, (prev = []) => (Array.isArray(prev) ? prev.filter((n) => n._id !== targetNoteId) : []));
            }
            if (noteObject.folderId) {
              queryClient.setQueryData(QUERY_KEYS.FOLDER_NOTES(noteObject.folderId), (prev = []) => (Array.isArray(prev) ? prev.filter((n) => n._id !== targetNoteId) : []));
              queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FOLDER_NOTE_COUNTS });
            }
          } else {
            queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NOTES });
          }

          // Auto-reopen as active tab so draft is preserved in front of the user
          useTabsStore.getState().openTab(noteObject);

          const errorMessage = error.response?.data?.message || "Failed to save note. Changes restored.";
          useToastStore.getState().showToast(errorMessage, "error");
        }
      };

      performSave();
    } catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      }
    }
  }, [noteData, currentNoteId, type, title, content, isChecklist, tags, checklist, folderId, onSaveSuccess, showToastMessage, linkPreviews, getImmediatePreviewsForSave, queryClient]);

  const handleAddNote = useCallback(() => {
    if (!isChecklist && !content && !title) {
      setError("Please enter content");
      return;
    }
    if (isChecklist && checklist.length === 0 && !title) {
      setError("Please add at least one checklist item");
      return;
    }
    setError("");
    handleSaveNote();
  }, [isChecklist, content, title, checklist, handleSaveNote]);

  // "Apply & save" from the agent chat: the same save the Save button does,
  // once the editor has mounted. The claim is taken inside the timer so a
  // StrictMode mount → unmount → mount still saves exactly once.
  useEffect(() => {
    if (!noteData?.pendingSave || !currentNoteId) return;
    const claim = `${currentNoteId}:${noteData.externalRev || 0}`;
    const timer = setTimeout(() => {
      if (claimedAgentSaves.has(claim)) return;
      claimedAgentSaves.add(claim);
      if (onUpdateTabState) onUpdateTabState({ pendingSave: false });
      handleAddNote();
    }, 0);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSummarize = async () => {
    if (!content.trim()) {
      setError("Please enter content to summarize.");
      return;
    }
    setIsSummarizing(true);
    setError("");
    try {
      const response = await axiosInstance.post("/summarize-note", {
        text: content, // Send the current content from the textarea
      });

      if (response.data && response.data.summary) {
        onSummaryReceived(response.data.summary);
      } else {
        onSummaryReceived("Could not summarize the note.");
      }
    } catch (error) {
      console.error("Error summarizing note:", error);
      if (error.response && error.response.data && error.response.data.message) {
        setError("Summarization error: " + error.response.data.message);
      } else {
        setError("An unexpected error occurred during summarization.");
      }
      onSummaryReceived("Failed to summarize.");
    } finally {
      setIsSummarizing(false);
    }
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  const handleDragStart = (event) => {
    setActiveChecklistId(event.active.id);
  };

  const handleDragEnd = (event) => {
    setActiveChecklistId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = checklist.findIndex(item => item.id === active.id);
      const newIndex = checklist.findIndex(item => item.id === over.id);
      setChecklist(arrayMove(checklist, oldIndex, newIndex));
    }
  };

  // An agent edit: 'changes' (a diff of your original against the text now — what opening an edit to
  // review lands on), 'before' (your original, read-only) or 'after' (the note, editable)
  const [agentView, setAgentView] = useState('changes');

  const activeChecklistItem = activeChecklistId ? checklist.find(i => i.id === activeChecklistId) : null;

  const checklistItems = useMemo(() => checklist.map(item => item.id), [checklist]);

  // Cheap derived check; avoid useMemo (React Compiler rejects manual deps here).
  const agentDiffHasChanges = Array.isArray(noteData?.agentDiff) && noteData.agentDiff.some((part) => part.added || part.removed);
  // What you had before the agent's edit: the diff's kept and removed parts
  const agentOriginalContent = Array.isArray(noteData?.agentDiff)
    ? noteData.agentDiff.filter((part) => !part.added).map((part) => part.value).join('')
    : content;
  const agentTitleChanged = noteData?.agentOriginalTitle !== undefined && noteData.agentOriginalTitle !== (noteData.title || '');
  const hasAgentBefore = Boolean(noteData?.agentStaged) && !isChecklist && (agentDiffHasChanges || agentTitleChanged);
  const isShowingBefore = hasAgentBefore && agentView === 'before';
  const isShowingChanges = hasAgentBefore && agentView === 'changes';

  return (
    <div className='editor-wrapper flex flex-col h-full w-full bg-[#f4eadc] overflow-hidden relative' style={EDITOR_CARD_STYLE}>

      {/* Agent-staged: a slim strip in the editor's own language (its meta line, its chips), not a
          yellow banner with a raw line diff — when the agent rewrites prose, every line showed as
          deleted and re-added, in markdown, above the same text again. Before / After swaps the
          body for your original, read-only, in the same editor look. */}
      {noteData?.agentStaged && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 md:px-7 pt-3 pb-2.5 border-b border-black/5 font-sans">
          <p className="flex items-center gap-1.5 min-w-0 text-[11px] md:text-[13px] font-medium tracking-wider md:tracking-[0.15em] uppercase text-stone-500">
            <RiSparkling2Fill className="shrink-0 text-[#e85d56] text-xs md:text-sm" />
            <span className="truncate">{type === 'edit' ? 'Edited by the agent' : 'Drafted by the agent'} · unsaved</span>
          </p>
          {/* Every control here is the editor's Folder chip (its height, fill, border, shadow, text);
              the view you're on is a dark ink pill — Changes on its own, Before | After as a pair. */}
          <div className="flex items-center gap-1.5 shrink-0 [--chip-h:26px] md:[--chip-h:34px]">
            {hasAgentBefore && (
              <button
                type="button"
                onClick={() => setAgentView('changes')}
                aria-pressed={agentView === 'changes'}
                className={`${AGENT_CHIP} px-3 ${agentView === 'changes' ? AGENT_CHIP_ON : AGENT_CHIP_OFF}`}
              >
                Changes
              </button>
            )}
            {hasAgentBefore && (
              <div role="tablist" aria-label="Your original or the note now" className="flex items-center h-(--chip-h) rounded-full bg-[#ebe0d3] border border-[#e0d2bf] shadow-sm overflow-hidden">
                {[['before', 'Before'], ['after', 'After']].map(([view, label], idx) => (
                  <span key={view} className="flex items-center h-full">
                    {idx > 0 && <span className="w-px h-3.5 bg-black/10" aria-hidden />}
                    <button
                      type="button"
                      role="tab"
                      aria-selected={agentView === view}
                      onClick={() => setAgentView(view)}
                      className={`h-full px-3 text-xs md:text-sm font-sans font-normal transition-colors duration-200 cursor-pointer ${
                        agentView === view ? AGENT_CHIP_ON : 'text-stone-500 hover:bg-[#e4d7c8] hover:text-[#333]'
                      }`}
                    >
                      {label}
                    </button>
                  </span>
                ))}
              </div>
            )}
            {noteData?.agentRevert && (
              <button
                type="button"
                onClick={() => useTabsStore.getState().revertAgentEdit(currentNoteId)}
                title="Put back exactly what you had before the agent's edit"
                className={`${AGENT_CHIP} gap-1.5 px-3 ${AGENT_CHIP_OFF}`}
              >
                <LuUndo2 className="text-sm text-stone-400" />
                Revert
              </button>
            )}
          </div>
        </div>
      )}

      {/* editor content area */}
      <div ref={scrollAreaRef} className='editor-column [--column-pad:1.25rem] md:[--column-pad:1.75rem] flex-grow flex flex-col pt-4 md:pt-5 pb-2 overflow-y-auto overflow-x-hidden editor-scrollbar'>

        {/* metadata area */}
        <div className="text-[11px] md:text-[13px] font-medium tracking-wider md:tracking-[0.15em] text-stone-500 mb-0.5 md:mb-1 uppercase flex items-center justify-between gap-1.5 md:gap-2 shrink-0">
          {/* Date · status. The part of the row that gives way on a narrow phone (fading out at its
              end), so the folder pill and the full-screen toggle keep their full size. */}
          <div className="flex min-w-0 pl-8 md:pl-0">
            <FadeTitle className="flex items-center gap-1 md:gap-2 min-w-0">
              <span className="shrink-0">{noteData?.createdAt ? new Date(noteData.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span className="text-[16px] leading-none mb-0.5 shrink-0">&middot;</span>
              <span className="shrink-0">{type === 'edit' ? 'EDITED' : 'NEW NOTE'}</span>
            </FadeTitle>
          </div>
          {/* Folder and the full-screen toggle beside it: never shrink. The toggle is round and as
              tall as the folder pill (both use --chip-h: the pill's own height at each size). */}
          <div className="flex items-center gap-1 md:gap-1.5 shrink-0 [--chip-h:26px] md:[--chip-h:34px]">
            {(() => {
              const folderObj = folderId ? folders.find(f => f._id === folderId) : null;
              return (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMovePicker(true);
                  }}
                  className="flex items-center gap-1.5 px-3 h-(--chip-h) bg-[#ebe0d3] hover:bg-[#e4d7c8] text-stone-600 rounded-full transition-all duration-200 text-xs md:text-sm font-sans tracking-normal normal-case border border-[#e0d2bf] shadow-sm cursor-pointer shrink-0"
                  title="Change note folder"
                >
                  {folderObj ? (
                    <>
                      <MdOutlineFolder style={{ color: folderObj.color }} size={16} />
                      <span className="text-[#333] font-medium truncate max-w-[100px] md:max-w-[120px]">{folderObj.name}</span>
                    </>
                  ) : (
                    <>
                      <MdOutlineFolder className="text-stone-400" size={16} />
                      <span className="text-stone-500 font-normal">Folder</span>
                    </>
                  )}
                </button>
              );
            })()}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleEditorFullscreen();
              }}
              className="flex shrink-0 size-(--chip-h) items-center justify-center rounded-full bg-[#ebe0d3] hover:bg-[#e4d7c8] text-stone-600 border border-[#e0d2bf] shadow-sm cursor-pointer transition-colors duration-200"
              title={isEditorFullscreen ? 'Exit full screen' : 'Full screen'}
              aria-label={isEditorFullscreen ? 'Exit full screen' : 'Full screen'}
              aria-pressed={isEditorFullscreen}
            >
              {isEditorFullscreen ? <MdCloseFullscreen className="text-[13px] md:text-[15px]" /> : <MdOpenInFull className="text-[13px] md:text-[15px]" />}
            </button>
          </div>
        </div>

        {/* title area (Before: the title you had, read-only) */}
        {isShowingBefore && (
          <p
            className='w-full font-medium text-[32px] md:text-[40px] text-stone-500 -mt-1 md:-mt-1.5 mb-2 md:mb-3 shrink-0 leading-tight tracking-tight truncate'
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          >
            {noteData.agentOriginalTitle ?? title}
          </p>
        )}
        <input
          type='text'
          className={`w-full bg-transparent outline-none font-medium text-[32px] md:text-[40px] text-[#333] placeholder-stone-400 -mt-1 md:-mt-1.5 mb-2 md:mb-3 caret-[#333] cursor-text shrink-0 h-[1.35em] leading-tight overflow-x-auto overflow-y-hidden tracking-tight ${isShowingBefore ? 'hidden' : ''}`}
          style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          placeholder='Untitled Note'
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
        />

        {/* tags and tag input at the top - single horizontal scrollable row with sticky pinned add button when overflowing */}
        <div className="relative flex items-center mb-4 md:mb-6 shrink-0 font-[family-name:Poppins,sans-serif]">
          <div
            ref={tagScrollContainerRef}
            onScroll={checkTagOverflow}
            className="flex items-center gap-1.5 md:gap-2 overflow-x-auto scrollbar-none py-1 -my-1 w-full"
          >
            {tags.map((tag, index) => {
              const isEditing = editingTagIndex === index;
              if (isEditing) {
                return (
                  <span
                    key={index}
                    onMouseDown={(e) => {
                      if (e.target.closest('button')) return;
                      if (e.target.tagName !== 'INPUT') {
                        e.preventDefault();
                      }
                    }}
                    className="inline-flex items-center px-2.5 py-0.5 bg-[#ebe0d3] border border-[#e0d2bf] shadow-xs text-stone-600 text-[13px] leading-[1.5] font-medium rounded-full shrink-0 whitespace-nowrap transition-all duration-150"
                  >
                    <span className="text-[#e85d56] font-semibold mr-px">#</span>
                    <input
                      type="text"
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      className="bg-transparent text-[13px] leading-[1.5] font-medium outline-none text-stone-700 caret-[#e85d56] cursor-text shrink-0 p-0 m-0"
                      size={Math.max(editingTagValue.length, 1)}
                      style={{ fieldSizing: 'content', minWidth: '1ch' }}
                      value={editingTagValue}
                      onChange={(e) => setEditingTagValue(e.target.value)}
                      onBlur={() => handleSaveEditedTag(index)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveEditedTag(index);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingTagIndex(null);
                          setEditingTagValue("");
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="overflow-hidden transition-all duration-150 ease-out flex items-center justify-center rounded-full hover:bg-black/5 w-3.5 opacity-70 ml-1 text-stone-400 hover:text-stone-700"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTagIndex(null);
                        setEditingTagValue("");
                        handleRemoveTag(tag);
                      }}
                      title="Remove tag"
                    >
                      <MdClose className="text-xs" />
                    </button>
                  </span>
                );
              }

              return (
                <span
                  key={index}
                  onClick={() => {
                    setEditingTagIndex(index);
                    setEditingTagValue(tag);
                  }}
                  className="inline-flex items-center px-2.5 py-0.5 bg-[#ebe0d3] border border-[#e0d2bf] shadow-xs text-stone-600 text-[13px] leading-[1.5] font-medium rounded-full cursor-pointer shrink-0 whitespace-nowrap group/removetag transition-all duration-150 hover:bg-[#e4d7c8]"
                  title="Click to edit tag"
                >
                  <span className="text-[#e85d56] font-semibold mr-px">#</span>{tag}
                  <button
                    type="button"
                    className="overflow-hidden transition-all duration-150 ease-out flex items-center justify-center rounded-full hover:bg-black/5 w-0 opacity-0 group-hover/removetag:w-3.5 group-hover/removetag:opacity-100 group-hover/removetag:ml-1 text-stone-400 hover:text-stone-700"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTag(tag);
                    }}
                    title="Remove tag"
                  >
                    <MdClose className="text-xs" />
                  </button>
                </span>
              );
            })}
            {/* inline tag input with explicit add button and onBlur trigger */}
            <div className="inline-flex items-center gap-1 px-1.5 md:px-2 py-1 bg-transparent shrink-0">
              <button
                type="button"
                onClick={handleAddTag}
                className="text-stone-500 hover:text-[#e85d56] cursor-pointer transition-colors p-0.5 rounded-full hover:bg-black/5 flex items-center justify-center shrink-0"
                title="Add tag"
              >
                <MdAdd className="text-sm md:text-base" />
              </button>
              <input
                ref={tagInputRef}
                type="text"
                placeholder="Add tag"
                className="bg-transparent text-[13px] font-medium outline-none w-20 md:w-28 placeholder-stone-500 text-stone-700 caret-[#e85d56] cursor-text shrink-0"
                value={tagInputValue}
                onChange={(e) => setTagInputValue(e.target.value)}
                onBlur={handleAddTag}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
            </div>
          </div>

          {/* Pinned Plus button on right when tag row overflows and input is scrolled out of view */}
          {showPinnedAddButton && (
            <div className="absolute right-0 top-0 bottom-0 flex items-center bg-gradient-to-l from-[#f4eadc] via-[#f4eadc]/95 to-transparent pl-6 pr-0.5 z-10 pointer-events-auto transition-opacity duration-200">
              <button
                type="button"
                onClick={handleScrollToTagInput}
                className="h-6 w-6 rounded-full bg-[#e85d56] text-white hover:bg-[#fb6d65] shadow-xs hover:shadow-md cursor-pointer transition-all duration-200 ease-out flex items-center justify-center border border-[#e85d56]/10 hover:scale-105 active:scale-95"
                title="Scroll to add tag"
              >
                <MdAdd className="text-sm" />
              </button>
            </div>
          )}
        </div>

        <div className='flex flex-col gap-2 flex-grow'>
          {error && (<p className='text-xs text-[#e85d56] mb-2 shrink-0'>{error}</p>)}

          {isChecklist ? (
            <div className="flex-grow">

              {checklist.length === 0 && (
                <button className='w-full text-sm bg-black/5 text-[#333] p-3 rounded-xl cursor-pointer hover:bg-black/10 transition-all ease-in-out text-left' onClick={addChecklistItem}>
                  <MdAdd className="inline-block text-lg align-text-bottom mr-1" /> Add your first item...
                </button>
              )}

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <SortableContext items={checklistItems} strategy={verticalListSortingStrategy}>
                  {checklist.map((item, index) => (
                    <SortableChecklistItem
                      key={item.id}
                      id={item.id}
                      item={item}
                      index={index}
                      toggleChecklistItem={toggleChecklistItem}
                      handleChecklistItemChange={handleChecklistItemChange}
                      removeChecklistItem={removeChecklistItem}
                    />
                  ))}
                </SortableContext>
                <DragOverlay>
                  {activeChecklistItem ? (
                    <div className="flex items-center gap-3 bg-[#f8f1e6] border border-[#e8dcc8] p-2 rounded-lg shadow-xl opacity-100 origin-center w-full">
                      <button className="text-stone-300">
                        <MdOutlineDragIndicator className="text-xl" />
                      </button>
                      <button className='text-stone-500 text-xl'>
                        {activeChecklistItem.completed ? <MdCheckBox className="text-[#e85d56]" /> : <MdCheckBoxOutlineBlank />}
                      </button>
                      <input
                        type="text"
                        value={activeChecklistItem.text}
                        readOnly
                        className={`text-base bg-transparent outline-none w-full border-b border-transparent py-1 ${activeChecklistItem.completed ? 'line-through text-stone-400' : 'text-[#333]'}`}
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>

              {checklist.length > 0 && (
                <button className='text-sm text-stone-500 p-2 mt-2 cursor-pointer hover:text-[#333] transition-colors ease-in-out text-left' onClick={addChecklistItem}>
                  <MdAdd className="inline-block text-lg align-text-bottom" /> Add another item
                </button>
              )}
            </div>
          ) : (
            /* ── CodeMirror live-preview markdown editor ── */
             <div 
               className={`flex-grow min-w-0 overflow-x-hidden text-[15px] leading-[1.55] md:text-[16px] md:leading-[1.75] cursor-text ${isShowingBefore || isShowingChanges ? 'hidden' : ''}`}
               onClick={(e) => {
                 if (e.target === e.currentTarget && cmViewRef.current) {
                   const view = cmViewRef.current;
                   view.focus();
                   view.dispatch({
                     selection: { anchor: view.state.doc.length },
                   });
                   // On phones the text area only asks for the keyboard on a tap that places the
                   // cursor (MarkdownEditor); a tap below the text does that too
                   if (e.nativeEvent.pointerType === 'touch') navigator.virtualKeyboard?.show();
                 }
               }}
               onPaste={(event) => {
                 const pastedText = event.clipboardData?.getData('text') || '';
                 const urls = pastedText.match(/(https?:\/\/[^\s]+)/g) || [];
                 const cleanUrls = urls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
                 cleanUrls.forEach(url => fetchPreview(url));
               }}
             >
              <Suspense fallback={<TextAreaPlaceholder text={content} />}>
                <LiveMarkdownEditor
                  noteId={currentNoteId}
                  value={content}
                  onChange={handleContentChange}
                  viewRef={cmViewRef}
                  autoFocus={isActive && !isChecklist && !isMobileOrTouchScreen}
                  keepOnClose={canWriteBackOnClose}
                  keyboardOverlap={keyboardOverlap}
                />
              </Suspense>
            </div>
          )}

          {/* Before: your original, read-only, in the editor's own look (the live editor above is
              only hidden, so switching back keeps your place) */}
          {isShowingBefore && (
            <div className="flex-grow text-[15px] leading-[1.55] md:text-[16px] md:leading-[1.75] opacity-70 select-text">
              <Suspense fallback={<TextAreaPlaceholder text={agentOriginalContent} />}>
                <ReadOnlyMarkdown value={agentOriginalContent} />
              </Suspense>
            </div>
          )}

          {/* Changes: a git-style diff of your original against the text as it is now */}
          {isShowingChanges && (
            <Suspense fallback={null}>
              <AgentDiffView
                before={agentOriginalContent}
                after={content}
                titleBefore={noteData.agentOriginalTitle}
                titleAfter={title}
              />
            </Suspense>
          )}

          {/* Link Previews list */}
          {linkPreviews.length > 0 && (
            <div className={`flex flex-col gap-3 mt-3 border-t border-black/5 pt-2.5 shrink-0 font-sans ${isLinkPreviewsOpen ? 'pb-3' : 'pb-1'}`}>
              <button
                type="button"
                onClick={toggleLinkPreviews}
                aria-expanded={isLinkPreviewsOpen}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#ebe0d3] hover:bg-[#e4d7c8] border border-[#e0d2bf] shadow-xs text-stone-600 hover:text-stone-800 text-xs font-medium rounded-full cursor-pointer select-none self-start transition-colors"
                title={isLinkPreviewsOpen ? "Collapse link previews" : "Expand link previews"}
              >
                <MdOutlineLink size={15} className="text-stone-500 shrink-0" />
                <span>Link Previews</span>
                <MdKeyboardArrowDown
                  size={14}
                  className={`text-stone-500 shrink-0 ${isLinkPreviewsOpen ? 'rotate-0' : '-rotate-90'}`}
                />
              </button>
              {isLinkPreviewsOpen && (
                <div
                  ref={(node) => {
                    if (node && userExpandedLinkPreviewsRef.current) {
                      userExpandedLinkPreviewsRef.current = false;
                      const container = scrollAreaRef.current;
                      if (container) {
                        const containerRect = container.getBoundingClientRect();
                        const nodeRect = node.getBoundingClientRect();
                        const distanceBelow = nodeRect.bottom - containerRect.bottom;
                        if (distanceBelow > 0) {
                          container.scrollTop += distanceBelow + 4;
                        }
                      }
                    }
                  }}
                  className="flex gap-2.5 overflow-x-auto pb-1.5 previews-scrollbar py-0.5"
                >
                  {linkPreviews.map((preview, idx) => (
                    <a 
                      key={idx} 
                      href={preview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group/preview relative bg-[#ebe0d3]/60 hover:bg-[#e4d7c8]/80 border border-[#e0d2bf] rounded-xl p-3 flex gap-3 items-center w-[250px] sm:w-[280px] shrink-0 min-w-0 cursor-pointer transition-colors"
                    >
                      {preview.image && (
                        <img 
                          src={preview.image} 
                          alt={preview.title} 
                          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                        />
                      )}
                      <div className="flex-grow min-w-0 pr-7">
                        <h5 className="text-xs md:text-sm font-semibold text-[#333] truncate leading-snug">{preview.title || preview.url}</h5>
                        <span className="text-[10px] md:text-xs text-stone-500 font-medium truncate block mt-0.5 uppercase tracking-wide">{preview.siteName}</span>
                      </div>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRemoveLinkPreview(preview.url);
                        }}
                        className="absolute top-2 right-2 p-1 rounded-full text-stone-400 hover:text-[#e85d56] hover:bg-black/5 transition-colors cursor-pointer"
                        title="Remove preview"
                      >
                        <MdClose size={13} />
                      </button>
                      {isSimplePreview(preview) && (
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRefreshPreview(preview.url);
                          }}
                          disabled={refreshingUrls.has(preview.url)}
                          className="absolute bottom-2 right-2 p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-black/5 transition-colors cursor-pointer disabled:opacity-50"
                          title="Refresh preview"
                        >
                          <MdRefresh size={13} className={refreshingUrls.has(preview.url) ? "animate-spin text-stone-600" : ""} />
                        </button>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Room to scroll the end of the note above the on-screen keyboard (0 when it's closed) */}
        {keyboardOverlap > 0 && <div aria-hidden="true" className="shrink-0" style={{ height: keyboardOverlap }} />}
      </div>

      {/* slim line separator */}
      <div className="px-5 md:px-7 shrink-0">
        <div className="h-[1px] w-full bg-black/5" />
      </div>

      {/* Toolbar. In full screen the dock shrinks to a dot centred in it (TabDock), so the toolbar
          becomes three columns — tools | free slot for the dot | actions — with equal side columns,
          keeping the slot exactly at the centre. */}
      <div
        className={`editor-column [--column-pad:1rem] md:[--column-pad:1.25rem] bg-[#eaddce] items-center gap-1 md:gap-2 shrink-0 ${
          isEditorFullscreen ? 'grid grid-cols-[1fr_auto_1fr]' : 'flex justify-between'
        }`}
        style={{ height: toolbarHeight }}
      >

        {/* tools */}
        <div className="flex items-center gap-1 justify-self-start">


          <button
            onClick={() => setIsChecklist(!isChecklist)}
            className={`flex items-center justify-center gap-1.5 p-2 md:px-2.5 md:py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${isChecklist ? 'bg-white shadow-sm text-[#333]' : 'text-stone-500 hover:text-[#333] hover:bg-black/5'}`}
            title="Checklist"
          >
            <MdNotes className="text-xl md:text-base" />
            <span className="hidden md:inline">Checklist</span>
          </button>

          <button
            onClick={handleSummarize}
            disabled={isSummarizing || isChecklist || !content.trim()}
            className={`flex items-center justify-center gap-1.5 p-2 md:px-2.5 md:py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${isSummarizing ? 'opacity-50 animate-pulse text-[#e85d56]' : isChecklist || !content.trim() ? 'opacity-40 cursor-not-allowed text-stone-500' : 'text-stone-500 hover:text-[#e85d56] hover:bg-orange-50'}`}
            title="Summarize"
          >
            <FaWandMagicSparkles className="text-lg md:text-xs" />
            <span className="hidden md:inline">{isSummarizing ? "Summarizing..." : "Summarize"}</span>
          </button>

          <button
            onClick={onToggleMockPanel}
            className="flex items-center justify-center gap-1.5 p-2 md:px-2.5 md:py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-stone-500 hover:text-[#333] hover:bg-black/5"
            title="Toggle Panel"
          >
            <MdViewSidebar className="text-xl md:text-base" />
            <span className="hidden md:inline">Panel</span>
          </button>

        </div>

        {isEditorFullscreen && (
          <div aria-hidden style={{ width: dotSlotWidth }} />
        )}

        {/* actions */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0 justify-self-end">

          {!isChecklist && (
            <span className="hidden md:inline text-[11px] text-stone-400 font-medium whitespace-nowrap">
              {wordCount}w &middot; {charCount}ch
            </span>
          )}

          <button
            onClick={onClose}
            className="px-2 md:px-3 py-2.5 rounded-lg text-xs text-stone-500 font-medium hover:text-[#e85d56] cursor-pointer hover:bg-[#e85d56]/10 transition-colors whitespace-nowrap"
          >
            Discard
          </button>
          <button
            onClick={handleAddNote}
            className="px-3 md:px-4 py-2 md:py-2.5 rounded-lg text-xs font-medium text-white cursor-pointer bg-[#e85d56] hover:bg-[#fb6d65] hover:shadow-md transition-all flex items-center gap-1.5 whitespace-nowrap"
          >
            <span className="md:hidden">Save</span>
            <span className="hidden md:inline">{type === "edit" ? "Save Changes" : "Save Note"}</span>
          </button>
        </div>

      </div>
      <MoveToPicker
        isOpen={showMovePicker}
        onClose={() => setShowMovePicker(false)}
        currentFolderId={folderId}
        onMove={(targetFolderId) => setFolderId(targetFolderId)}
      />
    </div>

  )
}

export default memo(AddEditNotes);
