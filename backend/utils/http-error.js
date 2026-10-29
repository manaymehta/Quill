// An error the central handler (index.js) answers with its own status and message instead of a 500.
// Handlers throw it from deep inside a transaction or helper rather than threading a reply back up.
class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
    }
}

module.exports = { HttpError };
