// One body shape for every note: `content`, with checkboxes as GFM task lines
// (`- [ ] text` / `- [x] text`). The old checklist fields (`isChecklist`, `checklist`) are
// accepted for compatibility while old clients and the old agent are still around; every write
// goes through `normalizeNoteBody`, so MongoDB only ever receives the new shape.
//
// This is also the safety net for the old UI's save path: checklist mode always sent
// `content: ""`. Converting a checklist must never erase content the user could not see in that
// mode, so an empty checklist + empty content leaves the stored body alone.

// A rendered task line (the same family of markers the editor accepts).
const TASK_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\](?:[ \t]|$)/;

const hasText = (value) => typeof value === "string" && value.trim() !== "";

// The old editor was single-line. Flatten breaks so an item can never turn into a second block
// (a heading, a new list item, a code fence) once it becomes markdown.
const flattenItemText = (text) => String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

const checklistToTaskLines = (checklist) => (Array.isArray(checklist) ? checklist : [])
    .filter((item) => item && hasText(item.text))
    .map((item) => `- [${item.completed ? "x" : " "}] ${flattenItemText(item.text)}`)
    .join("\n");

const hasLegacyChecklist = (body) => Boolean(body?.isChecklist)
    || (Array.isArray(body?.checklist) && body.checklist.length > 0);

const trimEnd = (text) => String(text ?? "").replace(/\s+$/g, "");

const joinBlocks = (content, tasks) => {
    const base = trimEnd(content);
    if (!tasks) return base;
    return base ? `${base}\n\n${tasks}` : tasks;
};

// An already-migrated note has a task block at the end. When an old client saves its checklist
// again, replace that block instead of appending a second copy; prose above it stays.
const replaceTrailingTasks = (content, tasks) => {
    const lines = String(content ?? "").split(/\r?\n/);
    let end = lines.length - 1;
    while (end >= 0 && lines[end].trim() === "") end--;
    let start = end;
    while (start >= 0 && TASK_LINE_RE.test(lines[start])) start--;
    start++;
    if (start <= end) {
        return [...lines.slice(0, start), ...tasks.split("\n")]
            .join("\n")
            .replace(/\s+$/g, "");
    }
    return joinBlocks(content, tasks);
};

/**
 * Translate a legacy write into the content-only shape.
 *
 * @param {object} body The request body.
 * @param {object|null} existingNote The stored note for an edit (used to avoid wiping content).
 * @returns {object} The same body, with content/tasks and legacy fields cleared when it was legacy.
 */
const normalizeNoteBody = (body, existingNote = null) => {
    if (!hasLegacyChecklist(body)) return body;

    const tasks = checklistToTaskLines(body.checklist);
    const payloadContent = typeof body.content === "string" ? body.content : "";

    let content;
    if (payloadContent.trim()) {
        // The client supplied a body of its own (e.g. an agent edit that also touched content).
        content = joinBlocks(payloadContent, tasks);
    } else if (tasks) {
        const existingContent = existingNote?.content || "";
        content = existingContent.trim()
            ? replaceTrailingTasks(existingContent, tasks)
            : tasks;
    } else {
        // Checklist mode with no items and no content: keep whatever body the note already has.
        // This is the "toggle Checklist on, press Save" path that used to send content: "".
        content = existingNote?.content || "";
    }

    const normalized = { ...body, content };
    delete normalized.isChecklist;
    delete normalized.checklist;
    return normalized;
};

module.exports = {
    normalizeNoteBody,
};
