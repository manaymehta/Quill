// Checks the app's own note routes (add/edit folder checks, move, archive,
// trash, restore) against a running Express, as one throwaway user. These
// routes share their rules with the agent's bulk Apply/Undo through
// services/note-actions.service.js — this proves the manual side behaves as it
// did before the rules were shared. Everything it creates is removed at the end.
//
// Usage (from backend/): node scripts/test-note-actions.js
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Folder = require("../models/folder.model");
const Note = require("../models/note.model");

const BASE = `http://localhost:${process.env.PORT || 8100}/v1`;
const USER = "000000000000000000000001";
const MISSING_ID = "0000000000000000000000ff";
const token = jwt.sign({ _id: USER, email: "note-actions@example.invalid", fullName: "Note Actions Test", tokenType: "access" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });

const call = async (method, p, body) => {
    const r = await fetch(BASE + p, {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
    const created = { notes: [], folders: [] };
    const note = async (body) => {
        const r = await call("POST", "/add-note", body);
        created.notes.push(r.data.note._id);
        return r.data.note;
    };
    const folder = async (name, parentId = null) => {
        const r = await call("POST", "/create-folder", { name, parentId });
        created.folders.push(r.data.folder._id);
        return r.data.folder;
    };
    // The DB copy, since get-note hides trashed notes.
    const raw = (id) => Note.findById(id).lean();
    // Puts a folder in Trash without touching its notes, to reach the
    // "note sits in a dead folder" cases directly.
    const killFolder = (id) => Folder.updateOne({ _id: id, userId: USER }, { $set: { isDeleted: true } });

    try {
        await mongoose.connect(process.env.MONGO_URI);
        const parent = await folder("NA parent");
        const child = await folder("NA child", parent._id);
        const other = await folder("NA other");

        // add-note folder checks
        const badAdd = await call("POST", "/add-note", { title: "x", folderId: "nope" });
        const missingAdd = await call("POST", "/add-note", { title: "x", folderId: MISSING_ID });
        check("add-note: malformed folder → 400, unknown folder → 404", badAdd.status === 400 && missingAdd.status === 404,
            `${badAdd.status}/${missingAdd.status}`);

        // move-note: the "show in home" rule
        const home = await note({ title: "NA home note", content: "a" });
        const m1 = await call("PUT", `/move-note/${home._id}`, { targetFolderId: other._id });
        check("move home note into a folder keeps it on Home", m1.data?.note?.folderId === other._id && m1.data.note.showInHome === true);

        const filed = await note({ title: "NA filed note", content: "b", folderId: other._id });
        const m2 = await call("PUT", `/move-note/${filed._id}`, { targetFolderId: child._id });
        check("move a filed (not on Home) note keeps it off Home", m2.data?.note?.folderId === child._id && m2.data.note.showInHome === false);

        const m3 = await call("PUT", `/move-note/${home._id}`, { targetFolderId: null });
        check("move out of all folders → unfiled, showInHome off", m3.data?.note?.folderId === null && m3.data.note.showInHome === false);

        const m4 = await call("PUT", `/move-note/${home._id}`, { targetFolderId: "nope" });
        const m5 = await call("PUT", `/move-note/${home._id}`, { targetFolderId: MISSING_ID });
        check("move-note: malformed → 400, unknown folder → 404", m4.status === 400 && m5.status === 404, `${m4.status}/${m5.status}`);

        // edit-note folder checks
        const e1 = await call("PUT", `/edit-note/${home._id}`, { folderId: "nope" });
        const e2 = await call("PUT", `/edit-note/${home._id}`, { folderId: MISSING_ID });
        const e3 = await call("PUT", `/edit-note/${home._id}`, { folderId: other._id });
        check("edit-note: malformed → 400, unknown → 404, valid → saved",
            e1.status === 400 && e2.status === 404 && e3.data?.note?.folderId === other._id, `${e1.status}/${e2.status}/${e3.status}`);

        // archive / unarchive
        const a0 = await call("PUT", `/update-note-archive/${filed._id}`, { isArchived: "yes" });
        check("archive: non-boolean → 400", a0.status === 400, String(a0.status));
        const a1 = await call("PUT", `/update-note-archive/${filed._id}`, { isArchived: true });
        check("archive sets isArchived and keeps the folder", a1.data?.note?.isArchived === true && a1.data.note.folderId === child._id);
        await killFolder(child._id);
        const a2 = await call("PUT", `/update-note-archive/${filed._id}`, { isArchived: false });
        check("unarchive out of a dead folder → nearest living parent", a2.data?.note?.isArchived === false && a2.data.note.folderId === parent._id,
            `folderId=${a2.data?.note?.folderId}`);

        // trash
        const t1 = await call("DELETE", `/delete-note/${filed._id}`);
        const trashed = await raw(filed._id);
        check("trash soft-deletes on its own (no batch)", t1.status === 200 && trashed.isDeleted === true && trashed.deletedAt && trashed.deletedBatchId === null);
        const t2 = await call("DELETE", `/delete-note/${filed._id}`);
        check("trashing again → 409", t2.status === 409, String(t2.status));
        const a3 = await call("PUT", `/update-note-archive/${filed._id}`, { isArchived: true });
        check("archiving a trashed note → 409", a3.status === 409, String(a3.status));

        // restore into a dead folder
        await Note.updateOne({ _id: filed._id }, { $set: { folderId: child._id } });   // child is dead
        const r1 = await call("PUT", `/restore-note/${filed._id}`);
        check("restore out of a dead folder → nearest living parent", r1.data?.note?.isDeleted === false && r1.data.note.folderId === parent._id,
            `folderId=${r1.data?.note?.folderId}`);
        const r2 = await call("PUT", `/restore-note/${filed._id}`);
        check("restoring a note that isn't trashed → 409", r2.status === 409, String(r2.status));

        // trashed together with its folder → must come back with the folder
        const inOther = await note({ title: "NA in other", content: "c", folderId: other._id });
        await call("DELETE", `/delete-folder/${other._id}`);
        const batch = await raw(inOther._id);
        const r3 = await call("PUT", `/restore-note/${inOther._id}`);
        check("note trashed with its folder can't be restored alone → 409",
            Boolean(batch.deletedBatchId) && r3.status === 409 && r3.data?.message === "Restore the containing folder instead", String(r3.status));
    } catch (error) {
        console.log("ERROR:", error.stack || error.message);
        results.push(false);
    } finally {
        // Bring back folders killed directly, so the normal routes can clean up.
        await Folder.updateMany({ _id: { $in: created.folders }, userId: USER, deletedBatchId: null }, { $set: { isDeleted: false } });
        for (const id of created.notes) {
            await call("DELETE", `/delete-note/${id}`);
            await call("DELETE", `/delete-trash-note/${id}`);
        }
        for (const id of [...created.folders].reverse()) {
            await call("DELETE", `/delete-folder/${id}`);
            await call("DELETE", `/delete-folder-permanent/${id}`);
        }
        // Anything the routes couldn't remove (only this test user's records).
        const leftNotes = await Note.deleteMany({ _id: { $in: created.notes }, userId: USER });
        const leftFolders = await Folder.deleteMany({ _id: { $in: created.folders }, userId: USER });
        await mongoose.connection.close();
        console.log(`\n${results.filter(Boolean).length}/${results.length} passed; cleanup done`
            + ` (removed directly: ${leftNotes.deletedCount} notes, ${leftFolders.deletedCount} folders)`);
        process.exitCode = results.every(Boolean) ? 0 : 1;
    }
})();
