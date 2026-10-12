// One live grouping turn (Express + FastAPI + Gemini running): a throwaway
// user gets 9 notes on 3 topics (indexed like real notes), asks the agent to
// group them, and the script prints the groups it suggested. Everything is
// deleted at the end (notes through the normal routes, so their search
// pieces go too). Costs ~9 embedding calls + one chat turn of quota.
//
// Usage (from backend/): node scripts/live-grouping-turn.js
const path = require("node:path");
const { setTimeout } = require("node:timers");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AgentChat = require("../models/agent-chat.model");
const AgentGrouping = require("../models/agent-grouping.model");
const Note = require("../models/note.model");
const User = require("../models/user.model");

const BASE = `http://localhost:${process.env.PORT || 8100}/v1`;
const USER = "000000000000000000000002";
const token = jwt.sign({ _id: USER, email: "live-groups@example.invalid", fullName: "Live Groups", tokenType: "access" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
const call = (method, p, body) => fetch(BASE + p, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
});

const NOTES = [
    ["Docker deploy steps", "Build the image with docker build, push it to the registry, then docker compose up -d on the server."],
    ["Compose cheatsheet", "docker compose ps, logs -f, down -v. Services: api, worker, redis; volumes keep postgres data."],
    ["Dockerfile tips", "Multi-stage builds, pin base image versions, copy package files first to cache dependency layers."],
    ["Pasta carbonara", "Guanciale, eggs, pecorino and black pepper. No cream. Toss the pasta off the heat."],
    ["Weeknight dal", "Red lentils, turmeric, cumin seeds, garlic and ginger. Simmer 20 minutes, finish with lemon."],
    ["Banana bread", "Three ripe bananas, melted butter, sugar, one egg, flour and baking soda. Bake an hour at 175C."],
    ["Interview prep", "Practice system design: URL shortener, rate limiter. STAR stories about conflict and deadlines."],
    ["Resume edits", "Move projects above education, quantify impact, add the notes app and the FastAPI service."],
    ["Job application tracker", "Applied to Acme (frontend) and Globex (full stack). Interview with Initech on Tuesday."],
];

(async () => {
    const ids = [];
    let ok = false;
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await User.deleteMany({ _id: USER });
        await User.create({ _id: USER, email: "live-groups@example.invalid", fullName: "Live Groups" });
        for (const [title, content] of NOTES) {
            const r = await (await call("POST", "/add-note", { title, content })).json();
            ids.push(r.note._id);
        }
        console.log(`Created ${ids.length} notes; waiting 15 s for indexing…`);
        await new Promise((resolve) => { setTimeout(resolve, 15_000); });

        const response = await call("POST", "/agent/chat", { message: "Group my notes that feel related" });
        const text = await response.text();
        const finalBlock = text.split("\n\n").find((b) => b.startsWith("event: final"));
        const errorBlock = text.split("\n\n").find((b) => b.startsWith("event: error"));
        if (!finalBlock) {
            console.log("No final event:", (errorBlock || text).slice(0, 400));
            return;
        }
        const final = JSON.parse(finalBlock.split("\ndata: ")[1]);
        const titles = new Map(NOTES.map(([t], i) => [ids[i], t]));
        const grouping = final.groupSuggestions && await AgentGrouping.findOne({ groupingId: final.groupSuggestions.groupingId }).lean();
        console.log("\nTools:", final.toolsUsed.map((t) => `${t.tool}${t.ok ? "" : " (failed)"}: ${t.summary}`).join(" | "));
        console.log("\nAnswer:\n" + final.message);
        if (grouping) {
            console.log("\nGroups saved:");
            for (const g of grouping.groups) {
                const misfits = new Set(g.misfits.map((m) => m.noteId));
                console.log(` - ${g.name} (#${g.tag}): ${g.noteIds.map((id) => titles.get(id) + (misfits.has(id) ? " [may not fit]" : "")).join(", ")}`);
            }
            console.log(` ungrouped: ${final.groupSuggestions.ungroupedCount}, not indexed: ${final.groupSuggestions.notIndexedCount}`);
            ok = grouping.groups.length > 0 && Boolean(final.chatId);
        } else {
            console.log("\nNo group suggestions in the reply.");
        }
    } catch (error) {
        console.log("ERROR:", error.stack || error.message);
    } finally {
        for (const id of ids) {
            await call("DELETE", `/delete-note/${id}`);
            await call("DELETE", `/delete-trash-note/${id}`);
        }
        await Note.deleteMany({ userId: USER });
        await AgentChat.deleteMany({ userId: USER });
        await AgentGrouping.deleteMany({ userId: USER });
        await User.deleteMany({ _id: USER });
        await mongoose.connection.close();
        console.log(`\n${ok ? "PASS" : "FAIL"}  live grouping turn; cleanup done`);
        process.exitCode = ok ? 0 : 1;
    }
})();
