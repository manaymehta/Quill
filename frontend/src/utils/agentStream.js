import { BASE_URL } from './constants';
import { getAccessToken } from './authSession';
import { refreshAfterUnauthorized } from './axiosInstance';

// Agent chat turns arrive as a Server-Sent Events stream: `step` events while
// the agent works, then one `final` (the reply) or `error` event. axios can't
// read a response as it arrives in the browser, so this one route uses fetch
// with the same token handling (Bearer header, cookies, one refresh on 401).

// Time limits (architecture plan §2.1, D27); every other request keeps
// axios's 30 s.
const ABSOLUTE_LIMIT_MS = 80_000;
// Armed only once data starts arriving: if a proxy buffers the stream, nothing
// arrives until the end, so only the absolute limit applies.
const IDLE_LIMIT_MS = 30_000;

const DEFAULT_FAILURE = 'The assistant could not respond. Try again.';

export class AgentStreamError extends Error {
    // kind: 'stopped' (user pressed Stop), 'timeout', or 'failed'.
    constructor(message, { kind = 'failed', retryAfterSeconds } = {}) {
        super(message);
        this.kind = kind;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

const postChat = (body, token, signal) => fetch(`${BASE_URL}/agent/chat`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
});

// One blank-line-separated block → { event, data } (comment lines such as
// keep-alives carry no data and return null).
const parseBlock = (block) => {
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return null;
    try {
        return { event, data: JSON.parse(dataLines.join('\n')) };
    } catch {
        return null;
    }
};

/**
 * Sends one agent chat turn. Calls onStep(label) for each progress line and
 * resolves with the final reply payload. Rejects with an AgentStreamError
 * whose message is ready to show the user.
 */
export const streamAgentChat = async (body, { signal, onStep } = {}) => {
    if (signal?.aborted) throw new AgentStreamError('Stopped.', { kind: 'stopped' });

    const controller = new AbortController();
    let abortKind = null;
    const abort = (kind) => {
        if (abortKind) return;
        abortKind = kind;
        controller.abort();
    };
    const onStop = () => abort('stopped');
    signal?.addEventListener('abort', onStop, { once: true });
    const absoluteTimer = setTimeout(() => abort('timeout'), ABSOLUTE_LIMIT_MS);
    let idleTimer = null;
    const resetIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => abort('timeout'), IDLE_LIMIT_MS);
    };

    try {
        let token = getAccessToken();
        let response = await postChat(body, token, controller.signal);
        if (response.status === 401) {
            token = await refreshAfterUnauthorized(token);
            response = await postChat(body, token, controller.signal);
        }

        // Problems found before the turn starts (bad input, rate limit) come
        // back as ordinary JSON, not as a stream.
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('text/event-stream')) {
            const data = await response.json().catch(() => ({}));
            throw new AgentStreamError(data?.message || DEFAULT_FAILURE);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            resetIdleTimer();
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                const parsed = parseBlock(buffer.slice(0, boundary));
                buffer = buffer.slice(boundary + 2);
                if (!parsed) continue;

                if (parsed.event === 'step') {
                    if (typeof parsed.data?.label === 'string') onStep?.(parsed.data.label);
                } else if (parsed.event === 'final') {
                    return parsed.data;
                } else if (parsed.event === 'error') {
                    throw new AgentStreamError(parsed.data?.message || DEFAULT_FAILURE, {
                        retryAfterSeconds: parsed.data?.retryAfterSeconds,
                    });
                }
            }
        }
        throw new AgentStreamError('The assistant stopped unexpectedly. Try again.');
    } catch (error) {
        if (abortKind === 'stopped') throw new AgentStreamError('Stopped.', { kind: 'stopped' });
        if (abortKind === 'timeout') {
            throw new AgentStreamError('The assistant took too long — try again.', { kind: 'timeout' });
        }
        if (error instanceof AgentStreamError) throw error;
        throw new AgentStreamError(DEFAULT_FAILURE);
    } finally {
        clearTimeout(absoluteTimer);
        clearTimeout(idleTimer);
        signal?.removeEventListener('abort', onStop);
        // Close the connection whatever happened (a no-op once it has ended).
        controller.abort();
    }
};
