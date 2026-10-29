// A MongoDB ObjectId as it arrives in a request: exactly 24 hex characters. Stricter than
// mongoose.Types.ObjectId.isValid, which also accepts any 12-character string.
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

const isObjectId = (value) => typeof value === "string" && OBJECT_ID_RE.test(value);

module.exports = { isObjectId };
