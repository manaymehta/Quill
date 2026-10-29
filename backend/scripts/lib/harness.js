// What every scripts/test-*.js shares: backend/.env loaded, a signed access token per throwaway
// user, a request helper against the running Express, and PASS/FAIL lines with a closing summary.
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env"), override: true, quiet: true });
const jwt = require("jsonwebtoken");

const BASE = `http://localhost:${process.env.PORT || 8100}/v1`;

// Throwaway users: fixed IDs that no real account has
const USER_A = "000000000000000000000001";
const USER_B = "000000000000000000000002";

// An access token for a throwaway user, signed like the backend's own (no login or refresh needed)
const token = (userId, label = "test") => jwt.sign(
    { _id: userId, email: `${label}-${userId.slice(-1)}@example.invalid`, fullName: `${label} test`, tokenType: "access" },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
);

// call(user, method, path, body) -> { status, data }; data is the raw text for a reply that isn't
// JSON, null for an empty one
const makeCall = (label) => async (userId, method, p, body) => {
    const r = await fetch(BASE + p, {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(userId, label)}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text || null; }
    return { status: r.status, data };
};

const results = [];
const check = (name, ok, detail = "") => {
    results.push(Boolean(ok));
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
// An exception mid-test counts as one failure
const fail = (error) => {
    console.log("ERROR:", error.stack || error.message);
    results.push(false);
};
const summary = (extra = "") => {
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed; cleanup done${extra}`);
    process.exitCode = results.every(Boolean) ? 0 : 1;
};

module.exports = { BASE, USER_A, USER_B, token, makeCall, check, fail, summary };
