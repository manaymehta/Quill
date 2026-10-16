"""Offline check of step 3b (no network): the borderline checker's
validation (unknown/duplicate labels, re-ask, unjudged), the
likely/borderline sorting, and propose_bulk_change end to end with a fake
Express and a fake Gemini: several changes per call, one list per reply
(`replaces`), the chat passed on, exact tags, split choices from Express.
(Combining per note and splitting are Express's: test-agent-multi-change.js.)"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import agent.bulk as bulk
import agent.tools as tools
from agent.tools import ToolContext


def nid(i: int) -> str:
    return f"{i:024x}"


class FakeResponse:
    def __init__(self, parsed):
        self.parsed = parsed


class FakeChecker:
    """Answers the checker: isAbout when the note title contains 'docker'.
    `drop` labels are left out on the first ask (to test the re-ask)."""

    def __init__(self, drop_first=(), always_drop=(), extra_bad=False):
        self.calls = 0
        self.drop_first = set(drop_first)
        self.always_drop = set(always_drop)
        self.extra_bad = extra_bad
        self.aio = self
        self.models = self

    async def generate_content(self, model, contents, config):
        self.calls += 1
        lines = [line for line in contents.splitlines() if line.startswith("[") and "] <note_data" in line]
        out = []
        for line in lines:
            label = int(line[1:line.index("]")])
            title = line.split('title="', 1)[1].split('"', 1)[0]
            if title in self.always_drop or (self.calls == 1 and title in self.drop_first):
                continue
            out.append(bulk._Verdict(label=label, isAbout="docker" in title.lower(), reason=f"judged {title}"))
        if self.extra_bad:
            out.append(bulk._Verdict(label=999, isAbout=True, reason="bogus"))      # unknown label
            if out:
                out.append(bulk._Verdict(label=out[0].label, isAbout=not out[0].isAbout, reason="dup"))  # duplicate
        return FakeResponse(out)


async def main():
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")

    # The checker's validation.
    items = [{"noteId": nid(i), "title": t, "texts": ["text"], "strong": False, "keywordHit": False}
             for i, t in enumerate(["Docker deploy", "Groceries", "Docker swarm", "Recipes"])]
    fc = FakeChecker(drop_first={"Groceries"})
    verdicts = await bulk.check_borderline(fc, "docker", items)
    check("checker: verdicts mapped back to the right notes",
          verdicts[nid(0)][0] == "likely" and verdicts[nid(2)][0] == "likely" and verdicts[nid(3)][0] == "rejected")
    check("checker: a missing answer is asked again once", verdicts[nid(1)] == ("rejected", "judged Groceries") and fc.calls == 2)
    fc2 = FakeChecker(always_drop={"Recipes"}, extra_bad=True)
    verdicts2 = await bulk.check_borderline(fc2, "docker", items)
    check("checker: still missing → unjudged; unknown and duplicate labels ignored",
          verdicts2[nid(3)][0] == "unjudged" and verdicts2[nid(0)] == ("likely", "judged Docker deploy"), str(verdicts2[nid(0)]))
    many = [{"noteId": nid(i), "title": f"Note {i}", "texts": ["t"], "strong": False, "keywordHit": False} for i in range(23)]
    fc3 = FakeChecker()
    await bulk.check_borderline(fc3, "x", many)
    check("checker: notes go in groups of ~10", fc3.calls == 3)

    # Sorting: ≤15 all checked; >15 strong+keyword skip the checker.
    ctx = ToolContext(user_id="u", auth_header="Bearer x", express_base_url="http://x", gemini_client=FakeChecker())
    big = [{"noteId": nid(i), "title": f"Docker {i}" if i % 2 else f"Other {i}", "texts": ["t"],
            "strong": i < 6, "keywordHit": i < 6} for i in range(20)]
    judged = await bulk.judge(ctx, "docker", ["docker"], big)
    check("sorting: >15 → strong+keyword are likely without AI, the rest judged",
          all(c["verdict"] == "likely" and "strong match" in c["reason"] for c in judged[:6])
          and ctx.gemini_client.calls == 2 and judged[7]["verdict"] == "likely" and judged[8]["verdict"] == "rejected")

    # propose_bulk_change end to end (fake Express).
    calls = []
    exact_notes = [{"noteId": nid(i), "title": f"Old {i}", "folderId": None, "folder": None, "tags": ["old"], "isArchived": False,
                    "lastEdited": "2025-01-01"} for i in range(3)]
    express_split = {"on": False}

    async def fake_express(ctx, method, path, summary, **kwargs):
        body = kwargs.get("json", {})
        calls.append((path, body))
        if path == "/v1/agent/select-notes":
            if body["filters"].get("tag") == "Old":     # exact tags: no note has "Old"
                return {"notes": [], "truncated": False}, None
            return {"notes": exact_notes, "truncated": False}, None
        if path == "/v1/agent/proposals":
            if express_split["on"]:
                return {"splitChoices": {"selectionId": "s1", "total": 75, "changes": [], "parts": [{"index": 0, "label": "A", "count": 50},
                        {"index": 1, "label": "B", "count": 25}]}}, None
            changes = [{"key": f"c{i + 1}", "action": c["action"], "params": c["params"], "title": f"change {i + 1}"} for i, c in enumerate(body["changes"])]
            note_ids = list(dict.fromkeys(cand["noteId"] for c in body["changes"] for cand in c["candidates"]))
            candidates = [{"noteId": n, "title": "t", "folder": None, "items": [
                {"change": f"c{i + 1}", "verdict": cand["verdict"], "reason": cand["reason"], "label": f"label {i + 1}", "clashesWith": []}
                for i, c in enumerate(body["changes"]) for cand in c["candidates"] if cand["noteId"] == n]} for n in note_ids]
            held = body["mode"] == "separate"
            return {"proposalId": body.get("heldId") or ("h1" if held else "p1"), "status": "held" if held else "open", "version": 1,
                    "heldReason": "separate" if held else None, "changes": changes, "candidates": candidates, "groups": [],
                    "openedFrom": [], "clashCount": 0, "extended": False}, None
        return None, tools.error_result("x", "unexpected", recoverable=False, summary=summary)

    bulk._call_express = fake_express
    ctx2 = ToolContext(user_id="u", auth_header="Bearer x", express_base_url="http://x")
    r = await bulk.run_propose_bulk_change(ctx2, {"changes": [{"action": "archive", "filters": {"untitled": True, "notEditedForDays": 180}}]})
    sent = next(b for p, b in calls if p == "/v1/agent/proposals")
    check("tool: exact filters → complete list, all likely, reason from the filters, no AI",
          r.ok and r.proposal["proposalId"] == "p1" and len(r.proposal["candidates"]) == 3
          and sent["changes"][0]["candidates"][0]["reason"] == "untitled · not edited for 180+ days" and calls[0][0] == "/v1/agent/select-notes",
          str(sent["changes"][0]["candidates"][0]))
    check("tool: the model sees titles + change labels only", "reviewList" in r.data and "texts" not in str(r.data)
          and "noteId" not in str(r.data) and "label 1" in str(r.data))
    check("tool: nothing pending → the changes start the list", sent["mode"] == "add" and sent["split"] is True
          and ctx2.bulk_draft == {"addedToPending": True})

    calls.clear()
    r2 = await bulk.run_propose_bulk_change(ctx2, {"changes": [
        {"action": "tag", "removeTags": ["old"], "addTags": ["oldz"], "filters": {"tag": "old"}},
        {"action": "tag", "removeTags": ["Old"], "addTags": ["Oldz"], "filters": {"tag": "Old"}},
    ]})
    sent2 = next(b for p, b in calls if p == "/v1/agent/proposals")
    check("tool: several changes in one call", r2.ok and len(sent2["changes"]) == 1 and sent2["mode"] == "add")
    check("tool: a tag no note has exactly is reported, the other changes go ahead",
          "Old" in str(r2.data.get("problems")) and "exactly" in str(r2.data.get("problems")), str(r2.data.get("problems")))

    # A list is already waiting (one per account): add-on or separate task.
    pending = {"proposalId": "p0", "changes": ["#a → #b"], "notes": 2}
    ctx3 = ToolContext(user_id="u", auth_header="Bearer x", express_base_url="http://x", chat_id="a" * 24, pending_list=pending)
    calls.clear()
    r3 = await bulk.run_propose_bulk_change(ctx3, {"changes": [{"action": "archive", "filters": {"tag": "old"}}], "addToPending": False})
    sent3 = next(b for p, b in calls if p == "/v1/agent/proposals")
    check("tool: a separate task while a list waits → held; the chat is passed on",
          sent3["mode"] == "separate" and sent3["chatId"] == "a" * 24 and r3.proposal["status"] == "held"
          and ctx3.bulk_draft == {"heldId": "h1"} and "held" in r3.data["note"].lower())
    calls.clear()
    await bulk.run_propose_bulk_change(ctx3, {"changes": [{"action": "tag", "addTags": ["x"], "filters": {"tag": "old"}}]})
    sent4 = next(b for p, b in calls if p == "/v1/agent/proposals")
    check("tool: the reply's next separate change extends its held list", sent4["mode"] == "separate" and sent4["heldId"] == "h1")
    ctx4 = ToolContext(user_id="u", auth_header="Bearer x", express_base_url="http://x", pending_list=pending)
    calls.clear()
    await bulk.run_propose_bulk_change(ctx4, {"changes": [{"action": "archive", "filters": {"tag": "old"}}], "addToPending": True})
    await bulk.run_propose_bulk_change(ctx4, {"changes": [{"action": "archive", "filters": {"tag": "old"}}], "addToPending": False})
    modes = [b["mode"] for p, b in calls if p == "/v1/agent/proposals"]
    check("tool: an add-on goes into the waiting list; once added, the reply keeps adding", modes == ["add", "add"], str(modes))
    import agent.loop as loop_module
    note = loop_module._pending_note(pending)
    check("loop: the model is told about the waiting list and addToPending", "#a → #b" in note and "addToPending" in note
          and "No review list is waiting" in loop_module._pending_note(None))

    express_split["on"] = True
    r4 = await bulk.run_propose_bulk_change(ctx2, {"changes": [{"action": "move", "targetFolderId": "none", "filters": {"tag": "old"}}]})
    check("tool: Express says too many → split choices, no review list",
          r4.ok and r4.splitChoices["selectionId"] == "s1" and r4.proposal is None)
    express_split["on"] = False

    r5 = await bulk.run_propose_bulk_change(ctx2, {"changes": [{"action": "tag"}]})
    check("tool: tag without tags, or no filters/topic → recoverable error", not r5.ok and r5.error.recoverable)
    r6 = await bulk.run_propose_bulk_change(ctx2, {"changes": [{"action": "delete", "filters": {"tag": "x"}}]})
    check("tool: no delete action", not r6.ok)
    r7 = await bulk.run_propose_bulk_change(ctx2, {"changes": [{"action": "tag", "addTags": ["x"], "filters": {"tag": "old"}}] * 11})
    check("tool: at most 10 changes per call", not r7.ok)

    # Permission toggles (step 3d).
    import agent.loop as loop
    from agent.schemas import AgentScopes
    all_on = loop.allowed_tool_names(AgentScopes(compose=True, organize=True, destructive=True))
    read_only = loop.allowed_tool_names(AgentScopes(compose=False, organize=False))
    check("scopes: compose/organize off → draft, edit and bulk tools absent",
          {"draft_note", "stage_note_edit", "propose_bulk_change"} <= all_on
          and not ({"draft_note", "stage_note_edit", "propose_bulk_change"} & read_only) and "search_notes" in read_only)
    decl = {d.name: d for d in loop._function_declarations(all_on, allow_trash=False)}
    enum = decl["propose_bulk_change"].parameters.properties["changes"].items.properties["action"].enum
    check("scopes: trash off → not even offered as an action", "trash" not in enum and "archive" in enum, str(enum))
    check("scopes: the registry's own schema is untouched", "trash" in bulk.CHANGE_SCHEMA["properties"]["action"]["enum"])
    r8 = await bulk.run_propose_bulk_change(ctx2, {"changes": [{"action": "trash", "filters": {"tag": "x"}}]})
    check("scopes: the tool refuses trash when it's off (backstop)", not r8.ok and r8.error.code == "not_allowed")
    note = loop._scopes_note(AgentScopes(compose=False, organize=True, destructive=False))
    check("scopes: the model is told what's turned off", "drafting" in note and "trash" in note)

    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
