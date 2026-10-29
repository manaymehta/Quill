const crypto = require("node:crypto");
const Note = require("../models/note.model");
const { isFastApiConfigured, callFastApi } = require("./fastapi.service");

// What a note contributes to the search index, built in one place so the
// indexer (triggerEmbed) and the agent's search check (search-support) always
// agree. The fingerprint (textHash) lets search spot pieces that were indexed
// from an older version of the note (architecture plan §5.4): it is derived
// from the text itself, so moves, pins and reorders — which bump updatedAt
// without changing the text — don't change it.

const buildIndexText = (note) => {
    let text = note.content || "";
    // Items without text are skipped (signup's welcome checklist once stored
    // items with no text, which indexed as the word "undefined").
    const items = note.isChecklist && Array.isArray(note.checklist)
        ? note.checklist.filter((item) => item && typeof item.text === "string" && item.text.trim())
        : [];
    if (items.length > 0) {
        const checklistStr = items.map(item => `- [${item.completed ? "x" : " "}] ${item.text}`).join("\n");
        text = text ? `${text}\n\n${checklistStr}` : checklistStr;
    }

    if (Array.isArray(note.linkPreviews) && note.linkPreviews.length > 0) {
        const previewsStr = note.linkPreviews.map(p => `[Link Preview] ${p.title || ""} - ${p.description || ""}`).join("\n");
        text = text ? `${text}\n\n${previewsStr}` : previewsStr;
    }

    // A title-only note still has useful searchable content.
    if (!text.trim() && note.title && note.title.trim()) {
        text = note.title.trim();
    }

    // Tags go in front of every piece (with the title) so tagged notes match
    // by meaning too (architecture plan §5.5).
    const tags = Array.isArray(note.tags)
        ? [...new Set(note.tags.map((t) => String(t).trim()).filter(Boolean))]
        : [];

    return { title: note.title || "", tags, text };
};

const indexTextHash = ({ title, tags = [], text }) => crypto
    .createHash("sha256")
    .update(`${title}\n${tags.join(", ")}\n${text}`)
    .digest("hex")
    .slice(0, 16);

// Every note field indexing reads (buildIndexText, plus the embed call's archived flag and version):
// a query that loads notes to re-index them selects these, so none comes back missing
const INDEX_FIELDS = "_id title content tags isChecklist checklist linkPreviews isArchived updatedAt";


// ---- Keeping the search index in step with saved notes ----
// Each call below goes to FastAPI (embed or delete a note's pieces in Qdrant). The note is always
// saved before one starts, so an indexing failure never rolls back or hides a successful save.

// An 85-piece note took ~7 s to embed and store; FastAPI finishes anyway when this runs out, so a
// too-short wait only reports a false "Embedding failed"
const FASTAPI_EMBEDDING_TIMEOUT_MS = 20_000;
const embeddingLocks = new Map();

// A non-2xx reply counts as a failure, with its status in the logged message
const okJson = async (response) => {
    if (!response.ok) throw new Error(`FastAPI responded with status ${response.status}`);
    return response.json();
};

const getEmbeddingVersion = (note) => {
    const updatedAt = note.updatedAt instanceof Date
        ? note.updatedAt
        : new Date(note.updatedAt || Date.now());
    return Number.isNaN(updatedAt.getTime()) ? new Date().toISOString() : updatedAt.toISOString();
};

const runEmbeddingOperation = (noteId, operation) => {
    const previous = embeddingLocks.get(noteId) || Promise.resolve();
    const current = previous
        .catch(() => undefined)
        .then(operation);
    embeddingLocks.set(noteId, current);

    return current.finally(() => {
        if (embeddingLocks.get(noteId) === current) {
            embeddingLocks.delete(noteId);
        }
    });
};

// Records what the search index now holds for a note (Note.indexedKey; null = nothing known). The
// timestamps stay put: updatedAt dates the user's edits and versions the index.
const setIndexedKey = (noteId, indexedKey) => Note.updateOne({ _id: noteId }, { $set: { indexedKey } }, { timestamps: false })
    .catch((error) => console.error(`Recording the index state failed for ${noteId}:`, error.message));

const performDeleteEmbed = async (noteId) => {
    if (!isFastApiConfigured()) return { status: "skipped", reason: "not-configured" };

    try {
        const response = await callFastApi(`/delete-embedding/${noteId}`, { method: "DELETE", timeoutMs: FASTAPI_EMBEDDING_TIMEOUT_MS });
        const data = await okJson(response);
        if (data?.status !== "ok" || String(data.noteId) !== String(noteId)) {
            throw new Error("Invalid embedding deletion response");
        }
        await setIndexedKey(noteId, null);
        return { status: "ok" };
    } catch (error) {
        console.error(`Delete embedding failed for ${noteId}:`, error.message);
        return { status: "failed", message: "Embedding cleanup failed" };
    }
};

const deleteEmbed = (noteId) => {
    cancelScheduledIndexing(noteId);
    return runEmbeddingOperation(String(noteId), () => performDeleteEmbed(String(noteId)));
};

// Saving no longer waits for the agent's search index: the reply goes out once MongoDB has the
// note, and indexing runs after it (it used to take up to 10s per save, longer while the FastAPI
// service woke up). The app asks how it went through GET /note-index-status/:noteId, which waits
// for a run still going, so a failure can still be reported. Results are kept a few minutes for
// that question. A missed index also heals on its own: the agent's search re-indexes a note whose
// text no longer matches its index (agent-search.controller).
const INDEX_RESULT_KEEP_MS = 5 * 60 * 1000;
const pendingIndexing = new Map();   // noteId -> promise of the embedding result
const recentIndexing = new Map();    // noteId -> { result, at }

// Saves of one note this close together are indexed once, from the last of them: five quick ticks on
// a checklist cost one embedding run, not five. The status question waits through the delay too.
const INDEX_DEBOUNCE_MS = 2000;
const scheduledIndexing = new Map();   // noteId -> { note, userId, timer, start }

const indexInBackground = (note, userId) => {
    const noteId = String(note._id);
    const scheduled = scheduledIndexing.get(noteId);
    if (scheduled) {
        // Not started yet: run it later, from this newer save (its status promise stays the same)
        clearTimeout(scheduled.timer);
        Object.assign(scheduled, { note, userId, timer: setTimeout(scheduled.start, INDEX_DEBOUNCE_MS) });
        return;
    }
    let begin;
    const run = new Promise((resolve) => { begin = resolve; }).then((result) => {
        const now = Date.now();
        recentIndexing.set(noteId, { result, at: now });
        for (const [id, entry] of recentIndexing) {
            if (now - entry.at > INDEX_RESULT_KEEP_MS) recentIndexing.delete(id);
        }
        return result;
    }).finally(() => {
        if (pendingIndexing.get(noteId) === run) pendingIndexing.delete(noteId);
    });
    const entry = { note, userId };
    // Called by the timer (no result: index now) or by a cancel (with the result to report)
    entry.start = (result) => {
        scheduledIndexing.delete(noteId);
        begin(result ?? triggerEmbed(entry.note, entry.userId));
    };
    entry.timer = setTimeout(entry.start, INDEX_DEBOUNCE_MS);
    scheduledIndexing.set(noteId, entry);
    pendingIndexing.set(noteId, run);
};

// The note is being trashed or deleted: a run still waiting to start is dropped, so it can't put the
// note back into the index after its pieces are removed
const cancelScheduledIndexing = (noteId) => {
    const scheduled = scheduledIndexing.get(String(noteId));
    if (!scheduled) return;
    clearTimeout(scheduled.timer);
    scheduled.start({ status: "skipped", reason: "deleted" });
};

// The answer for GET /note-index-status: waits for a run still going; null when nothing was
// indexed for the note recently
const indexStatusOf = async (noteId) => {
    const pending = pendingIndexing.get(String(noteId));
    return pending ? pending : recentIndexing.get(String(noteId))?.result || null;
};

const runEmbeddingBatch = async (operations, batchSize = 4) => {
    let failures = 0;
    for (let index = 0; index < operations.length; index += batchSize) {
        const results = await Promise.allSettled(operations.slice(index, index + batchSize).map(operation => operation()));
        failures += results.filter(result => (
            result.status === "rejected"
            || ["failed", "partial"].includes(result.value?.status)
        )).length;
    }
    if (failures > 0) {
        console.error(`Embedding batch completed with ${failures} failed operation(s)`);
    }
    return failures;
};

// Skips the embedding call when the index already holds this text and archived flag (see
// Note.indexedKey); force re-embeds anyway (the agent's self-heal and the re-index script, which run
// exactly when the index and that record may disagree).
const triggerEmbed = (note, userId, { force = false } = {}) => runEmbeddingOperation(String(note._id), async () => {
    if (!isFastApiConfigured()) return { status: "skipped", reason: "not-configured" };

    // Content + checklist + link previews (title alone for a body-less note);
    // shared with the agent's search check so both compute the same hash.
    const indexText = buildIndexText(note);
    const embedText = indexText.text;

    // A note that became blank must not leave its old vectors searchable.
    if (!embedText.trim()) return performDeleteEmbed(String(note._id));

    const textHash = indexTextHash(indexText);
    const indexedKey = `${textHash}:${note.isArchived ? 1 : 0}`;
    if (!force) {
        const stored = await Note.findById(note._id).select("+indexedKey").lean();
        if (stored?.indexedKey === indexedKey) return { status: "skipped", reason: "unchanged" };
    }

    try {
        const response = await callFastApi("/embed-note", { method: "POST", timeoutMs: FASTAPI_EMBEDDING_TIMEOUT_MS, body: {
            noteId: String(note._id),
            userId: String(userId),
            title: note.title || "",
            text: embedText,
            tags: indexText.tags,
            textHash,
            embeddingVersion: getEmbeddingVersion(note),
            isArchived: Boolean(note.isArchived),
        } });

        const data = await okJson(response);
        const hasValidChunkCount = Number.isInteger(data?.chunks) && data.chunks >= 0;
        const hasValidStaleChunkCount = data?.status !== "partial"
            || (Number.isInteger(data?.staleChunks) && data.staleChunks > 0);
        if (!data || !["ok", "stale", "partial"].includes(data.status)
            || String(data.noteId) !== String(note._id)
            || (["ok", "partial"].includes(data.status) && !hasValidChunkCount)
            || !hasValidStaleChunkCount) {
            throw new Error("Invalid embedding response");
        }
        // ok: the index holds exactly this now. partial: unknown, so the next save embeds again.
        // stale: a newer version was already indexed and its record stands.
        if (data.status === "ok") await setIndexedKey(note._id, indexedKey);
        else if (data.status === "partial") await setIndexedKey(note._id, null);
        return { status: data.status, chunks: data.chunks, staleChunks: data.staleChunks };
    } catch (error) {
        console.error(`Embedding process failed for note ${note._id}:`, error.message);
        return { status: "failed", message: "Embedding failed" };
    }
});


module.exports = {
    buildIndexText, indexTextHash, INDEX_FIELDS,
    indexInBackground, triggerEmbed, deleteEmbed, runEmbeddingBatch, indexStatusOf,
};
