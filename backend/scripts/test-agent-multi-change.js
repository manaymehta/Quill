// Review lists against a running Express, as two throwaway users: several
// changes per list (one row per note, renames per note, clashes), exact
// tags, ONE pending list per account updated in place (version), held
// changes (separate task / too many) added to it or shown after it, the list
// living in its newest chat turn (older turns point to it), discard, grouping
// as a list (per-group changes, packed into parts above 50), split choices,
// several new folders in one Apply, undo and cross-user refusals.
// Everything it creates is removed.
//
// Usage (from backend/): node scripts/test-agent-multi-change.js
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AgentChat = require("../models/agent-chat.model");
const AgentProposal = require("../models/agent-proposal.model");
const AgentReceipt = require("../models/agent-receipt.model");
const AgentSelection = require("../models/agent-selection.model");
const Folder = require("../models/folder.model");
const Note = require("../models/note.model");
const User = require("../models/user.model");
const { appendTurns } = require("../controllers/agent.controller");

const BASE = `http://localhost:${process.env.PORT || 8100}/v1`;
const USER_A = "000000000000000000000001";
const USER_B = "000000000000000000000002";
const token = (id) => jwt.sign({ _id: id, email: `multi-${id.slice(-1)}@example.invalid`, fullName: "Multi Test", tokenType: "access" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });

const call = async (user, method, p, body) => {
    const r = await fetch(BASE + p, {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(user)}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await r.json(); } catch { /* empty */ }
    return { status: r.status, data };
};

const results = [];
const check = (name, ok, detail = "") => {
    results.push(Boolean(ok));
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const rename = (from, to, ids) => ({ action: "tag", params: { remove: [from], add: [to] }, instruction: `rename #${from}`,
    candidates: ids.map((noteId) => ({ noteId, verdict: "likely", reason: `tagged #${from}` })) });
const archive = (ids) => ({ action: "archive", params: { archived: true }, candidates: ids.map((noteId) => ({ noteId })) });
const row = (proposal, noteId) => proposal.candidates.find((c) => c.noteId === noteId);
const tagsOf = async (id) => (await Note.findById(id).lean()).tags;
const status = async (proposalId) => (await AgentProposal.findOne({ proposalId }).lean())?.status;
const discardAll = (user) => AgentProposal.updateMany({ userId: user, status: { $in: ["open", "held"] } }, { $set: { status: "discarded" } });

(async () => {
    const users = [USER_A, USER_B];
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await User.deleteMany({ _id: { $in: users } });
        await User.create([
            { _id: USER_A, email: "multi-test-a@example.invalid", fullName: "Multi Test A" },
            { _id: USER_B, email: "multi-test-b@example.invalid", fullName: "Multi Test B" },
        ]);
        const note = async (user, title, tags = []) => (await call(user, "POST", "/add-note", { title, content: title, tags })).data.note;
        // The owner's real example: four tags on three notes.
        const welcome = await note(USER_A, "Welcome", ["welcome", "getting-started"]);
        const checklists = await note(USER_A, "Checklists", ["welcome"]);
        const graph = await note(USER_A, "Graph", ["tags", "click a tag"]);
        const caps = await note(USER_A, "Capitals", ["Welcome"]);
        const loose = await note(USER_A, "Loose", []);

        // 1. Several changes → one list, one row per note, an item per change.
        const p1 = await call(USER_A, "POST", "/agent/proposals", { changes: [
            rename("welcome", "welcomez", [welcome._id, checklists._id]),
            rename("getting-started", "getting-startedz", [welcome._id]),
            rename("tags", "tagsz", [graph._id]),
            rename("click a tag", "click a tagz", [graph._id]),
        ] });
        const w = row(p1.data, welcome._id);
        check("several changes → one list, one row per note, one item per change",
            p1.status === 201 && p1.data.status === "open" && p1.data.changes.length === 4 && p1.data.candidates.length === 3
            && w.items.length === 2 && row(p1.data, graph._id).items.length === 2, String(p1.status));
        check("rows show the rename for that note", w.items.map((i) => i.label).join(" | ") === "#welcome → #welcomez | #getting-started → #getting-startedz");

        // 2. Apply needs the version the user saw; then only the ticked items.
        const stale = await call(USER_A, "POST", `/agent/proposals/${p1.data.proposalId}/apply`, { version: 99, picks: [{ noteId: graph._id, changes: ["c3"] }] });
        check("apply with an old version is refused (list updated since)", stale.status === 409 && stale.data.code === "list-updated", String(stale.status));
        const a1 = await call(USER_A, "POST", `/agent/proposals/${p1.data.proposalId}/apply`, { version: p1.data.version, picks: [
            { noteId: welcome._id, changes: ["c1"] },
            { noteId: checklists._id, changes: ["c1"] },
            { noteId: graph._id, changes: ["c3", "c4"] },
        ] });
        check("apply does exactly the ticked items, worked out per note",
            a1.data?.receipt?.counts?.applied === 3
            && JSON.stringify(await tagsOf(welcome._id)) === JSON.stringify(["getting-started", "welcomez"])
            && JSON.stringify(await tagsOf(graph._id)) === JSON.stringify(["tagsz", "click a tagz"])
            && JSON.stringify(await tagsOf(caps._id)) === JSON.stringify(["Welcome"]));
        check("one receipt listing every change", a1.data.receipt.changes.length === 4 && a1.data.receipt.action === "multi");
        const u1 = await call(USER_A, "POST", `/agent/receipts/${a1.data.receipt.receiptId}/undo`);
        check("one undo puts every note back", u1.data?.receipt?.status === "undone"
            && JSON.stringify(await tagsOf(welcome._id)) === JSON.stringify(["welcome", "getting-started"]));

        // 3. Exact tags.
        const exact = await call(USER_A, "POST", "/agent/select-notes", { filters: { tag: "welcome" } });
        const exactCaps = await call(USER_A, "POST", "/agent/select-notes", { filters: { tag: "Welcome" } });
        check("tags match exactly, capitals included", exact.data.notes.length === 2 && exactCaps.data.notes.length === 1);
        const capsRemove = await call(USER_A, "POST", "/agent/proposals", { action: "tag", params: { remove: ["welcome"] }, candidates: [{ noteId: caps._id }] });
        check("removing #welcome never touches #Welcome (nothing to change)", capsRemove.status === 200 && capsRemove.data.empty === true);

        // 4. Clashes.
        const fA = (await call(USER_A, "POST", "/create-folder", { name: "Multi A" })).data.folder;
        const fB = (await call(USER_A, "POST", "/create-folder", { name: "Multi B" })).data.folder;
        const p2 = await call(USER_A, "POST", "/agent/proposals", { changes: [
            { action: "move", params: { targetFolderId: fA._id }, candidates: [{ noteId: checklists._id }] },
            { action: "move", params: { targetFolderId: fB._id }, candidates: [{ noteId: checklists._id }] },
        ] });
        check("move to A vs move to B clash", JSON.stringify(row(p2.data, checklists._id).items.map((i) => i.clashesWith)) === JSON.stringify([["c2"], ["c1"]]));
        const both = await call(USER_A, "POST", `/agent/proposals/${p2.data.proposalId}/apply`, { picks: [{ noteId: checklists._id, changes: ["c1", "c2"] }] });
        check("applying two clashing items is refused", both.status === 400, String(both.status));
        await discardAll(USER_A);

        // 5. One pending list per account, updated in place.
        const chatId = await appendTurns(USER_A, null, [{ role: "user", text: "multi" }], { newChatTitle: "multi" });
        const first = await call(USER_A, "POST", "/agent/proposals", { ...rename("tags", "tagsz", [graph._id]), chatId });
        await appendTurns(USER_A, chatId, [{ role: "assistant", text: "list 1", citations: [], proposal: { proposalId: first.data.proposalId, changes: first.data.changes, candidates: first.data.candidates } }]);
        const added = await call(USER_A, "POST", "/agent/proposals", { changes: [archive([loose._id])], chatId, mode: "add" });
        check("a new change is added to the pending list (same list, new version)",
            added.data.proposalId === first.data.proposalId && added.data.extended === true && added.data.version === 2
            && added.data.changes.length === 2 && added.data.candidates.length === 2, JSON.stringify({ e: added.data.extended, ch: added.data.changes?.map((c) => c.title), n: added.data.candidates?.length }));
        check("still exactly one pending list", (await AgentProposal.countDocuments({ userId: USER_A, status: "open" })) === 1);
        const old = await call(USER_A, "POST", `/agent/proposals/${first.data.proposalId}/apply`, { version: 1, picks: [{ noteId: graph._id, changes: ["c1"] }] });
        check("applying what the user saw before the update is refused", old.status === 409 && old.data.code === "list-updated");

        // 6. A separate task while one is pending → held, extended in place.
        const h1 = await call(USER_A, "POST", "/agent/proposals", { changes: [rename("welcome", "welcomez", [checklists._id])], chatId, mode: "separate" });
        const h2 = await call(USER_A, "POST", "/agent/proposals", { changes: [rename("getting-started", "gs", [welcome._id])], chatId, mode: "separate", heldId: h1.data.proposalId });
        check("separate task → held (not the pending list), and the reply extends it in place",
            h1.data.status === "held" && h1.data.heldReason === "separate" && h1.data.pending?.notes === 2
            && h2.data.proposalId === h1.data.proposalId && h2.data.changes.length === 2, JSON.stringify({ s: h1.data.status, r: h1.data.heldReason, p: h1.data.pending, same: h2.data.proposalId === h1.data.proposalId, n: h2.data.changes?.length, m: h1.data.message }));
        const applyHeld = await call(USER_A, "POST", `/agent/proposals/${h1.data.proposalId}/apply`, { picks: [{ noteId: checklists._id, changes: ["c1"] }] });
        check("held changes can't be applied", applyHeld.status === 409);
        const showEarly = await call(USER_A, "POST", `/agent/proposals/${h1.data.proposalId}/show`);
        check("'show it after' waits until nothing is pending", showEarly.status === 409, String(showEarly.status));
        const pendingNow = await call(USER_A, "GET", "/agent/proposals/pending");
        check("the pending list in brief, for the agent", pendingNow.data.pending?.proposalId === first.data.proposalId && pendingNow.data.pending.changes.length === 2);

        // 7. "Add to the pending list": merged in place, shown in the held turn.
        await appendTurns(USER_A, chatId, [{ role: "assistant", text: "held", citations: [], proposal: { proposalId: h1.data.proposalId, status: "held", changes: h2.data.changes, candidates: h2.data.candidates } }]);
        const addHeld = await call(USER_A, "POST", `/agent/proposals/${h1.data.proposalId}/add`);
        const chat = await AgentChat.findById(chatId).lean();
        const turnA = chat.turns.find((t) => t.text === "list 1");
        const turnB = chat.turns.find((t) => t.text === "held");
        check("held changes added: one pending list holding everything, held record gone",
            addHeld.status === 200 && addHeld.data.proposalId === first.data.proposalId && addHeld.data.changes.length === 4
            && !(await AgentProposal.exists({ proposalId: h1.data.proposalId })), String(addHeld.status));
        check("the list now lives in the held turn; the older turn points to it",
            turnA.proposal.moved === true && turnB.proposal.proposalId === first.data.proposalId && turnB.proposal.changes.length === 4);
        const reopened = (await call(USER_A, "GET", `/agent/chats/${chatId}`)).data.turns;
        check("a reopened chat shows the pointer and the list", reopened.find((t) => t.text === "list 1").proposal.moved === true
            && reopened.find((t) => t.text === "held").proposal.status === "open");

        // 8. Too many with the pending list → held ("too-many"); buttons refused.
        const many = [];
        for (let i = 0; i < 53; i += 1) many.push((await Note.create({ userId: USER_A, title: `Many ${i}`, content: "x", tags: ["many"] }))._id.toString());
        const tooMany = await call(USER_A, "POST", "/agent/proposals", { changes: [rename("many", "lots", many.slice(0, 49))], chatId, mode: "add" });
        check("adding past 50 notes holds the new changes instead", tooMany.data.status === "held" && tooMany.data.heldReason === "too-many");

        // 9. Discard the pending list → the held one can be shown after it.
        const disc = await call(USER_A, "POST", `/agent/proposals/${first.data.proposalId}/discard`);
        const show = await call(USER_A, "POST", `/agent/proposals/${tooMany.data.proposalId}/show`);
        check("after discard, 'show it after' turns the held changes into the pending list",
            disc.status === 200 && show.status === 200 && (await status(tooMany.data.proposalId)) === "open" && show.data.candidates.length === 49);
        const bDisc = await call(USER_B, "POST", `/agent/proposals/${tooMany.data.proposalId}/discard`);
        check("another user can't discard it", bDisc.status === 404);
        await discardAll(USER_A);

        // 10. Over 50 alone → split choices; a part adds to the pending list.
        const split = await call(USER_A, "POST", "/agent/proposals", { changes: [rename("many", "lots", many), archive(many.slice(0, 2))], split: true, chatId });
        check("over 50 → split choices holding every change", split.status === 201 && split.data.splitChoices.parts.length === 2
            && split.data.splitChoices.changes.length === 2);
        await AgentSelection.updateOne({ selectionId: split.data.splitChoices.selectionId }, { $set: { chatId } });
        const start = await call(USER_A, "POST", "/agent/proposals", { ...rename("tags", "tagsz", [graph._id]), chatId });
        const part = await call(USER_A, "POST", `/agent/selections/${split.data.splitChoices.selectionId}/parts/1/open`);
        check("opening a part adds it to the pending list", part.status === 201 && part.data.proposalId === start.data.proposalId
            && part.data.extended === true, `${part.status}`);
        const part0 = await call(USER_A, "POST", `/agent/selections/${split.data.splitChoices.selectionId}/parts/0/open`);
        check("a part that would take the pending list over 50 is refused", part0.status === 409, String(part0.status));
        await discardAll(USER_A);

        // 11. Grouping → one list, two changes per group, misfits marked.
        const groupBody = { groups: [
            { name: "Guides", tag: "guides", noteIds: [welcome._id, checklists._id, loose._id], misfits: [{ noteId: loose._id, reason: "empty note" }] },
            { name: "Graphs", tag: "graphs", noteIds: [graph._id, caps._id], misfits: [] },
        ] };
        const g = await call(USER_A, "POST", "/agent/proposals", groupBody);
        check("grouping → one list with a move + tag change per group, misfits rejected",
            g.status === 201 && g.data.groups.length === 2 && g.data.changes.length === 4
            && JSON.stringify(g.data.groups[0].changes) === JSON.stringify(["c1", "c2"])
            && row(g.data, loose._id).items.every((i) => i.verdict === "rejected"));
        const ga = await call(USER_A, "POST", `/agent/proposals/${g.data.proposalId}/apply`, { version: g.data.version, picks: [
            { noteId: welcome._id, changes: ["c1"] }, { noteId: checklists._id, changes: ["c1"] },
            { noteId: graph._id, changes: ["c4"] }, { noteId: caps._id, changes: ["c4"] },
        ] });
        const guides = await Folder.findOne({ userId: USER_A, name: "Guides", isDeleted: false }).lean();
        check("apply: group 1 into its new folder, group 2 tagged", ga.data?.receipt?.counts?.applied === 4 && guides
            && (await Note.findById(welcome._id).lean()).folderId === String(guides._id) && (await tagsOf(caps._id)).includes("graphs"));
        await call(USER_A, "POST", `/agent/receipts/${ga.data.receipt.receiptId}/undo`);
        check("undo puts them back and trashes the empty folder", (await Folder.findById(guides._id).lean()).isDeleted === true
            && !(await tagsOf(caps._id)).includes("graphs"));
        const bigGroups = await call(USER_A, "POST", "/agent/proposals", { split: true, groups: [
            { name: "First", tag: "first", noteIds: many.slice(0, 30), misfits: [] },
            { name: "Second", tag: "second", noteIds: many.slice(30, 53), misfits: [] },
        ] });
        check("a grouping over 50 notes splits into parts of whole groups", bigGroups.data?.splitChoices?.parts.length === 2
            && bigGroups.data.splitChoices.parts[0].label === "First" && bigGroups.data.splitChoices.parts[0].count === 30);

        // 12. Deleting the chat removes the lists shown in it.
        const inChat = await call(USER_A, "POST", "/agent/proposals", { ...rename("tags", "tagsz", [graph._id]), chatId });
        await call(USER_A, "DELETE", `/agent/chats/${chatId}`);
        check("deleting the chat removes its pending list", !(await AgentProposal.exists({ proposalId: inChat.data.proposalId })));

        // 13. Cross-user.
        const bProp = await call(USER_B, "POST", "/agent/proposals", rename("welcome", "x", [welcome._id]));
        const bAdd = await call(USER_B, "POST", `/agent/proposals/${tooMany.data.proposalId}/add`);
        check("cross-user refused", bProp.status === 400 && bAdd.status === 404, `${bProp.status} ${bAdd.status}`);
    } catch (error) {
        console.log("ERROR:", error.stack || error.message);
        results.push(false);
    } finally {
        for (const user of users) {
            const notes = await Note.find({ userId: user }).select("_id").lean();
            for (const n of notes) {
                await call(user, "DELETE", `/delete-note/${n._id}`);
                await call(user, "DELETE", `/delete-trash-note/${n._id}`);
            }
        }
        await Note.deleteMany({ userId: { $in: users } });
        await Folder.deleteMany({ userId: { $in: users } });
        for (const Model of [AgentChat, AgentProposal, AgentReceipt, AgentSelection]) await Model.deleteMany({ userId: { $in: users } });
        await User.deleteMany({ _id: { $in: users } });
        await mongoose.connection.close();
        console.log(`\n${results.filter(Boolean).length}/${results.length} passed; cleanup done`);
        process.exitCode = results.every(Boolean) ? 0 : 1;
    }
})();
