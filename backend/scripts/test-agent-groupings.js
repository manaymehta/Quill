// Grouping (suggest_groups) and "move to a new folder" against a running
// Express, as two throwaway users: saving groups, turning a group into a
// review list (new folder / tag), apply creating the folder inside the
// transaction, undo trashing it once empty (kept if not), cross-user refusal
// and expired group cards in a chat. Everything it creates is removed.
//
// Usage (from backend/): node scripts/test-agent-groupings.js
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AgentChat = require("../models/agent-chat.model");
const AgentGrouping = require("../models/agent-grouping.model");
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
const token = (id) => jwt.sign({ _id: id, email: `groups-${id.slice(-1)}@example.invalid`, fullName: "Groups Test", tokenType: "access" },
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

(async () => {
    const users = [USER_A, USER_B];
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await User.deleteMany({ _id: { $in: users } });
        await User.create([
            { _id: USER_A, email: "groups-test-a@example.invalid", fullName: "Groups Test A" },
            { _id: USER_B, email: "groups-test-b@example.invalid", fullName: "Groups Test B" },
        ]);
        const note = async (user, title, extra = {}) => (await call(user, "POST", "/add-note", { title, content: title, ...extra })).data.note;
        const [d1, d2, d3, c1, c2] = [
            await note(USER_A, "Docker deploy"), await note(USER_A, "Compose cheatsheet"), await note(USER_A, "Job application"),
            await note(USER_A, "Pasta"), await note(USER_A, "Dal"),
        ];
        const bNote = await note(USER_B, "B's note");

        // 1. Saving groups.
        const body = {
            instruction: "group related notes",
            groups: [
                { name: "Docker setup", tag: "docker-setup", noteIds: [d1._id, d2._id, d3._id], misfits: [{ noteId: d3._id, reason: "about a job application" }] },
                { name: "Cooking", tag: "cooking", noteIds: [c1._id, c2._id], misfits: [] },
            ],
            ungroupedCount: 1, notIndexedCount: 0, scannedCount: 6, totalCount: 6,
        };
        const saved = await call(USER_A, "POST", "/agent/groupings", body);
        check("groups saved with counts and sample titles (misfits left out of samples)",
            saved.status === 201 && saved.data.groups[0].count === 3 && saved.data.groups[0].misfitCount === 1
            && !saved.data.groups[0].sampleTitles.includes("Job application") && saved.data.ungroupedCount === 1, String(saved.status));
        const shared = await call(USER_A, "POST", "/agent/groupings", { groups: [
            { name: "A", tag: "a", noteIds: [d1._id, d2._id] }, { name: "B", tag: "b", noteIds: [d2._id, c1._id] }] });
        const foreign = await call(USER_A, "POST", "/agent/groupings", { groups: [{ name: "A", tag: "a", noteIds: [d1._id, bNote._id] }] });
        const badTag = await call(USER_A, "POST", "/agent/groupings", { groups: [{ name: "A", tag: "Bad Tag!", noteIds: [d1._id, d2._id] }] });
        check("refused: shared notes, another user's notes, bad tag", shared.status === 400 && foreign.status === 400 && badTag.status === 400,
            [shared.status, foreign.status, badTag.status].join("/"));
        const gid = saved.data.groupingId;

        // 2. A group → review list for a new folder.
        const p1 = await call(USER_A, "POST", `/agent/groupings/${gid}/groups/0/propose`, { action: "new-folder" });
        const verdicts = Object.fromEntries((p1.data.candidates || []).map((c) => [c.noteId, c.verdict]));
        check("new-folder review list: group ticked, misfit unticked with its reason",
            p1.status === 201 && p1.data.action === "move" && p1.data.params.newFolderName === "Docker setup"
            && verdicts[d1._id] === "likely" && verdicts[d3._id] === "rejected"
            && p1.data.candidates.find((c) => c.noteId === d3._id).reason === "about a job application", String(p1.status));
        const foldersBefore = await Folder.countDocuments({ userId: USER_A, name: "Docker setup" });

        // 3. Apply creates the folder in the same transaction and moves the ticked notes.
        const a1 = await call(USER_A, "POST", `/agent/proposals/${p1.data.proposalId}/apply`, { noteIds: [d1._id, d2._id] });
        const created = await Folder.findOne({ userId: USER_A, name: "Docker setup", isDeleted: false }).lean();
        const moved = await Note.find({ _id: { $in: [d1._id, d2._id] } }).lean();
        check("apply creates the folder and moves the ticked notes into it",
            foldersBefore === 0 && created && a1.data?.receipt?.counts?.applied === 2
            && moved.every((n) => n.folderId === String(created._id)) && a1.data.receipt.params.createdFolderId === String(created._id),
            JSON.stringify(a1.data?.receipt?.counts));
        check("the misfit stayed where it was", (await Note.findById(d3._id).lean()).folderId === null);

        // 4. Undo moves them back and sends the now-empty folder to Trash.
        const u1 = await call(USER_A, "POST", `/agent/receipts/${a1.data.receipt.receiptId}/undo`);
        const afterUndo = await Folder.findById(created._id).lean();
        const back = await Note.find({ _id: { $in: [d1._id, d2._id] } }).lean();
        check("undo moves the notes back and trashes the empty folder (restorable)",
            u1.data?.receipt?.status === "undone" && back.every((n) => n.folderId === null)
            && afterUndo.isDeleted === true && afterUndo.isDeletedRoot === true && Boolean(afterUndo.deletedBatchId));

        // 5. Undo keeps the created folder when something else is in it now.
        const p2 = await call(USER_A, "POST", "/agent/proposals", { action: "move", params: { newFolderName: "Kitchen" },
            candidates: [{ noteId: c1._id }] });
        const a2 = await call(USER_A, "POST", `/agent/proposals/${p2.data.proposalId}/apply`, { noteIds: [c1._id] });
        const kitchen = a2.data.receipt.params.createdFolderId;
        await call(USER_A, "PUT", `/move-note/${c2._id}`, { targetFolderId: kitchen });   // the user adds a note
        const u2 = await call(USER_A, "POST", `/agent/receipts/${a2.data.receipt.receiptId}/undo`);
        check("undo keeps a created folder that has other notes in it",
            u2.data?.receipt?.status === "undone" && (await Folder.findById(kitchen).lean()).isDeleted === false
            && !u2.data.receipt.params.createdFolderTrashed);

        // 6. No folder is made when nothing actually moves.
        const p3 = await call(USER_A, "POST", "/agent/proposals", { action: "move", params: { newFolderName: "Never made" },
            candidates: [{ noteId: d1._id }] });
        await call(USER_A, "PUT", `/edit-note/${d1._id}`, { tags: ["changed"] });          // changed since the list
        const a3 = await call(USER_A, "POST", `/agent/proposals/${p3.data.proposalId}/apply`, { noteIds: [d1._id] });
        check("no folder created when every note is skipped", a3.data?.receipt?.counts?.skippedChanged === 1
            && !(await Folder.exists({ userId: USER_A, name: "Never made" })));
        const tooLong = await call(USER_A, "POST", "/agent/proposals", { action: "move", params: { newFolderName: "x".repeat(81) },
            candidates: [{ noteId: d1._id }] });
        check("new folder name over 80 chars refused", tooLong.status === 400, String(tooLong.status));

        // 7. A group → tag review list.
        const p4 = await call(USER_A, "POST", `/agent/groupings/${gid}/groups/1/propose`, { action: "tag" });
        const a4 = await call(USER_A, "POST", `/agent/proposals/${p4.data.proposalId}/apply`, { noteIds: [c1._id, c2._id] });
        const tagged = await Note.find({ _id: { $in: [c1._id, c2._id] } }).lean();
        check("tag review list applies the group's tag", p4.data.params?.add?.[0] === "cooking" && a4.data?.receipt?.counts?.applied === 2
            && tagged.every((n) => n.tags.includes("cooking")));

        // 8. Refusals.
        const bPropose = await call(USER_B, "POST", `/agent/groupings/${gid}/groups/0/propose`, { action: "tag" });
        const badAction = await call(USER_A, "POST", `/agent/groupings/${gid}/groups/0/propose`, { action: "trash" });
        const badIndex = await call(USER_A, "POST", `/agent/groupings/${gid}/groups/9/propose`, { action: "tag" });
        check("cross-user, bad action and unknown group refused", bPropose.status === 404 && badAction.status === 400 && badIndex.status === 404,
            [bPropose.status, badAction.status, badIndex.status].join("/"));
        await call(USER_A, "PUT", "/agent/settings", { organize: false });
        const off = await call(USER_A, "POST", "/agent/groupings", body);
        await call(USER_A, "PUT", "/agent/settings", { organize: true });
        check("organize off → grouping refused", off.status === 403, String(off.status));

        // 9. In a chat: group cards come back expired once the grouping is gone.
        const chatId = await appendTurns(USER_A, null, [
            { role: "user", text: "group my notes" },
            { role: "assistant", text: "live groups", citations: [], groupSuggestions: { groupingId: gid, groups: [] } },
            { role: "assistant", text: "old groups", citations: [], groupSuggestions: { groupingId: "gone-grouping", groups: [] } },
        ], { newChatTitle: "group my notes" });
        await AgentGrouping.updateOne({ groupingId: gid }, { $set: { chatId } });
        const turns = (await call(USER_A, "GET", `/agent/chats/${chatId}`)).data.turns;
        check("group cards: live ones usable, gone ones expired",
            turns.find((t) => t.text === "live groups").groupSuggestions.expired === false
            && turns.find((t) => t.text === "old groups").groupSuggestions.expired === true);
        const p5 = await call(USER_A, "POST", `/agent/groupings/${gid}/groups/1/propose`, { action: "new-folder" });
        const chatAfter = await AgentChat.findById(chatId).lean();
        check("opening a group's review list adds it to that chat", p5.status === 201
            && chatAfter.turns.some((t) => t.proposal?.proposalId === p5.data.proposalId));
        const openedFrom = `group:${gid}:1:new-folder`;
        check("the list records which button opened it (reply and saved chat)", p5.data.openedFrom === openedFrom
            && chatAfter.turns.find((t) => t.proposal?.proposalId === p5.data.proposalId)?.proposal.openedFrom === openedFrom,
            p5.data.openedFrom);
        // A split choice's list records its button too (exact filters → no AI check).
        await AgentSelection.create({
            selectionId: "test-selection-opened-from", userId: USER_A, chatId, action: "archive", params: { archived: true },
            filterReason: "matched", parts: [{ label: "Part 1", noteIds: [c1._id, c2._id] }],
        });
        const part = await call(USER_A, "POST", "/agent/selections/test-selection-opened-from/parts/0/open");
        const chatAfterPart = await AgentChat.findById(chatId).lean();
        check("a split choice's list records which button opened it", part.data?.openedFrom === "part:test-selection-opened-from:0"
            && chatAfterPart.turns.find((t) => t.proposal?.proposalId === part.data.proposalId)?.proposal.openedFrom === part.data.openedFrom,
            `${part.status} ${part.data?.openedFrom}`);
        await call(USER_A, "DELETE", `/agent/chats/${chatId}`);
        check("deleting the chat removes its groupings", !(await AgentGrouping.exists({ groupingId: gid })));
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
        // Only these throwaway users' records.
        await Note.deleteMany({ userId: { $in: users } });
        await Folder.deleteMany({ userId: { $in: users } });
        for (const Model of [AgentChat, AgentGrouping, AgentProposal, AgentReceipt, AgentSelection]) await Model.deleteMany({ userId: { $in: users } });
        await User.deleteMany({ _id: { $in: users } });
        await mongoose.connection.close();
        console.log(`\n${results.filter(Boolean).length}/${results.length} passed; cleanup done`);
        process.exitCode = results.every(Boolean) ? 0 : 1;
    }
})();
