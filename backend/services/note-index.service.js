const crypto = require("node:crypto");

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

module.exports = { buildIndexText, indexTextHash };
