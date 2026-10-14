// Multiple agent chats against a running Express, as two throwaway users:
// saving turns (new chat titled by its first message, 3-day clock), the
// 10-chat limit, rename, pin (no expiry) / unpin, expired review lists,
// delete (cleans the chat's open lists, keeps receipts), cross-user refusal
// and the TTL index. Everything it creates is removed at the end.
//
// Usage (from backend/): node scripts/test-agent-chats.js [--live]
//   --live also sends one real chat turn (FastAPI + Gemini running; 1 turn of quota).
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AgentChat = require("../models/agent-chat.model");
const AgentProposal = require("../models/agent-proposal.model");
const AgentReceipt = require("../models/agent-receipt.model");
const AgentSelection = require("../models/agent-selection.model");
const User = require("../models/user.model");
const { appendTurns } = require("../controllers/agent.controller");

const BASE = `http://localhost:${process.env.PORT || 8100}/v1`;
const USER_A = "000000000000000000000001";
const USER_B = "000000000000000000000002";
const DAY_MS = 24 * 60 * 60 * 1000;
const token = (id) => jwt.sign({ _id: id, email: `chats-${id.slice(-1)}@example.invalid`, fullName: "Chats Test", tokenType: "access" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });

const call = async (user, method, p, body) => {
    const r = await fetch(BASE + p, {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(user)}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
};

const results = [];
const check = (name, ok, detail = "") => {
    results.push(Boolean(ok));
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const near = (date, ms, slack = 60_000) => date && Math.abs(new Date(date).getTime() - (Date.now() + ms)) < slack;

(async () => {
    const createdNotes = [];
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await User.deleteMany({ _id: { $in: [USER_A, USER_B] } });
        await User.create([
            { _id: USER_A, email: "chats-test-a@example.invalid", fullName: "Chats Test A" },
            { _id: USER_B, email: "chats-test-b@example.invalid", fullName: "Chats Test B" },
        ]);
        await AgentChat.deleteMany({ userId: { $in: [USER_A, USER_B] } });

        // 1. Saving turns: chatId null creates a chat titled by the first message.
        const longMessage = "find all my notes about the docker deployment setup and summarize the second one please";
        const chatId = await appendTurns(USER_A, null, [
            { role: "user", text: longMessage },
            { role: "assistant", text: "Here you go.", citations: [] },
        ], { workingSet: [{ noteId: "0123456789abcdef01234567", title: "Docker deploy" }], newChatTitle: "find all my notes about the docker deployment…" });
        const created = await AgentChat.findById(chatId).lean();
        check("first message creates the chat with its title, turns and working set",
            created.title.startsWith("find all my notes") && created.turns.length === 2 && created.workingSet.length === 1);
        check("new chat expires 3 days after its last activity", near(created.expiresAt, 3 * DAY_MS));

        await AgentChat.updateOne({ _id: chatId }, { $set: { expiresAt: new Date(Date.now() + DAY_MS) } });
        await appendTurns(USER_A, chatId, [{ role: "user", text: "again" }, { role: "assistant", text: "ok", citations: [] }]);
        const appended = await AgentChat.findById(chatId).lean();
        check("a new message resets the clock to 3 days and keeps the working set",
            near(appended.expiresAt, 3 * DAY_MS) && appended.turns.length === 4 && appended.workingSet.length === 1);
        const gone = await appendTurns(USER_A, "0000000000000000000000ff", [{ role: "user", text: "x" }]);
        check("saving into a deleted chat does nothing", gone === null);

        // 2. List + open.
        const list = await call(USER_A, "GET", "/agent/chats");
        check("list shows the chat with its limit", list.data.chats?.length === 1 && list.data.chats[0].chatId === chatId && list.data.limit === 10);
        const opened = await call(USER_A, "GET", `/agent/chats/${chatId}`);
        check("open returns turns and working set", opened.data.turns?.length === 4 && opened.data.workingSet?.length === 1);

        // 3. Rename.
        const renamed = await call(USER_A, "PATCH", `/agent/chats/${chatId}`, { title: "  Docker   notes  " });
        const tooLong = await call(USER_A, "PATCH", `/agent/chats/${chatId}`, { title: "x".repeat(81) });
        const empty = await call(USER_A, "PATCH", `/agent/chats/${chatId}`, { title: "   " });
        check("rename tidies spaces; empty or over 80 chars refused",
            renamed.data.chat?.title === "Docker notes" && tooLong.status === 400 && empty.status === 400);

        // 4. Pin / unpin.
        const pinned = await call(USER_A, "PATCH", `/agent/chats/${chatId}`, { pinned: true });
        const pinnedDoc = await AgentChat.findById(chatId).lean();
        check("pinned chat has no expiry", pinned.data.chat?.pinned === true && !pinnedDoc.expiresAt);
        await appendTurns(USER_A, chatId, [{ role: "user", text: "while pinned" }]);
        check("a message in a pinned chat keeps it without expiry", !(await AgentChat.findById(chatId).lean()).expiresAt);
        await call(USER_A, "PATCH", `/agent/chats/${chatId}`, { pinned: false });
        check("unpinning starts a fresh 3 days", near((await AgentChat.findById(chatId).lean()).expiresAt, 3 * DAY_MS));

        // 5. Expired review lists / split choices.
        const noteR = await call(USER_A, "POST", "/add-note", { title: "Chats test note", content: "x" });
        createdNotes.push(noteR.data.note._id);
        const live = await call(USER_A, "POST", "/agent/proposals", { action: "tag", params: { add: ["chatstest"] },
            candidates: [{ noteId: noteR.data.note._id }] });
        await AgentProposal.updateOne({ proposalId: live.data.proposalId }, { $set: { chatId } });
        await appendTurns(USER_A, chatId, [
            { role: "assistant", text: "live list", citations: [], proposal: { proposalId: live.data.proposalId, action: "tag", params: {}, candidates: [] } },
            { role: "assistant", text: "old list", citations: [], proposal: { proposalId: "gone-proposal", action: "tag", params: {}, candidates: [] } },
            { role: "assistant", text: "old split", citations: [], splitChoices: { selectionId: "gone-selection", action: "tag", params: {}, total: 60, parts: [] } },
        ]);
        const withLists = (await call(USER_A, "GET", `/agent/chats/${chatId}`)).data.turns;
        const byText = (t) => withLists.find((x) => x.text === t);
        check("lists whose record is gone come back expired; live ones don't",
            byText("live list").proposal.expired === false && byText("old list").proposal.expired === true
            && byText("old split").splitChoices.expired === true);

        // 6. Cross-user.
        const bGet = await call(USER_B, "GET", `/agent/chats/${chatId}`);
        const bPatch = await call(USER_B, "PATCH", `/agent/chats/${chatId}`, { title: "hijack" });
        const bDelete = await call(USER_B, "DELETE", `/agent/chats/${chatId}`);
        const bList = await call(USER_B, "GET", "/agent/chats");
        const bChat = await call(USER_B, "POST", "/agent/chat", { message: "hi", chatId });
        check("cross-user: B can't open, rename, delete, list or chat in A's chat",
            bGet.status === 404 && bPatch.status === 404 && bDelete.status === 404 && bList.data.chats.length === 0 && bChat.status === 404,
            [bGet.status, bPatch.status, bDelete.status, bChat.status].join("/"));
        const badId = await call(USER_A, "POST", "/agent/chat", { message: "hi", chatId: "nope" });
        check("malformed chatId refused", badId.status === 400, String(badId.status));

        // 7. Delete: open lists go, receipts stay.
        const applied = await call(USER_A, "POST", "/agent/proposals", { action: "tag", params: { add: ["chatstest2"] },
            candidates: [{ noteId: noteR.data.note._id }] });
        await AgentProposal.updateOne({ proposalId: applied.data.proposalId }, { $set: { chatId } });
        const applyRes = await call(USER_A, "POST", `/agent/proposals/${applied.data.proposalId}/apply`, { noteIds: [noteR.data.note._id] });
        // One pending list per account: the one above merged into `live` and
        // was applied with it, so a fresh pending list stands in for "open".
        const pendingNow = await call(USER_A, "POST", "/agent/proposals", { action: "tag", params: { add: ["chatstest3"] },
            candidates: [{ noteId: noteR.data.note._id }] });
        await AgentProposal.updateOne({ proposalId: pendingNow.data.proposalId }, { $set: { chatId } });
        await AgentSelection.create({ selectionId: `chats-test-${Date.now()}`, userId: USER_A, chatId, action: "tag", params: { add: ["x"] },
            parts: [{ label: "a", noteIds: [noteR.data.note._id] }, { label: "b", noteIds: [noteR.data.note._id] }] });
        const del = await call(USER_A, "DELETE", `/agent/chats/${chatId}`);
        const afterDelete = {
            chat: await AgentChat.exists({ _id: chatId }),
            openList: await AgentProposal.exists({ proposalId: pendingNow.data.proposalId }),
            selection: await AgentSelection.exists({ chatId }),
            receipt: await AgentReceipt.exists({ proposalId: applied.data.proposalId }),
        };
        check("delete removes the chat, its open lists and split choices; the receipt stays",
            del.status === 200 && !afterDelete.chat && !afterDelete.openList && !afterDelete.selection
            && applyRes.status === 200 && Boolean(afterDelete.receipt), JSON.stringify(afterDelete));

        // 8. The 10-chat limit (checked before any model call).
        await AgentChat.insertMany(Array.from({ length: 10 }, (_, i) => ({ userId: USER_A, title: `Filler ${i}` })));
        const limited = await call(USER_A, "POST", "/agent/chat", { message: "one more chat" });
        check("11th chat refused with the limit message", limited.status === 409 && limited.data?.code === "chat-limit"
            && /10 chats is the limit/.test(limited.data?.message || ""), String(limited.status));

        // 9. TTL index.
        const idx = await AgentChat.collection.indexes();
        check("TTL index on expiresAt (erase when the date passes)", idx.some((i) => i.key.expiresAt && i.expireAfterSeconds === 0));

        // 10. Optional: one real turn creates a chat and returns its chatId.
        if (process.argv.includes("--live")) {
            await AgentChat.deleteMany({ userId: USER_B });
            const r = await call(USER_B, "POST", "/agent/chat", { message: "How many tags do I have?" });
            const finalLine = String(r.data).split("\n\n").find((b) => b.startsWith("event: final"));
            const final = finalLine ? JSON.parse(finalLine.split("\ndata: ")[1]) : null;
            const saved = final?.chatId && await AgentChat.findOne({ _id: final.chatId, userId: USER_B }).lean();
            check("live turn: new chat saved, titled by the message, chatId returned",
                Boolean(saved) && saved.title === "How many tags do I have?" && saved.turns.length === 2, final ? "" : String(r.data).slice(0, 200));
        }
    } catch (error) {
        console.log("ERROR:", error.stack || error.message);
        results.push(false);
    } finally {
        for (const id of createdNotes) {
            await call(USER_A, "DELETE", `/delete-note/${id}`);
            await call(USER_A, "DELETE", `/delete-trash-note/${id}`);
        }
        await AgentChat.deleteMany({ userId: { $in: [USER_A, USER_B] } });
        await AgentProposal.deleteMany({ userId: { $in: [USER_A, USER_B] } });
        await AgentReceipt.deleteMany({ userId: { $in: [USER_A, USER_B] } });
        await AgentSelection.deleteMany({ userId: { $in: [USER_A, USER_B] } });
        await User.deleteMany({ _id: { $in: [USER_A, USER_B] } });
        await mongoose.connection.close();
        console.log(`\n${results.filter(Boolean).length}/${results.length} passed; cleanup done`);
        process.exitCode = results.every(Boolean) ? 0 : 1;
    }
})();
