// Fixed-window per-user rate limiter for expensive endpoints (e.g. agent
// chat, which fans out to multiple paid LLM calls per turn). In-memory is
// sufficient: one backend instance, limits are per-user and restart-friendly
// degradation (counters reset on deploy) is acceptable at this scale.
//
// Config: AGENT_CHAT_RATE_LIMIT (default 20) requests per
// AGENT_CHAT_RATE_WINDOW_MINUTES (default 10) per user.

const buckets = new Map(); // key -> { count, resetAt }

const makeFixedWindowLimiter = ({ limit, windowMs, message }) => (req, res, next) => {
    const key = String(req.user._id);
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
        return res.status(429).json({ error: true, message });
    }
    next();
};

const agentChatLimiter = makeFixedWindowLimiter({
    limit: Math.max(1, parseInt(process.env.AGENT_CHAT_RATE_LIMIT || "20", 10)),
    windowMs: Math.max(1, parseInt(process.env.AGENT_CHAT_RATE_WINDOW_MINUTES || "10", 10)) * 60 * 1000,
    message: "Agent rate limit reached. Try again in a few minutes.",
});

module.exports = { agentChatLimiter };
