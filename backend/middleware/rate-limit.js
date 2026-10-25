// Fixed-window rate limiters for endpoints worth protecting: agent chat and summaries (they spend
// the shared AI quota), link previews (the server fetches outside pages), login (password
// guessing). In-memory is sufficient: one backend instance, and counters resetting on a deploy is
// acceptable at this scale. Each limiter keeps its own counts.
//
// Keys are users or the email being tried, never IP addresses: in production requests arrive
// through Vercel's rewrite and Render's proxy, so req.ip may not be the visitor (check it in the
// production logs before adding an IP-keyed limit, e.g. on sign-up).
//
// Agent chat config: AGENT_CHAT_RATE_LIMIT (default 20) requests per
// AGENT_CHAT_RATE_WINDOW_MINUTES (default 10) per user.

const makeFixedWindowLimiter = ({ limit, windowMs, message, keyOf = (req) => String(req.user._id) }) => {
    const buckets = new Map(); // key -> { count, resetAt }
    return (req, res, next) => {
        const key = keyOf(req);
        if (!key) return next();
        const now = Date.now();

        let bucket = buckets.get(key);
        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }

        bucket.count += 1;

        // Opportunistic cleanup so the map can't grow unboundedly.
        if (buckets.size > 5000) {
            for (const [k, v] of buckets) {
                if (now > v.resetAt) buckets.delete(k);
            }
        }

        if (bucket.count > limit) {
            res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
            return res.status(429).json({ error: true, message });
        }
        next();
    };
};

const MINUTE = 60 * 1000;

const agentChatLimiter = makeFixedWindowLimiter({
    limit: Math.max(1, parseInt(process.env.AGENT_CHAT_RATE_LIMIT || "20", 10)),
    windowMs: Math.max(1, parseInt(process.env.AGENT_CHAT_RATE_WINDOW_MINUTES || "10", 10)) * MINUTE,
    message: "Agent rate limit reached. Try again in a few minutes.",
});

// Summaries share the agent's free-tier AI quota
const summarizeLimiter = makeFixedWindowLimiter({
    limit: 10,
    windowMs: MINUTE,
    message: "Too many summaries at once. Try again in a minute.",
});

// The editor asks for a preview per pasted link; a page full of links stays well under this
const linkPreviewLimiter = makeFixedWindowLimiter({
    limit: 30,
    windowMs: MINUTE,
    message: "Too many link previews at once. Try again in a minute.",
});

// Per email tried, so one account can't have its password guessed without limit
const loginLimiter = makeFixedWindowLimiter({
    limit: 10,
    windowMs: 15 * MINUTE,
    message: "Too many login attempts. Try again in a few minutes.",
    keyOf: (req) => (typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : ""),
});

module.exports = { agentChatLimiter, summarizeLimiter, linkPreviewLimiter, loginLimiter };
