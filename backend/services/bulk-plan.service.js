// A review list that holds several changes (move / tag / archive / trash),
// combined per note: each note appears once, with one item per change that
// affects it. Every change is worked out against the note's state BEFORE any
// of them ("all at the same time"), so the order of changes never matters;
// changes that contradict each other on a note are flagged as clashes, never
// resolved by guessing. Pure functions — agent-bulk.controller does the I/O.
//
// A plan is { changes: [{ key, action, params, instruction, topic, keywords }],
// items: Map(noteId → [{ change, verdict, reason, pending }]), groups } with
// notes in display order (Map insertion order). `groups` (from grouping:
// [{ name, tag, noteIds, changes: [moveKey, tagKey] }]) lets the list show
// those changes per group instead of per note.

const MAX_LIST = 50;
const MAX_PARTS = 40;

const cloneItems = (items) => new Map([...items].map(([noteId, list]) => [noteId, list.map((i) => ({ ...i }))]));

// ── Reading stored lists / selections as plans ──
const legacyChange = (doc) => ({
    key: "c1",
    action: doc.action,
    params: doc.params || {},
    instruction: doc.instruction || "",
    topic: doc.topic || "",
    keywords: doc.keywords || [],
});

const cloneGroups = (groups) => (Array.isArray(groups) ? groups.map((g) => ({ ...g, noteIds: [...g.noteIds], changes: [...g.changes] })) : []);

const planFromProposal = (stored) => {
    // A loaded document's subdocuments don't copy with spread: use plain data.
    const doc = typeof stored.toObject === "function" ? stored.toObject() : stored;
    if (Array.isArray(doc.changes) && doc.changes.length > 0) {
        return {
            changes: doc.changes.map((c) => ({ ...c })),
            items: new Map(doc.candidates.map((c) => [c.noteId, (c.items || []).map((i) => ({
                change: i.change, verdict: i.verdict, reason: i.reason || "", pending: Boolean(i.pending),
            }))])),
            groups: cloneGroups(doc.groups),
        };
    }
    return {
        changes: [legacyChange(doc)],
        items: new Map(doc.candidates.map((c) => [c.noteId, [{ change: "c1", verdict: c.verdict, reason: c.reason || "", pending: false }]])),
    };
};

const planFromSelection = (doc) => {
    if (Array.isArray(doc.changes) && doc.changes.length > 0) {
        const stored = doc.noteItems || {};
        const items = new Map();
        for (const part of doc.parts) {
            for (const noteId of part.noteIds) items.set(noteId, (stored[noteId] || []).map((i) => ({ ...i })));
        }
        return { changes: doc.changes.map((c) => ({ ...c })), items, groups: cloneGroups(doc.groups) };
    }
    // Before several changes per list: one action, every note "likely" with
    // the filter reason, or judged on opening when there's a topic.
    const items = new Map();
    for (const part of doc.parts) {
        for (const noteId of part.noteIds) {
            items.set(noteId, [{ change: "c1", verdict: "likely", reason: doc.filterReason || "", pending: Boolean(doc.topic) }]);
        }
    }
    return { changes: [legacyChange(doc)], items, groups: [] };
};

// Only these notes (a split choice's part).
const restrictPlan = (plan, noteIds) => {
    const items = new Map();
    for (const noteId of noteIds) if (plan.items.has(noteId)) items.set(noteId, plan.items.get(noteId));
    const used = new Set([...items.values()].flat().map((i) => i.change));
    const keep = new Set(noteIds);
    const groups = (plan.groups || [])
        .map((g) => ({ ...g, noteIds: g.noteIds.filter((id) => keep.has(id)), changes: g.changes.filter((k) => used.has(k)) }))
        .filter((g) => g.noteIds.length > 0 && g.changes.length > 0);
    return { changes: plan.changes.filter((c) => used.has(c.key)), items, groups };
};

// ── Merging (several changes in one reply, or a newer list absorbing older
// open ones). Identical changes (same action + params) become one. ──
const sameChange = (a, b) => a.action === b.action && JSON.stringify(normalizedParams(a)) === JSON.stringify(normalizedParams(b));
const normalizedParams = (c) => {
    const p = c.params || {};
    if (c.action === "tag") return { add: [...(p.add || [])].sort(), remove: [...(p.remove || [])].sort() };
    if (c.action === "move") return p.newFolderName ? { newFolderName: p.newFolderName } : { targetFolderId: p.targetFolderId || null };
    if (c.action === "archive") return { archived: p.archived };
    return {};
};

const mergePlans = (plans) => {
    const changes = [];
    const items = new Map();
    const groups = [];
    for (const plan of plans) {
        const keyMap = new Map();
        for (const change of plan.changes) {
            const existing = changes.find((c) => sameChange(c, change));
            if (existing) {
                keyMap.set(change.key, existing.key);
            } else {
                const key = `c${changes.length + 1}`;
                changes.push({ ...change, key });
                keyMap.set(change.key, key);
            }
        }
        for (const [noteId, list] of plan.items) {
            const merged = items.get(noteId) || [];
            for (const item of list) {
                const key = keyMap.get(item.change);
                if (key && !merged.some((m) => m.change === key)) merged.push({ ...item, change: key });
            }
            items.set(noteId, merged);
        }
        for (const g of plan.groups || []) groups.push({ ...g, noteIds: [...g.noteIds], changes: g.changes.map((k) => keyMap.get(k)).filter(Boolean) });
    }
    return { changes, items, groups };
};

// ── What a change does to one note ──
const moveTarget = (params) => (params.newFolderName ? `new:${params.newFolderName}` : params.targetFolderId ? `id:${params.targetFolderId}` : "none");

// The change's effect on a note in `state`, or null when it would change
// nothing ("already like that").
const effectOf = (change, state) => {
    const p = change.params || {};
    if (change.action === "tag") {
        const remove = (p.remove || []).filter((t) => state.tags.includes(t));
        const add = (p.add || []).filter((t) => !state.tags.includes(t));
        if (remove.length === 0 && add.length === 0) return null;
        return { action: "tag", remove, add, wantAbsent: p.remove || [], wantPresent: p.add || [] };
    }
    if (change.action === "move") {
        if (!p.newFolderName && (state.folderId || null) === (p.targetFolderId || null)) return null;
        return { action: "move", target: moveTarget(p) };
    }
    if (change.action === "archive") {
        if (Boolean(state.isArchived) === Boolean(p.archived)) return null;
        return { action: "archive", archived: Boolean(p.archived) };
    }
    if (change.action === "trash") return state.isDeleted ? null : { action: "trash" };
    return null;
};

const clash = (a, b) => {
    if (a.action === "trash" || b.action === "trash") return true;
    if (a.action !== b.action) return false;
    if (a.action === "move") return a.target !== b.target;
    if (a.action === "archive") return a.archived !== b.archived;
    // Tags: one change wants a tag on the note, the other wants it off.
    return a.wantPresent.some((t) => b.wantAbsent.includes(t)) || b.wantPresent.some((t) => a.wantAbsent.includes(t));
};

const tagList = (tags, sign) => tags.map((t) => `${sign}#${t}`);

// The row text for one change on one note.
const itemLabel = (change, effect) => {
    const p = change.params || {};
    if (change.action === "tag") {
        if (effect.remove.length === 1 && (p.add || []).length === 1 && (p.remove || []).length === 1) {
            return `#${effect.remove[0]} → #${p.add[0]}`;
        }
        return [...tagList(effect.remove, "−"), ...tagList(effect.add, "+")].join(" ");
    }
    if (change.action === "move") {
        if (p.newFolderName) return `Move to new folder “${p.newFolderName}”`;
        return p.targetFolderId ? `Move to “${p.targetFolderName || "that folder"}”` : "Move out of folders";
    }
    if (change.action === "archive") return effect.archived ? "Archive" : "Unarchive";
    return "Send to trash";
};

// A change in a few words (list headings, the activity log, the agent's
// tool result).
const changeTitle = (change) => {
    const p = change.params || {};
    if (change.action === "tag") {
        if ((p.add || []).length === 1 && (p.remove || []).length === 1) return `#${p.remove[0]} → #${p.add[0]}`;
        return `Tags ${[...tagList(p.add || [], "+"), ...tagList(p.remove || [], "−")].join(" ")}`;
    }
    if (change.action === "move") {
        if (p.newFolderName) return `Move to new folder “${p.newFolderName}”`;
        return p.targetFolderId ? `Move to “${p.targetFolderName || "that folder"}”` : "Move out of folders";
    }
    if (change.action === "archive") return p.archived === false ? "Unarchive" : "Archive";
    return "Send to trash (recoverable)";
};

// The plan as review-list rows for the notes' current states. Notes gone or
// trashed are left out; items that would change nothing are dropped (and a
// note with none left counts as "already like that"). Each item knows which
// other items on its note it clashes with.
const buildCandidates = (plan, notesById, stateOf) => {
    const changes = new Map(plan.changes.map((c) => [c.key, c]));
    const candidates = [];
    let alreadyCount = 0;
    let goneCount = 0;
    for (const [noteId, list] of plan.items) {
        const note = notesById.get(noteId);
        if (!note || note.isDeleted) {
            goneCount += 1;
            continue;
        }
        const state = stateOf(note);
        const rows = [];
        for (const item of list) {
            const change = changes.get(item.change);
            const effect = change && effectOf(change, state);
            if (effect) rows.push({ item, change, effect });
        }
        if (rows.length === 0) {
            alreadyCount += 1;
            continue;
        }
        candidates.push({
            noteId,
            title: note.title || "",
            snapshot: state,
            items: rows.map((row) => ({
                change: row.item.change,
                verdict: row.item.verdict || "likely",
                reason: row.item.reason || "",
                pending: Boolean(row.item.pending),
                label: itemLabel(row.change, row.effect),
                clashesWith: rows.filter((other) => other !== row && clash(row.effect, other.effect)).map((other) => other.item.change),
            })),
        });
    }
    return { candidates, alreadyCount, goneCount };
};

// Applies the chosen changes to a loaded note document, all worked out from
// its state before any of them: move, then tags, then archive / trash.
// `moveTo(params)` resolves a move's target folder ID (creating a new folder
// when needed); `archive(note, archived)` and `trash(note)` use the shared
// note rules.
const applyChanges = async (note, chosen, state, { moveTo, archive, trash }) => {
    const effects = chosen.map((change) => ({ change, effect: effectOf(change, state) })).filter((e) => e.effect);
    const move = effects.find((e) => e.effect.action === "move");
    if (move) await moveTo(note, move.change.params);
    const tagEffects = effects.filter((e) => e.effect.action === "tag");
    if (tagEffects.length > 0) {
        const remove = new Set(tagEffects.flatMap((e) => e.effect.remove));
        const tags = state.tags.filter((t) => !remove.has(t));
        for (const e of tagEffects) for (const t of e.effect.add) if (!tags.includes(t)) tags.push(t);
        note.tags = tags;
    }
    const arch = effects.find((e) => e.effect.action === "archive");
    if (arch) await archive(note, arch.effect.archived);
    if (effects.some((e) => e.effect.action === "trash")) trash(note);
    return effects.map((e) => e.change.key);
};

// ── Split choices (more than 50 notes): folder → tag → year → relevance (the
// plan's order); a part still over 50 is split again by the next way. ──
const byFolder = (notes) => {
    const groups = new Map();
    for (const n of notes) {
        const key = n.folder || "No folder";
        groups.set(key, [...(groups.get(key) || []), n]);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
};

const byTag = (notes) => {
    let remaining = [...notes];
    const groups = [];
    while (remaining.length > 0) {
        const counts = new Map();
        for (const n of remaining) for (const t of new Set(n.tags || [])) counts.set(t, (counts.get(t) || 0) + 1);
        if (counts.size === 0) {
            groups.push(["No tag", remaining]);
            break;
        }
        const [tag] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
        groups.push([`#${tag}`, remaining.filter((n) => (n.tags || []).includes(tag))]);
        remaining = remaining.filter((n) => !(n.tags || []).includes(tag));
    }
    return groups;
};

const byYear = (notes) => {
    const groups = new Map();
    for (const n of notes) {
        const year = n.lastEdited ? new Date(n.lastEdited).getFullYear() : null;
        const key = year ? `Edited ${year}` : "Unknown year";
        groups.set(key, [...(groups.get(key) || []), n]);
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
};

const byOrder = (notes) => {
    const chunks = [];
    for (let i = 0; i < notes.length; i += MAX_LIST) chunks.push(notes.slice(i, i + MAX_LIST));
    return chunks.map((chunk, i) => [
        i === 0 ? `First ${chunk.length}` : i === chunks.length - 1 ? `Remaining ${chunk.length}` : `Next ${chunk.length}`,
        chunk,
    ]);
};

const SPLITTERS = [byFolder, byTag, byYear, byOrder];

// notes: [{ noteId, folder, tags, lastEdited }] in plan order.
const splitParts = (notes) => {
    const split = (group, level, prefix) => {
        if (group.length <= MAX_LIST) return [[prefix, group]];
        for (let lvl = level; lvl < SPLITTERS.length; lvl += 1) {
            const groups = SPLITTERS[lvl](group);
            if (groups.length > 1 || lvl === SPLITTERS.length - 1) {
                return groups.flatMap(([label, members]) => split(members, lvl + 1, prefix ? `${prefix} · ${label}` : label));
            }
        }
        return [[prefix, group]];
    };
    let parts = split(notes, 0, "");
    if (parts.length > MAX_PARTS) parts = byOrder(notes);
    return parts.map(([label, members]) => ({ label: label || "All matches", noteIds: members.map((n) => n.noteId) }));
};

// Grouping lists over 50 notes: whole groups packed into parts of ≤ 50
// (a group over 50 can't be offered and is reported by the caller).
const groupParts = (groups) => {
    const parts = [];
    let current = null;
    for (const g of groups) {
        if (g.noteIds.length > MAX_LIST) continue;
        if (!current || current.noteIds.length + g.noteIds.length > MAX_LIST) {
            current = { label: g.name, noteIds: [] };
            parts.push(current);
        } else {
            current.label = `${current.label} · ${g.name}`;
        }
        current.noteIds.push(...g.noteIds);
    }
    return parts.slice(0, MAX_PARTS);
};

module.exports = {
    MAX_LIST, groupParts, planFromProposal, planFromSelection, restrictPlan, mergePlans, effectOf, clash, buildCandidates,
    applyChanges, changeTitle, itemLabel, splitParts, cloneItems,
};
