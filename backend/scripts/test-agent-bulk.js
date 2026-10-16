// Step 3a test: the agent's bulk changes against a running Express (port from
// backend/.env PORT, default 8100), as two throwaway users. Everything it
// creates is removed at the end, and receipts/proposals are deleted directly.
//
// Covers: happy path, idempotent re-apply, skip-if-changed, undo with
// compare-before-revert, trash + undo, cross-user refusal (must fail),
// >50 refused, and the TTL indexes.
//
// Usage (from backend/): node scripts/test-agent-bulk.js
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AgentProposal = require("../models/agent-proposal.model");
const AgentReceipt = require("../models/agent-receipt.model");
const User = require("../models/user.model");

const BASE = `http://localhost:${process.env.PORT || 8100}/v1`;
const USER_A = "000000000000000000000001";
const USER_B = "000000000000000000000002";
const token = (id) => jwt.sign({ _id: id, email: `bulk-${id.slice(-1)}@example.invalid`, fullName: "Bulk Test", tokenType: "access" },
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
    const created = { notes: { [USER_A]: [], [USER_B]: [] }, folders: { [USER_A]: [], [USER_B]: [] }, proposals: [] };
    const note = async (user, body) => {
        const r = await call(user, "POST", "/add-note", body);
        created.notes[user].push(r.data.note._id);
        return r.data.note;
    };
    const folder = async (user, name) => {
        const r = await call(user, "POST", "/create-folder", { name });
        const f = r.data.folder;
        created.folders[user].push(f._id);
        return f;
    };
    const getNote = async (user, id) => (await call(user, "GET", `/get-note/${id}`)).data?.note;
    const propose = async (user, body) => {
        const r = await call(user, "POST", "/agent/proposals", body);
        if (r.data?.proposalId) created.proposals.push(r.data.proposalId);
        return r;
    };

    try {
        await mongoose.connect(process.env.MONGO_URI);
        // Temporary user records, so the permission toggles can be changed.
        await User.deleteMany({ _id: { $in: [USER_A, USER_B] } });
        await User.create([
            { _id: USER_A, email: "bulk-test-a@example.invalid", fullName: "Bulk Test A" },
            { _id: USER_B, email: "bulk-test-b@example.invalid", fullName: "Bulk Test B" },
        ]);
        const fA = await folder(USER_A, "Bulk test folder");
        const fB = await folder(USER_B, "Other user's folder");
        const n1 = await note(USER_A, { title: "Bulk one", content: "first", tags: ["alpha"] });
        const n2 = await note(USER_A, { title: "Bulk two", content: "second", tags: ["alpha"] });
        const n3 = await note(USER_A, { title: "Bulk three", content: "third" });
        const nB = await note(USER_B, { title: "B's private note", content: "not yours" });

        // 1. Happy path: move 2 of 3 listed notes into A's folder.
        const p1 = await propose(USER_A, { action: "move", params: { targetFolderId: fA._id }, instruction: "move to folder",
            candidates: [n1, n2, n3].map((n) => ({ noteId: n._id, verdict: "likely", reason: "test" })) });
        check("proposal saved", p1.status === 201 && p1.data.candidates.length === 3 && p1.data.params.targetFolderName === "Bulk test folder", String(p1.status));
        const a1 = await call(USER_A, "POST", `/agent/proposals/${p1.data.proposalId}/apply`, { noteIds: [n1._id, n2._id] });
        const moved = await getNote(USER_A, n1._id);
        const untouched = await getNote(USER_A, n3._id);
        check("apply moves only the ticked notes", a1.data?.receipt?.counts?.applied === 2 && moved.folderId === fA._id && untouched.folderId === null,
            JSON.stringify(a1.data?.receipt?.counts));
        check("move from home sets showInHome like the app does", moved.showInHome === true);

        // 2. Idempotent: pressing Apply again returns the same receipt.
        const a1again = await call(USER_A, "POST", `/agent/proposals/${p1.data.proposalId}/apply`, { noteIds: [n1._id, n2._id] });
        check("re-apply returns the same receipt, no double apply",
            a1again.data?.alreadyApplied === true && a1again.data.receipt.receiptId === a1.data.receipt.receiptId);

        // 3. Skip-if-changed: the user edits a listed note before Apply.
        const p2 = await propose(USER_A, { action: "archive", params: { archived: true },
            candidates: [n1, n3].map((n) => ({ noteId: n._id })) });
        await call(USER_A, "PUT", `/edit-note/${n3._id}`, { tags: ["changed-by-user"] });
        const a2 = await call(USER_A, "POST", `/agent/proposals/${p2.data.proposalId}/apply`, { noteIds: [n1._id, n3._id] });
        const ops2 = Object.fromEntries(a2.data.receipt.ops.map((o) => [o.noteId, o.status]));
        check("a note changed since the review list is skipped and reported",
            ops2[n1._id] === "applied" && ops2[n3._id] === "skipped-changed" && (await getNote(USER_A, n3._id)).isArchived === false,
            JSON.stringify(ops2));

        // 4. Undo with compare-before-revert: tag n1 + n2, user hand-edits n2, undo.
        const p3 = await propose(USER_A, { action: "tag", params: { add: ["beta"], remove: ["alpha"] },
            candidates: [n1, n2].map((n) => ({ noteId: n._id })) });
        const a3 = await call(USER_A, "POST", `/agent/proposals/${p3.data.proposalId}/apply`, { noteIds: [n1._id, n2._id] });
        check("tag action applied", a3.data.receipt.counts.applied === 2
            && JSON.stringify((await getNote(USER_A, n1._id)).tags) === JSON.stringify(["beta"]));
        await call(USER_A, "PUT", `/edit-note/${n2._id}`, { tags: ["beta", "my-own-tag"] });
        const u3 = await call(USER_A, "POST", `/agent/receipts/${a3.data.receipt.receiptId}/undo`);
        const opsU = Object.fromEntries(u3.data.receipt.ops.map((o) => [o.noteId, o.status]));
        const n1after = await getNote(USER_A, n1._id);
        const n2after = await getNote(USER_A, n2._id);
        check("undo restores untouched notes and leaves the hand-edited one alone",
            opsU[n1._id] === "undone" && JSON.stringify(n1after.tags) === JSON.stringify(["alpha"])
            && opsU[n2._id] === "undo-skipped" && n2after.tags.includes("my-own-tag")
            && u3.data.receipt.status === "partially-undone", JSON.stringify(opsU));
        const u3again = await call(USER_A, "POST", `/agent/receipts/${a3.data.receipt.receiptId}/undo`);
        check("undo can't run twice", u3again.status === 409);

        // 5. Permission toggles: trash is off by default; turned on, it works.
        const defaults = await call(USER_A, "GET", "/agent/settings");
        check("settings default: compose + organize on, destructive off",
            JSON.stringify(defaults.data.scopes) === JSON.stringify({ compose: true, organize: true, destructive: false }));
        const refused = await propose(USER_A, { action: "trash", candidates: [{ noteId: n2._id }] });
        check("trash refused while destructive is off", refused.status === 403, String(refused.status));
        const enabled = await call(USER_A, "PUT", "/agent/settings", { destructive: true });
        check("turning destructive on", enabled.data?.scopes?.destructive === true);
        await call(USER_A, "PUT", "/agent/settings", { organize: false });
        const noOrganize = await propose(USER_A, { action: "tag", params: { add: ["x"] }, candidates: [{ noteId: n2._id }] });
        check("organize off → bulk changes refused", noOrganize.status === 403);
        await call(USER_A, "PUT", "/agent/settings", { organize: true });

        // 6. Trash + undo.
        const p4 = await propose(USER_A, { action: "trash", candidates: [{ noteId: n2._id }] });
        const a4 = await call(USER_A, "POST", `/agent/proposals/${p4.data.proposalId}/apply`, { noteIds: [n2._id] });
        // get-note hides trashed notes, so look in the Trash list.
        const trashList = (await call(USER_A, "GET", "/get-trash-notes")).data.notes || [];
        check("trash action soft-deletes (recoverable)", a4.data.receipt.counts.applied === 1
            && trashList.some((n) => n._id === n2._id), JSON.stringify(a4.data.receipt.counts));
        const u4 = await call(USER_A, "POST", `/agent/receipts/${a4.data.receipt.receiptId}/undo`);
        check("undo brings it back from the trash, in its folder", u4.data.receipt.status === "undone"
            && (await getNote(USER_A, n2._id))?.folderId === fA._id);  // get-note only returns non-trashed notes

        // 6b. Undo never pulls a note out of a folder that went to Trash with it
        // (same rule as the app's own Restore).
        const fT = await folder(USER_A, "Bulk trash-with-folder");
        const nT = await note(USER_A, { title: "Bulk in folder", content: "batch", folderId: fT._id });
        const p5 = await propose(USER_A, { action: "trash", candidates: [{ noteId: nT._id }] });
        const a5 = await call(USER_A, "POST", `/agent/proposals/${p5.data.proposalId}/apply`, { noteIds: [nT._id] });
        await call(USER_A, "PUT", `/restore-note/${nT._id}`);      // user restores it…
        await call(USER_A, "DELETE", `/delete-folder/${fT._id}`);  // …then trashes the whole folder
        const u5 = await call(USER_A, "POST", `/agent/receipts/${a5.data.receipt.receiptId}/undo`);
        const stillTrashed = ((await call(USER_A, "GET", "/get-trash-notes")).data.notes || []).every((n) => n._id !== nT._id)
            && !(await getNote(USER_A, nT._id));   // batch notes aren't in the Trash list or get-note
        check("undo skips a note trashed together with its folder", u5.data?.receipt?.counts?.undoSkipped === 1 && stillTrashed,
            JSON.stringify(u5.data?.receipt?.counts));

        // 6c. Apply refuses a move whose target folder went to Trash after the list was made.
        const fGone = await folder(USER_A, "Bulk gone folder");
        const p6 = await propose(USER_A, { action: "move", params: { targetFolderId: fGone._id }, candidates: [{ noteId: n3._id }] });
        await call(USER_A, "DELETE", `/delete-folder/${fGone._id}`);
        const a6 = await call(USER_A, "POST", `/agent/proposals/${p6.data.proposalId}/apply`, { noteIds: [n3._id] });
        const noReceipt = !(await AgentReceipt.findOne({ proposalId: p6.data.proposalId }).lean());
        check("apply refuses a move into a folder now in Trash", a6.status === 409 && noReceipt
            && (await getNote(USER_A, n3._id))?.folderId === null, String(a6.status));

        // 6. Cross-user: every route must refuse B acting on A's items and vice versa.
        const pA = await propose(USER_A, { action: "archive", params: { archived: true }, candidates: [{ noteId: n3._id }] });
        const bApplies = await call(USER_B, "POST", `/agent/proposals/${pA.data.proposalId}/apply`, { noteIds: [n3._id] });
        const bUndoes = await call(USER_B, "POST", `/agent/receipts/${a1.data.receipt.receiptId}/undo`);
        const bProposesA = await propose(USER_B, { action: "tag", params: { add: ["hijack"] }, candidates: [{ noteId: n1._id }] });
        const aIntoB = await propose(USER_A, { action: "move", params: { targetFolderId: fB._id }, candidates: [{ noteId: n1._id }] });
        const aProposesB = await propose(USER_A, { action: "trash", candidates: [{ noteId: nB._id }] });
        const bList = await call(USER_B, "GET", "/agent/receipts");
        check("cross-user: B can't apply A's proposal", bApplies.status === 404, String(bApplies.status));
        check("cross-user: B can't undo A's receipt", bUndoes.status === 404, String(bUndoes.status));
        check("cross-user: B can't propose A's notes", bProposesA.status === 400, String(bProposesA.status));
        check("cross-user: A can't move into B's folder", aIntoB.status === 400, String(aIntoB.status));
        check("cross-user: A can't propose B's notes", aProposesB.status === 400, String(aProposesB.status));
        check("cross-user: B's activity log doesn't show A's receipts", bList.data.receipts.every((r) => r.proposalId !== p1.data.proposalId));
        check("cross-user: nothing changed for either user", (await getNote(USER_A, n3._id)).isArchived === false && Boolean(await getNote(USER_B, nB._id)));

        // 7. Limits and validation.
        const tooMany = await call(USER_A, "POST", "/agent/proposals", { action: "trash",
            candidates: Array.from({ length: 51 }, (_, i) => ({ noteId: (i + 1).toString(16).padStart(24, "0") })) });
        check("more than 50 notes refused", tooMany.status === 400);
        const notListed = await call(USER_A, "POST", `/agent/proposals/${pA.data.proposalId}/apply`, { noteIds: [n1._id] });
        check("only notes from the review list can be applied", notListed.status === 400);
        const badAction = await call(USER_A, "POST", "/agent/proposals", { action: "delete", candidates: [{ noteId: n1._id }] });
        check("no permanent-delete action exists", badAction.status === 400);

        // 8. TTL indexes.
        const pIdx = await AgentProposal.collection.indexes();
        const rIdx = await AgentReceipt.collection.indexes();
        const ttl = (idx) => idx.find((i) => i.expireAfterSeconds !== undefined)?.expireAfterSeconds;
        check("TTL indexes present (proposals 3 days, receipts 10 days)", ttl(pIdx) === 3 * 86400 && ttl(rIdx) === 10 * 86400,
            `${ttl(pIdx)} / ${ttl(rIdx)}`);
        check("proposalId unique on both collections",
            pIdx.some((i) => i.key.proposalId && i.unique) && rIdx.some((i) => i.key.proposalId && i.unique));
    } catch (error) {
        console.log("ERROR:", error.stack || error.message);
        results.push(false);
    } finally {
        for (const user of [USER_A, USER_B]) {
            for (const id of created.notes[user]) {
                await call(user, "DELETE", `/delete-note/${id}`);
                await call(user, "DELETE", `/delete-trash-note/${id}`);
            }
            for (const id of created.folders[user]) {
                await call(user, "DELETE", `/delete-folder/${id}`);
                await call(user, "DELETE", `/delete-folder-permanent/${id}`);
            }
        }
        await AgentProposal.deleteMany({ userId: { $in: [USER_A, USER_B] } });
        await AgentReceipt.deleteMany({ userId: { $in: [USER_A, USER_B] } });
        await User.deleteMany({ _id: { $in: [USER_A, USER_B] } });
        await mongoose.connection.close();
        console.log(`\n${results.filter(Boolean).length}/${results.length} passed; cleanup done`);
        process.exitCode = results.every(Boolean) ? 0 : 1;
    }
})();
