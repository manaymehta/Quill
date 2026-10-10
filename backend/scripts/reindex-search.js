// One-time search re-index (architecture plan §5.5, step 2b).
//
// Rebuilds every note's search pieces with the current indexing rules — tags
// in front of every piece, a fingerprint (textHash) on every piece — and
// removes leftover pieces of trashed notes. Safe to run again: re-indexing a
// note replaces its pieces in place, and a deleted note's removal is a no-op.
//
// Writes ONLY to the search index (via FastAPI /embed-note and
// /delete-embedding); notes in MongoDB are read, never changed. Needs the
// backend .env (MONGO_URI, FASTAPI_SUMMARIZE_URL, FASTAPI_INTERNAL_KEY) and a
// running FastAPI with the step-2b code.
//
// Usage (from backend/):
//   node scripts/reindex-search.js --dry-run              count what would happen
//   node scripts/reindex-search.js --user <userId>        one user only
//   node scripts/reindex-search.js                        everyone
//   --delay-ms <n>   pause between notes (default 800, for the embedding quota)
const path = require("node:path");
// Always the backend's own settings, even if the launching shell already has
// same-named variables (fast_api/.env also defines FASTAPI_SUMMARIZE_URL).
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
const mongoose = require("mongoose");
const { setTimeout: sleep } = require("node:timers/promises");
const connectDB = require("../config/db");
const Note = require("../models/note.model");
const { triggerEmbed, deleteEmbed } = require("../controllers/note.controller");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const main = async () => {
    const dryRun = flag("--dry-run");
    const userId = option("--user", null);
    const delayMs = Number(option("--delay-ms", 800));
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("--delay-ms must be a number ≥ 0");
    if (!dryRun && !process.env.FASTAPI_SUMMARIZE_URL) throw new Error("FASTAPI_SUMMARIZE_URL is not configured");

    await connectDB();
    const scope = userId ? { userId } : {};
    const live = await Note.find({ ...scope, isDeleted: { $ne: true } }).sort({ userId: 1, _id: 1 });
    const trashed = await Note.find({ ...scope, isDeleted: true }).select("_id").lean();
    const users = new Set(live.map((n) => n.userId));
    console.log(`${dryRun ? "[dry run] " : ""}${live.length} notes to re-index across ${users.size} user(s); `
        + `${trashed.length} trashed note(s) to clear from search${userId ? ` (user ${userId} only)` : ""}`);
    if (dryRun) return;

    const counts = {};
    const failed = [];
    const started = Date.now();
    for (const [index, note] of live.entries()) {
        const result = await triggerEmbed(note, note.userId);
        const status = result?.status || "unknown";
        counts[status] = (counts[status] || 0) + 1;
        if (!["ok", "skipped", "stale"].includes(status)) failed.push(String(note._id));
        if ((index + 1) % 10 === 0 || index + 1 === live.length) {
            console.log(`  ${index + 1}/${live.length} re-indexed (${Math.round((Date.now() - started) / 1000)}s)`);
        }
        if (delayMs > 0) await sleep(delayMs);
    }

    let cleared = 0;
    for (const note of trashed) {
        const result = await deleteEmbed(String(note._id));
        if (result?.status === "ok") cleared += 1;
    }

    console.log(`done: ${JSON.stringify(counts)}; trashed cleared ${cleared}/${trashed.length}`);
    if (failed.length > 0) {
        console.log(`failed note IDs (run again to retry): ${failed.join(", ")}`);
        process.exitCode = 1;
    }
};

main()
    .catch((error) => {
        console.error("Re-index failed:", error.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.connection.close());
