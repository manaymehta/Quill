// The one way the backend talks to the AI service (FastAPI): base URL, internal key, JSON body and a
// time limit are added here, so callers name only the path and what they send.
const { FASTAPI_URL, FASTAPI_INTERNAL_KEY } = require("../config/env");

const DEFAULT_TIMEOUT_MS = 30_000;

const isFastApiConfigured = () => Boolean(FASTAPI_URL);

// Resolves with fetch's Response whatever its status (callers decide what a failure means); rejects
// when FastAPI can't be reached or the time limit passes. `asUser` ({ authorization, userId })
// forwards the user's own login, so the agent's tool calls run with exactly their permissions.
// `signal` replaces the time limit, for a caller that aborts on its own terms (the chat stream).
const callFastApi = (path, { method = "GET", body, headers = {}, asUser, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) => {
    if (!FASTAPI_URL) return Promise.reject(new Error("AI service is not configured"));
    return fetch(`${FASTAPI_URL}${path}`, {
        method,
        headers: {
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(FASTAPI_INTERNAL_KEY ? { "x-api-key": FASTAPI_INTERNAL_KEY } : {}),
            ...(asUser ? { Authorization: asUser.authorization, "x-user-id": String(asUser.userId) } : {}),
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: signal || AbortSignal.timeout(timeoutMs),
    });
};

module.exports = { isFastApiConfigured, callFastApi };
