import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import NoteCard from './NoteCard';
import EmptyCard from './EmptyCard';
import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext } from '@dnd-kit/sortable';
import { useReorderNotesMutation } from '../../hooks/useNoteMutations';
import { useMediaQuery } from '../../hooks/useMediaQuery';

// Dropping: the card in your hand slides to its place while it settles back to the hovered look
// (.is-settling in index.css); the card in the grid stays fully hidden meanwhile and appears without
// a fade once the slide ends, so the two look like one card. (It used to show at 40% under the
// landing card, then fade up from 30% after it had gone.)
const dropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
  sideEffects: ({ active, dragOverlay }) => {
    dragOverlay.node.classList.add('is-settling');
    const card = active.node.querySelector('.note-card');
    if (!card) return undefined;
    card.style.transition = 'none';
    card.style.opacity = '0';
    return () => {
      card.style.opacity = '';
      void card.offsetWidth;  // apply the opacity before its fade is switched back on
      card.style.transition = '';
    };
  },
};

// No sensors = nothing can be picked up (left out, dnd-kit would use its default ones)
const NO_SENSORS = [];

// The grid places every card itself (below), so dnd-kit's own "shift the others aside" is off:
// the two disagreed in a masonry grid, and cards changing column boxes were rebuilt on every
// drop (the blink)
const NO_SHIFT = () => null;
// …and its "which card is it over" too: the grid works out where the dragged card goes itself
const NO_COLLISIONS = () => [];

const GAP_PX = { phone: 8, desktop: 12 };
// Cards slide to new places: fast start, long gentle settle, no overshoot
const SLIDE = 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)';

const getCols = () => {
    if (typeof window === 'undefined') return 2;
    if (window.innerWidth >= 1280) return 4;
    if (window.innerWidth >= 1024) return 3;
    return 2;
};

// Masonry: notes go left to right into columns (index % cols keeps the reading order), each
// card stacked under the previous one in its column. Returns each note's { col, y } and the
// grid's height.
const layoutOf = (order, heights, cols, gap) => {
    const columnBottoms = new Array(cols).fill(0);
    const slots = new Map();
    order.forEach((note, i) => {
        const col = i % cols;
        slots.set(note._id, { col, y: columnBottoms[col] });
        columnBottoms[col] += (heights.get(note._id) || 0) + gap;
    });
    return { slots, height: Math.max(0, Math.max(...columnBottoms) - gap) };
};

// Before switching, a new place must be this much nearer than the current one, so a card held right
// between two places doesn't flick back and forth on a tiny shake
const SWITCH_MARGIN_PX = 12;

// While dragging: the position in `order` whose place for the dragged card is nearest to the card
// in hand (`center`, in the grid's coordinates). Each position's place is worked out from the other
// cards' order, which a drag never changes, so the answer depends only on where the card is held:
// moving it can't change the answer and set off another move. (Choosing by "which card is under the
// pointer" looped like that: moving the card shifts every card in between to the next column, a
// different card lands under the pointer, it moves again… the twitching. Requiring the pointer to
// be inside the place was too strict: a short card barely moved over tall ones.)
const dragTargetIndex = (order, activeId, center, heights, cols, gap, width) => {
    const rest = order.filter((n) => n._id !== activeId);
    const height = heights.get(activeId) || 0;
    const current = order.findIndex((n) => n._id === activeId);
    const distances = order.map((_, index) => {
        const col = index % cols;
        let top = 0;
        for (let i = col; i < index; i += cols) top += (heights.get(rest[i]._id) || 0) + gap;
        return Math.hypot(col * (width + gap) + width / 2 - center.x, top + height / 2 - center.y);
    });
    let best = current;
    distances.forEach((d, index) => { if (d < distances[best]) best = index; });
    return distances[current] - distances[best] > SWITCH_MARGIN_PX ? best : current;
};

const NotesGrid = ({
    notes,
    loading,
    emptyMessage,
    onEdit,
    onDelete,
    onArchive,
    onChecklistToggle,
    onRestore,
    onToggleHome,
    onPin,
    onMove,
    isTrash,
    // Which saved order a drag changes: { list: 'home' } | { list: 'folder', folderId } |
    // { list: 'archive' }; none (Trash) = cards can't be dragged
    orderList = null,
    hideFolderBadge = false,
}) => {
    const reorderNotesMutation = useReorderNotesMutation();

    const [activeId, setActiveId] = useState(null);
    const [cols, setCols] = useState(() => getCols());
    const gap = useMediaQuery('(min-width: 768px)') ? GAP_PX.desktop : GAP_PX.phone;
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    // The grid shows `notes` (the shared cached list). A drop updates that cache at once, but React
    // Query tells the page a moment later, so the dropped order is held here until the list it was
    // made from is replaced; it's ignored as soon as `notes` changes.
    const [dropped, setDropped] = useState(null);  // { base: notes, order }
    const items = useMemo(() => (dropped && dropped.base === notes ? dropped.order : (notes || [])), [dropped, notes]);

    // While dragging: the order the cards preview (the dragged card's faded place moves through it)
    const [preview, setPreview] = useState(null);
    const shown = preview || items;

    const sortableItems = useMemo(() => items.map(n => n._id), [items]);

    // Each card's measured height, by note ID: measured right after the cards render (before the
    // screen shows them) and again whenever one changes size (an image or link preview loading, a
    // narrower window). A height of 0 (the grid hidden behind the open editor) is ignored, so the
    // cards don't collapse and slide back out when it reappears.
    const [heights, setHeights] = useState(() => new Map());
    const cardNodes = useRef(new Map());
    const measure = useCallback(() => {
        setHeights((prev) => {
            let next = null;
            cardNodes.current.forEach((el, id) => {
                const h = el.offsetHeight;
                if (h > 0 && prev.get(id) !== h) {
                    next ??= new Map(prev);
                    next.set(id, h);
                }
            });
            return next || prev;
        });
    }, []);
    const [resizeObserver] = useState(() => new ResizeObserver(measure));
    useEffect(() => () => resizeObserver.disconnect(), [resizeObserver]);
    const registerCard = useCallback((el) => {
        if (!el) return undefined;
        const id = el.dataset.id;
        cardNodes.current.set(id, el);
        resizeObserver.observe(el);
        return () => {
            cardNodes.current.delete(id);
            resizeObserver.unobserve(el);
        };
    }, [resizeObserver]);
    useLayoutEffect(measure, [measure, items, cols, gap]);

    const layout = useMemo(() => layoutOf(shown, heights, cols, gap), [shown, heights, cols, gap]);

    // Cards slide only when the order or the set of notes changes (a drag, a note arriving or
    // leaving). When only the space changes (heights, column count: the sidebar opening, the window
    // resizing, first load) they follow it straight away: restarting every card's slide on every
    // frame of a resize was extra work, and the cards trailed behind.
    const orderKey = useMemo(() => shown.map((n) => n._id).join('|'), [shown]);
    const [lastOrderKey, setLastOrderKey] = useState(orderKey);
    const [slidingKey, setSlidingKey] = useState(null);
    if (orderKey !== lastOrderKey) {
        setLastOrderKey(orderKey);
        // Not when the notes first appear (nothing on screen to slide from): the cards' heights still
        // settle then (fonts loading), and they'd slide into place instead of just being there
        if (lastOrderKey) setSlidingKey(orderKey);
    }
    // Longer than SLIDE, so a slide is never cut off mid-way
    useEffect(() => {
        if (!slidingKey) return undefined;
        const timer = setTimeout(() => setSlidingKey(null), 400);
        return () => clearTimeout(timer);
    }, [slidingKey]);
    const isSliding = slidingKey === orderKey;

    // Cards already shown in their real place; only these slide. Until every card is measured, the
    // places are worked out with unknown heights as 0 (all in the top row), so a card appearing for
    // the first time (the notes loading, a note arriving) is put straight in its real place instead
    // of sliding there from the top. It's marked placed once every card's height is known.
    const [placedIds, setPlacedIds] = useState(() => new Set());
    useLayoutEffect(() => {
        if (!shown.every((n) => heights.has(n._id))) return;
        if (shown.every((n) => placedIds.has(n._id))) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPlacedIds(new Set([...placedIds, ...shown.map((n) => n._id)]));
    }, [shown, heights, placedIds]);

    // Re-compute on window resize
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCols(getCols());
        const onResize = () => setCols(getCols());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
    );

    // The pointer's screen position while dragging (mouse or finger), read before dnd-kit handles
    // the same move. dnd-kit's own `delta` also counts page scrolling, which the grid's on-screen
    // box already reflects, so it would count twice.
    const containerRef = useRef(null);
    const pointer = useRef(null);
    const grabOffset = useRef({ x: 0, y: 0 });
    useEffect(() => {
        if (!activeId) return undefined;
        const track = (e) => {
            const p = e.touches?.[0] || e;
            pointer.current = { x: p.clientX, y: p.clientY };
        };
        window.addEventListener('pointermove', track, { capture: true, passive: true });
        window.addEventListener('touchmove', track, { capture: true, passive: true });
        return () => {
            window.removeEventListener('pointermove', track, { capture: true });
            window.removeEventListener('touchmove', track, { capture: true });
        };
    }, [activeId]);

    if (loading && items.length === 0) return null;

    if (items.length === 0) {
        return (
            <div className={`flex items-center justify-center ${isTrash ? 'mt-20' : ''} w-full`}>
                <EmptyCard message={emptyMessage} />
            </div>
        );
    }

    const handleDragStart = ({ active, activatorEvent }) => {
        setActiveId(active.id);
        const p = activatorEvent?.touches?.[0] || activatorEvent;
        pointer.current = p ? { x: p.clientX, y: p.clientY } : null;
        // Where the pointer holds the card, from the card's centre, so the card's centre can be
        // followed wherever it was grabbed
        const rect = active.rect.current.initial;
        grabOffset.current = p && rect
            ? { x: rect.left + rect.width / 2 - p.clientX, y: rect.top + rect.height / 2 - p.clientY }
            : { x: 0, y: 0 };
    };

    // The dragged card's place follows the card in hand (see dragTargetIndex); the others slide to make room
    const handleDragMove = ({ active }) => {
        const box = containerRef.current?.getBoundingClientRect();
        if (!box || !pointer.current) return;
        const point = {
            x: pointer.current.x + grabOffset.current.x - box.left,
            y: pointer.current.y + grabOffset.current.y - box.top,
        };
        const width = (box.width - gap * (cols - 1)) / cols;
        setPreview((prev) => {
            const order = prev || items;
            const from = order.findIndex((n) => n._id === active.id);
            if (from === -1) return prev;
            const to = dragTargetIndex(order, active.id, point, heights, cols, gap, width);
            return to === from ? prev : arrayMove(order, from, to);
        });
    };

    // Everything is already in place: save the previewed order
    const handleDragEnd = () => {
        setActiveId(null);
        setPreview(null);
        if (!orderList || !preview || preview.every((n, i) => n._id === items[i]?._id)) return;
        setDropped({ base: notes, order: preview });
        reorderNotesMutation.mutate({ ...orderList, ids: preview.map((n) => n._id) });
    };

    // Escape (or a lost pointer): the cards slide back
    const handleDragCancel = () => {
        setActiveId(null);
        setPreview(null);
    };

    const activeNote = items.find(n => n._id === activeId) ?? null;
    const cardWidth = `calc((100% - ${(cols - 1) * gap}px) / ${cols})`;

    return (
        <DndContext
            sensors={orderList ? sensors : NO_SENSORS}
            collisionDetection={NO_COLLISIONS}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <SortableContext items={sortableItems} strategy={NO_SHIFT}>
                {/* One box for every card, in note order (so Tab and screen readers follow it); each
                    card is moved to its place with a transform, never into another box */}
                <div className="sm:pr-10 w-full">
                    <div
                        ref={containerRef}
                        className={`relative w-full ${activeId ? 'is-dragging-active' : ''}`}
                        style={{ height: layout.height }}
                    >
                        {items.map((note, globalIndex) => {
                            const { col, y } = layout.slots.get(note._id);
                            return (
                                <div
                                    key={note._id}
                                    ref={registerCard}
                                    data-id={note._id}
                                    className="absolute top-0 left-0"
                                    style={{
                                        width: cardWidth,
                                        // 100% is the card's own width here: one column step = width + gap
                                        transform: `translate(calc(${col} * (100% + ${gap}px)), ${y}px)`,
                                        transition: isSliding && !reduceMotion && placedIds.has(note._id) ? SLIDE : 'none',
                                    }}
                                >
                                    <NoteCard
                                        index={globalIndex}
                                        id={note._id}
                                        title={note.title}
                                        content={note.content}
                                        tags={note.tags}
                                        folderId={note.folderId}
                                        isChecklist={note.isChecklist}
                                        checklist={note.checklist}
                                        isArchived={note.isArchived}
                                        showInHome={note.showInHome}
                                        isTrash={isTrash}
                                        onEdit={() => onEdit?.(note)}
                                        onDelete={() => onDelete?.(note)}
                                        onArchive={() => onArchive?.(note)}
                                        onToggleHome={() => (onToggleHome || onPin)?.(note)}
                                        onMove={(targetFolderId) => onMove?.(note._id, targetFolderId)}
                                        onChecklistToggle={(i) => onChecklistToggle?.(note, i)}
                                        onRestore={() => onRestore?.(note)}
                                        hideFolderBadge={hideFolderBadge}
                                        linkPreviews={note.linkPreviews}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </SortableContext>

            <DragOverlay dropAnimation={reduceMotion ? null : dropAnimation}>
                {activeNote && (
                    <NoteCard
                        id={activeNote._id}
                        title={activeNote.title}
                        content={activeNote.content}
                        tags={activeNote.tags}
                        folderId={activeNote.folderId}
                        isChecklist={activeNote.isChecklist}
                        checklist={activeNote.checklist}
                        isArchived={activeNote.isArchived}
                        isTrash={isTrash}
                        isOverlay={true}
                        hideFolderBadge={hideFolderBadge}
                        linkPreviews={activeNote.linkPreviews}
                    />
                )}
            </DragOverlay>
        </DndContext>
    );
};

export default NotesGrid;
