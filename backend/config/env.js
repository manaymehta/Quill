// Every setting the backend reads from its environment, in one place: .env is loaded once here, and
// the required ones are checked at startup, so a misconfigured deploy fails at boot with a clear
// message instead of at the first login or AI call.
require("dotenv").config({ quiet: true });

const REQUIRED = ["MONGO_URI", "ACCESS_TOKEN_SECRET"];
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")} (see backend/.env)`);
}

const positiveInt = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: positiveInt(process.env.PORT, 8000),
    MONGO_URI: process.env.MONGO_URI,
    // Comma-separated browser origins allowed to call the API with credentials
    FRONTEND_ORIGINS: (process.env.FRONTEND_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean),

    ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET,
    ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || "15m",
    REFRESH_TOKEN_TTL_DAYS: Math.min(positiveInt(process.env.REFRESH_TOKEN_TTL_DAYS, 30), 365),
    // The OAuth client ID Google tokens are checked against. VITE_GOOGLE_CLIENT_ID is the old name
    // (a frontend build prefix), still accepted so existing deploys keep working.
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "",

    // The AI service (FastAPI). Optional: without it, notes still save; AI features answer "not configured".
    FASTAPI_URL: (process.env.FASTAPI_SUMMARIZE_URL || "").replace(/\/+$/, ""),
    FASTAPI_INTERNAL_KEY: process.env.FASTAPI_INTERNAL_KEY || "",

    AGENT_CHAT_RATE_LIMIT: positiveInt(process.env.AGENT_CHAT_RATE_LIMIT, 20),
    AGENT_CHAT_RATE_WINDOW_MINUTES: positiveInt(process.env.AGENT_CHAT_RATE_WINDOW_MINUTES, 10),
};
