import { memo, useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { MdAdd, MdClose, MdCheckBoxOutlineBlank, MdCheckBox, MdNotes, MdOutlineDragIndicator, MdViewSidebar, MdOutlineFolder } from 'react-icons/md'
import { FaWandMagicSparkles, FaTag } from 'react-icons/fa6'
import axiosInstance from '../../utils/axiosInstance';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { quillTheme, quillMarkdownHighlight, hideMarkdownSyntax, lineWrap } from '../../utils/markdownEditor';
import MoveToPicker from '../../components/Cards/MoveToPicker';
import { useFoldersStore } from '../../store/useFoldersStore';


const EDITOR_EXTENSIONS = [
  markdown(),
  quillTheme,
  quillMarkdownHighlight,
  hideMarkdownSyntax,
  lineWrap,
];

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
    <div ref={setNodeRef} style={style} className="flex flex-col gap-1 relative w-full group">
      <div className={`flex items-center gap-3 mb-3 transition-colors ${isDragging ? '' : ''}`}>
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500 transition-colors">
          <MdOutlineDragIndicator className="text-xl" />
        </button>
        <button className='cursor-pointer text-stone-500 hover:text-[#e85d56] transition-colors text-xl' onClick={() => toggleChecklistItem(index)}>
          {item.completed ? <MdCheckBox className="text-[#e85d56]" /> : <MdCheckBoxOutlineBlank />}
        </button>
        <input
          type="text"
          value={item.text}
          onChange={(e) => handleChecklistItemChange(index, e.target.value)}
          className={`text-base bg-transparent outline-none w-full border-b border-transparent focus:border-black/10 transition-colors py-1 caret-[#e85d56] cursor-text ${item.completed ? 'line-through text-stone-400' : 'text-[#333]'}`}
          placeholder='Checklist item'
        />
        <button className='cursor-pointer text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-[#e85d56]' onClick={() => removeChecklistItem(index)}>
          <MdClose className="text-xl" />
        </button>
      </div>
    </div>
  );
};



const AddEditNotes = ({ type, noteData, onUpdateTabState, onClose, onSaveSuccess, showToastMessage, isActive, onToggleMockPanel, onSummaryReceived }) => {
  const { folders } = useFoldersStore();
  const [tags, setTags] = useState(noteData?.tags || []);
  const [content, setContent] = useState(noteData?.content || "");
  const [title, setTitle] = useState(noteData?.title || "");
  const [folderId, setFolderId] = useState(noteData?.folderId || null);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [error, setError] = useState("")
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isChecklist, setIsChecklist] = useState(noteData?.isChecklist || false);
  const [checklist, setChecklist] = useState(noteData?.checklist || []);
  const [tagInputValue, setTagInputValue] = useState("");
  const [activeChecklistId, setActiveChecklistId] = useState(null);

  // Ref to the CodeMirror editor view for programmatic focus
  const cmViewRef = useRef(null);

  const [linkPreviews, setLinkPreviews] = useState(noteData?.linkPreviews || []);
  const fetchingUrls = useRef(new Set());
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const fetchPreview = useCallback(async (url) => {
    fetchingUrls.current.add(url);
    try {
      const response = await axiosInstance.post("/notes/extract-preview", { url });
      if (response.data && response.data.preview) {
        setLinkPreviews(prev => {
          // Double check if the URL still exists in the latest content before adding it
          const currentUrls = contentRef.current.match(/(https?:\/\/[^\s]+)/g) || [];
          const currentCleanUrls = currentUrls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
          if (!currentCleanUrls.includes(url)) return prev;
          if (prev.some(p => p.url === url)) return prev;
          return [...prev, response.data.preview];
        });
      }
    } catch (err) {
      console.error("Failed to fetch link preview for", url, err);
      // Tier 3 Fallback: Scrape failed completely. Construct a local fallback.
      setLinkPreviews(prev => {
        const currentUrls = contentRef.current.match(/(https?:\/\/[^\s]+)/g) || [];
        const currentCleanUrls = currentUrls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
        if (!currentCleanUrls.includes(url)) return prev;
        if (prev.some(p => p.url === url)) return prev;
        
        let host = url;
        try {
          host = new URL(url).hostname;
        } catch {
          // ignore
        }
        const siteName = host.startsWith("www.") ? host.substring(4) : host;
        
        return [...prev, {
          url,
          title: url,
          description: "",
          image: "",
          siteName: siteName
        }];
      });
    } finally {
      fetchingUrls.current.delete(url);
    }
  }, []);

  const getFinalPreviewsBeforeSave = useCallback(async (currentContent, currentPreviews) => {
    if (isChecklist) return [];
    const urls = currentContent.match(/(https?:\/\/[^\s]+)/g) || [];
    const cleanUrls = urls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
    const uniqueUrls = [...new Set(cleanUrls)];

    const missingUrls = uniqueUrls.filter(url => 
      !currentPreviews.some(p => p.url === url) &&
      !fetchingUrls.current.has(url)
    );

    if (missingUrls.length === 0) return currentPreviews;

    const fetched = await Promise.all(
      missingUrls.map(async (url) => {
        try {
          const response = await axiosInstance.post("/notes/extract-preview", { url });
          return response.data?.preview || null;
        } catch {
          // Tier 3 Fallback on save: generate fallback object
          try {
            const host = new URL(url).hostname;
            const siteName = host.startsWith("www.") ? host.substring(4) : host;
            return {
              url,
              title: url,
              description: "",
              image: "",
              siteName: siteName
            };
          } catch {
            return {
              url,
              title: url,
              description: "",
              image: "",
              siteName: url
            };
          }
        }
      })
    );

    const validFetched = fetched.filter(Boolean);
    const updated = [...currentPreviews, ...validFetched];
    setLinkPreviews(updated); // Sync local state too
    return updated;
  }, [isChecklist]);

  useEffect(() => {
    if (isChecklist) {
      setLinkPreviews(prev => prev.length > 0 ? [] : prev);
      return;
    }
    const urls = content.match(/(https?:\/\/[^\s]+)/g) || [];
    const cleanUrls = urls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
    const uniqueUrls = [...new Set(cleanUrls)];

    // Sync linkPreviews state to only keep previews of URLs that actually still exist in content
    setLinkPreviews(prev => {
      const filtered = prev.filter(p => uniqueUrls.includes(p.url));
      if (filtered.length !== prev.length) {
        return filtered;
      }
      return prev;
    });
  }, [content, isChecklist]);

  const handleRemoveLinkPreview = useCallback((urlToRemove) => {
    setLinkPreviews(prev => prev.filter(p => p.url !== urlToRemove));
  }, []);


  // Ensure all checklist items have a unique ID for dnd-kit sorting
  useEffect(() => {
    if (checklist.length > 0 && !checklist[0].id) {
      setChecklist(prev => prev.map((item, i) => ({ ...item, id: `item-${Date.now()}-${i}` })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-focus the CodeMirror editor when this tab becomes the active tab
  useEffect(() => {
    if (isActive && !isChecklist && cmViewRef.current) {
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
    setTags(tags.filter((tag) => tag !== tagToRemove));
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
    setChecklist([...checklist, { id: `item-${Date.now()}`, text: '', completed: false }]);
  };

  const removeChecklistItem = (index) => {
    const newChecklist = [...checklist];
    newChecklist.splice(index, 1);
    setChecklist(newChecklist);
  };


  const editNote = useCallback(async () => {
    const noteId = noteData._id;
    try {
      // Fetch missing previews before compiling payload to ensure we save latest preview changes
      const finalPreviews = await getFinalPreviewsBeforeSave(content, linkPreviews);
      // eslint-disable-next-line no-unused-vars
      const cleanedChecklist = checklist.map(({ id, ...rest }) => rest);

      const payload = {
        title,
        content: isChecklist ? "" : content,
        tags,
        isChecklist,
        checklist: cleanedChecklist,
        folderId: folderId || null,
        linkPreviews: finalPreviews
      };
      
      // If a folder is assigned, explicitly keep it in the Home stream
      if (folderId) {
        payload.showInHome = true;
      }

      if (noteData.isDraft) {
        const response = await axiosInstance.post("/add-note", payload);
        if (response.data && response.data.note) {
          onSaveSuccess();
          showToastMessage("Note added successfully", "add");
        }
      } else {
        const response = await axiosInstance.put("/edit-note/" + noteId, payload);
        if (response.data && response.data.note) {
          onSaveSuccess();
          showToastMessage("Note updated successfully", "edit");
        }
      }
    }
    catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      }
    }
  }, [noteData, title, content, isChecklist, tags, checklist, folderId, onSaveSuccess, showToastMessage, linkPreviews, getFinalPreviewsBeforeSave]);

  const addNewNote = useCallback(async () => {
    try {
      const finalPreviews = await getFinalPreviewsBeforeSave(content, linkPreviews);
      // eslint-disable-next-line no-unused-vars
      const cleanedChecklist = checklist.map(({ id, ...rest }) => rest);
      
      const payload = {
        title,
        content,
        tags,
        isChecklist,
        checklist: cleanedChecklist,
        folderId: folderId || null,
        linkPreviews: finalPreviews
      };

      if (folderId) {
        payload.showInHome = true;
      }

      const response = await axiosInstance.post("/add-note", payload);
      if (response.data && response.data.note) {
        onSaveSuccess();
        showToastMessage("Note added successfully", "add");
      }
    }
    catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      }
    }
  }, [title, content, tags, isChecklist, checklist, folderId, onSaveSuccess, showToastMessage, linkPreviews, getFinalPreviewsBeforeSave]);

  const handleAddNote = useCallback(() => {
    if (!isChecklist && !content && !title) {
      setError("Please enter content")
      return;
    }
    if (isChecklist && checklist.length === 0 && !title) {
      setError("Please add at least one checklist item")
      return;
    }
    setError("");
    if (type === 'edit') {
      editNote();
    } else {
      addNewNote();
    }
  }, [isChecklist, content, title, checklist, type, editNote, addNewNote]);

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

  const activeChecklistItem = activeChecklistId ? checklist.find(i => i.id === activeChecklistId) : null;

  const checklistItems = useMemo(() => checklist.map(item => item.id), [checklist]);

  return (
    <div className='editor-wrapper flex flex-col h-full w-full bg-[#f4eadc] rounded-[24px] shadow-sm border border-[#e8dcc8] overflow-hidden relative'>

      {/* editor content area */}
      <div className='flex-grow flex flex-col pt-8 md:pt-10 px-5 md:px-14 pb-2 overflow-y-auto editor-scrollbar'>

        {/* metadata area */}
        <div className="text-[11px] md:text-[13px] font-medium tracking-widest md:tracking-[0.15em] text-stone-500 mb-2 md:mb-4 uppercase flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 md:gap-2">
            <span>{noteData?.createdAt ? new Date(noteData.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span className="text-[16px] leading-none mb-0.5">&middot;</span>
            <span>{type === 'edit' ? 'EDITED RECENTLY' : 'NEW NOTE'}</span>
          </div>
          {(() => {
            const folderObj = folderId ? folders.find(f => f._id === folderId) : null;
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMovePicker(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-[#ebe0d3] hover:bg-[#e4d7c8] text-stone-600 rounded-full transition-all duration-200 text-xs md:text-sm font-sans tracking-normal normal-case border border-[#e0d2bf] shadow-sm cursor-pointer"
                title="Change note folder"
              >
                {folderObj ? (
                  <>
                    <MdOutlineFolder style={{ color: folderObj.color }} size={16} />
                    <span className="text-[#333] font-medium truncate max-w-[120px]">{folderObj.name}</span>
                  </>
                ) : (
                  <>
                    <MdOutlineFolder className="text-stone-400" size={16} />
                    <span className="text-stone-500 font-normal">Add to Folder</span>
                  </>
                )}
              </button>
            );
          })()}
        </div>

        {/* title area */}
        <input
          type='text'
          className='w-full bg-transparent outline-none font-medium text-2xl md:text-4xl text-[#333] placeholder-stone-400 mb-2 md:mb-4 caret-[#333] cursor-text shrink-0 leading-tight'
          style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          placeholder='Untitled Note'
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
        />

        {/* tags and tag input at the top */}
        <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mb-3 md:mb-6 shrink-0 font-sans">
          {tags.map((tag, index) => (
            <span key={index} className="flex items-center px-2 md:px-2.5 py-0.5 bg-[#f2dfd2] text-[#d55343] text-[13px] md:text-[15px] font-normal tracking-wide rounded-full cursor-default group/removetag">
              <span className="mr-0 opacity-100">#</span>{tag}
              <MdClose
                className="ml-0 text-[#e85d56]/60 opacity-0 group-hover/removetag:opacity-100 cursor-pointer hover:text-[#e85d56] transition-colors"
                onClick={() => handleRemoveTag(tag)}
              />
            </span>
          ))}
          {/* inline tag input */}
          <div className="flex items-center gap-1 px-1.5 md:px-2 py-1 bg-transparent transition-all">
            <MdAdd className="text-stone-500 text-sm md:text-base" />
            <input
              type="text"
              placeholder="Add tag"
              className="bg-transparent text-[13px] md:text-[15px] font-normal tracking-wide outline-none w-20 md:w-24 placeholder-stone-500 text-stone-700 caret-[#e85d56] cursor-text"
              value={tagInputValue}
              onChange={(e) => setTagInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
          </div>
        </div>

        <div className='flex flex-col gap-2 flex-grow'>
          {error && (<p className='text-xs text-red-500 mb-2 shrink-0'>{error}</p>)}

          {isChecklist ? (
            <div className="flex-grow pr-2">

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
               className="flex-grow pr-2 text-[15px] leading-[1.55] md:text-[16px] md:leading-[1.75]"
               onPaste={(event) => {
                 const pastedText = event.clipboardData?.getData('text') || '';
                 const urls = pastedText.match(/(https?:\/\/[^\s]+)/g) || [];
                 const cleanUrls = urls.map(u => u.replace(/[.,#!$%^&*;:{}=_`~()-]+$/, ''));
                 cleanUrls.forEach(url => fetchPreview(url));
               }}
             >
              <CodeMirror
                value={content}
                onChange={(val) => {
                  setContent(val);
                  setError("");
                }}
                onCreateEditor={(view) => { cmViewRef.current = view; }}
                extensions={EDITOR_EXTENSIONS}
                placeholder="Start typing..."
                basicSetup={{
                  lineNumbers: false,
                  foldGutter: true,
                  dropCursor: true,
                  allowMultipleSelections: false,
                  indentOnInput: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: false,
                  highlightActiveLine: false,
                  highlightSelectionMatches: false,
                  searchKeymap: false,
                }}
              />
            </div>
          )}

          {/* Link Previews list */}
          {linkPreviews.length > 0 && (
            <div className="flex flex-col gap-2 mt-4 border-t border-black/5 pt-4 shrink-0 font-sans">
              <span className="text-[10px] md:text-xs font-semibold text-stone-400 tracking-wider uppercase">Link Previews ({linkPreviews.length})</span>
              <div className="flex gap-2.5 overflow-x-auto pb-2 previews-scrollbar py-0.5">
                {linkPreviews.map((preview, idx) => (
                  <div 
                    key={idx} 
                    className="group/preview relative bg-[#ebe0d3]/60 hover:bg-[#e4d7c8]/80 border border-[#e0d2bf] rounded-xl p-3 flex gap-3 items-center w-[250px] sm:w-[280px] shrink-0 min-w-0"
                  >
                    {preview.image && (
                      <img 
                        src={preview.image} 
                        alt={preview.title} 
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex-grow min-w-0 pr-4">
                      <h5 className="text-xs md:text-sm font-semibold text-[#333] truncate leading-snug">{preview.title || preview.url}</h5>
                      <span className="text-[10px] md:text-xs text-stone-500 font-medium truncate block mt-0.5 uppercase tracking-wide">{preview.siteName}</span>
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveLinkPreview(preview.url);
                      }}
                      className="absolute top-2 right-2 p-0.5 rounded-full text-stone-400 hover:text-[#e85d56] transition-colors cursor-pointer"
                      title="Remove preview"
                    >
                      <MdClose size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* slim line separator */}
      <div className="px-4 md:px-14 shrink-0">
        <div className="h-[1px] w-full bg-black/5" />
      </div>

      <div className="bg-[#eaddce] px-4 md:px-5 py-3 flex items-center justify-between gap-1 md:gap-2 shrink-0">

        {/* tools */}
        <div className="flex items-center gap-1">


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
            className={`flex items-center justify-center gap-1.5 p-2 md:px-2.5 md:py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${isSummarizing ? 'opacity-50 animate-pulse text-[#d97757]' : isChecklist || !content.trim() ? 'opacity-40 cursor-not-allowed text-stone-500' : 'text-stone-500 hover:text-[#d97757] hover:bg-orange-50'}`}
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

        {/* actions */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0">

          {!isChecklist && (
            <span className="hidden md:inline text-[11px] text-stone-400 font-medium whitespace-nowrap">
              {wordCount}w &middot; {charCount}ch
            </span>
          )}

          <button
            onClick={onClose}
            className="px-2 md:px-3 py-2.5 rounded-lg text-xs text-stone-500 font-medium hover:text-[#ef4444] cursor-pointer hover:bg-red-50 transition-colors whitespace-nowrap"
          >
            Discard
          </button>
          <button
            onClick={handleAddNote}
            className="px-3 md:px-4 py-2 md:py-2.5 rounded-lg text-xs font-medium text-white cursor-pointer bg-[#dd5e57] hover:bg-[#fb6d65] hover:shadow-md transition-all flex items-center gap-1.5 whitespace-nowrap"
          >
            <span className="md:hidden">Save</span>
            <span className="hidden md:inline">{type === "edit" ? "Save Changes" : "Save Note"}</span>
          </button>
        </div>

      </div>
      <MoveToPicker
        isOpen={showMovePicker}
        onClose={() => setShowMovePicker(false)}
        noteId={noteData._id}
        currentFolderId={folderId}
        onMove={(noteId, targetFolderId) => setFolderId(targetFolderId)}
      />
    </div>

  )
}

// Only re-render when the tab's data or active state actually changes.
// Inactive tabs whose noteData reference is the same (Zustand's immutable
// map preserves non-touched entries) are completely skipped.
export default memo(AddEditNotes, (prev, next) =>
  prev.noteData === next.noteData &&
  prev.isActive === next.isActive
);