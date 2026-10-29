const { isObjectId } = require("../utils/object-id");

const validationError = (res, message) => {
    return res.status(400).json({ error: true, message });
};

const validateObjectBody = (req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return validationError(res, "Request body must be a JSON object");
    }
    next();
};

const validateObjectIdParam = (paramName) => (req, res, next) => {
    const value = req.params[paramName];
    if (!isObjectId(value)) {
        return validationError(res, `Invalid ${paramName}`);
    }
    next();
};

const validateQueryParam = (paramName, { required = false, maxLength = 256 } = {}) => (req, res, next) => {
    const value = req.query[paramName];

    if (required && (typeof value !== "string" || !value.trim())) {
        return validationError(res, `${paramName} is required`);
    }

    if (value !== undefined && (typeof value !== "string" || value.length > maxLength)) {
        return validationError(res, `Invalid ${paramName}`);
    }

    next();
};

// Size caps for what a note or folder may hold, well above anything the app has stored (largest
// note so far: 5,442 characters of content, 5 tags, 8 checklist items, 5 previews)
const NOTE_LIMITS = {
    title: 500,
    content: 200_000,
    tags: 50,
    tag: 100,
    checklist: 500,
    checklistText: 2_000,
    linkPreviews: 20,
};
// Previews come from the scraper, which already cuts its fields to these lengths
const PREVIEW_FIELD_LIMITS = { url: 2048, title: 300, description: 1000, image: 2048, siteName: 100 };
const FOLDER_LIMITS = { name: 100, color: 20, icon: 16 };

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
// null is accepted where the routes have always treated it as empty
const isText = (value, max) => value === null || (typeof value === "string" && value.length <= max);

// The first problem with a note body, or null. Only fields present are checked (an edit sends a few).
const noteBodyProblem = (body) => {
    const { title, content, tags, isChecklist, checklist, showInHome, linkPreviews } = body;
    if (title !== undefined && !isText(title, NOTE_LIMITS.title)) {
        return `Title must be text of at most ${NOTE_LIMITS.title} characters`;
    }
    if (content !== undefined && !isText(content, NOTE_LIMITS.content)) {
        return `Note content must be text of at most ${NOTE_LIMITS.content.toLocaleString("en-US")} characters`;
    }
    if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag.length > NOTE_LIMITS.tag))) {
        return `Tags must be text of at most ${NOTE_LIMITS.tag} characters each`;
    }
    if (tags !== undefined && tags.length > NOTE_LIMITS.tags) return `A note can have at most ${NOTE_LIMITS.tags} tags`;
    if (isChecklist !== undefined && typeof isChecklist !== "boolean") return "isChecklist must be true or false";
    if (showInHome !== undefined && typeof showInHome !== "boolean") return "showInHome must be true or false";
    if (checklist !== undefined) {
        if (!Array.isArray(checklist)) return "Checklist must be a list";
        if (checklist.length > NOTE_LIMITS.checklist) return `A checklist can have at most ${NOTE_LIMITS.checklist} items`;
        const badItem = checklist.some((item) => !isPlainObject(item)
            || (item.text !== undefined && !isText(item.text, NOTE_LIMITS.checklistText))
            || (item.completed !== undefined && typeof item.completed !== "boolean"));
        if (badItem) return `Checklist items must be text of at most ${NOTE_LIMITS.checklistText.toLocaleString("en-US")} characters`;
    }
    if (linkPreviews !== undefined) {
        if (!Array.isArray(linkPreviews)) return "linkPreviews must be a list";
        const badPreview = linkPreviews.some((preview) => !isPlainObject(preview)
            || typeof preview.url !== "string"
            || Object.entries(PREVIEW_FIELD_LIMITS).some(([field, max]) => (
                preview[field] !== undefined && !isText(preview[field], max)
            )));
        if (badPreview) return "Invalid link preview";
    }
    return null;
};

// Type and size checks for /add-note and /edit-note. Link previews over the cap are dropped rather
// than refused: they're built from the links in the text, and refusing would lose the user's edit.
const validateNoteBody = (req, res, next) => {
    const problem = noteBodyProblem(req.body);
    if (problem) return validationError(res, problem);
    if (Array.isArray(req.body.linkPreviews)) req.body.linkPreviews = req.body.linkPreviews.slice(0, NOTE_LIMITS.linkPreviews);
    next();
};

// Type and size checks for /create-folder and /edit-folder (whether a name is required stays with
// the route)
const validateFolderBody = (req, res, next) => {
    for (const [field, max] of Object.entries(FOLDER_LIMITS)) {
        const value = req.body[field];
        if (value !== undefined && value !== null && (typeof value !== "string" || value.length > max)) {
            return validationError(res, `Folder ${field} must be text of at most ${max} characters`);
        }
    }
    next();
};

module.exports = {
    validateObjectBody,
    validateObjectIdParam,
    validateQueryParam,
    validateNoteBody,
    validateFolderBody,
};
