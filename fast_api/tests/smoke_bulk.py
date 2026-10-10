"""Offline check of step 3b (no network): split choices, the borderline
checker's validation (unknown/duplicate labels, re-ask, unjudged), the
likely/borderline sorting, and propose_bulk_change end to end with a fake
Express and a fake Gemini."""
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

    # Split choices.
    notes = ([{"noteId": nid(i), "folder": "College", "tags": ["react"] if i < 40 else ["vue"], "lastEdited": "2026-01-01"} for i in range(70)]
             + [{"noteId": nid(100 + i), "folder": None, "tags": [], "lastEdited": "2025-03-01"} for i in range(30)])
    parts = bulk.split_parts(notes)
    ids = [x for p in parts for x in p["noteIds"]]
    check("split: every note in exactly one part, none over 50",
          len(ids) == 100 and len(set(ids)) == 100 and all(len(p["noteIds"]) <= 50 for p in parts),
          str([(p["label"], len(p["noteIds"])) for p in parts]))
    check("split: by folder first, then by tag inside a big folder",
          [p["label"] for p in parts] == ["College · #react", "College · #vue", "No folder"])
    flat = [{"noteId": nid(i), "folder": None, "tags": [], "lastEdited": f"{2020 + i % 2}-06-01"} for i in range(80)]
    years = bulk.split_parts(flat)
    check("split: no folders/tags → by year", sorted(p["label"] for p in years) == ["Edited 2020", "Edited 2021"])
    same = [{"noteId": nid(i), "folder": None, "tags": [], "lastEdited": "2026-01-01"} for i in range(120)]
    rel = bulk.split_parts(same)
    check("split: nothing distinguishes them → by relevance, in order",
          [(p["label"], len(p["noteIds"])) for p in rel] == [("Most relevant 50", 50), ("Next 50", 50), ("Remaining 20", 20)]
          and rel[0]["noteIds"][0] == nid(0))

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
    exact_notes = [{"noteId": nid(i), "title": f"Old {i}", "folderId": None, "folder": None, "tags": [], "isArchived": False,
                    "lastEdited": "2025-01-01"} for i in range(3)]

    async def fake_express(ctx, method, path, summary, **kwargs):
        body = kwargs.get("json", {})
        calls.append((path, body))
        if path == "/v1/agent/select-notes":
            n = 3 if body["filters"].get("untitled") else 75
            return {"notes": exact_notes if n == 3 else [dict(exact_notes[0], noteId=nid(i), folder="F" if i < 40 else None) for i in range(n)],
                    "truncated": False}, None
        if path == "/v1/agent/proposals":
            return {"proposalId": "p1", "action": body["action"], "params": body["params"],
                    "candidates": [{"noteId": c["noteId"], "title": "t", "folder": None, "verdict": c["verdict"], "reason": c["reason"]} for c in body["candidates"]]}, None
        if path == "/v1/agent/selections":
            return {"selectionId": "s1", "params": body["params"], "parts": [{"index": i, "label": p["label"], "count": len(p["noteIds"])} for i, p in enumerate(body["parts"])]}, None
        return None, tools.error_result("x", "unexpected", recoverable=False, summary=summary)

    bulk._call_express = fake_express
    ctx2 = ToolContext(user_id="u", auth_header="Bearer x", express_base_url="http://x")
    r = await bulk.run_propose_bulk_change(ctx2, {"action": "archive", "filters": {"untitled": True, "notEditedForDays": 180}})
    check("tool: exact filters → complete list, all likely, reason from the filters, no AI",
          r.ok and r.proposal["proposalId"] == "p1" and len(r.proposal["candidates"]) == 3
          and r.proposal["candidates"][0]["reason"] == "untitled · not edited for 180+ days" and calls[0][0] == "/v1/agent/select-notes",
          r.proposal["candidates"][0]["reason"])
    check("tool: the model sees titles + verdicts only", "reviewList" in r.data and "texts" not in str(r.data) and "noteId" not in str(r.data))
    calls.clear()
    r2 = await bulk.run_propose_bulk_change(ctx2, {"action": "move", "targetFolderId": "none", "filters": {"tag": "old"}})
    sel = next(b for p, b in calls if p == "/v1/agent/selections")
    check("tool: >50 matches → split choices saved, no review list yet",
          r2.ok and r2.splitChoices["selectionId"] == "s1" and r2.proposal is None and r2.splitChoices["total"] == 75
          and [p["label"] for p in sel["parts"]] == ["F", "No folder"], str([p["label"] for p in sel["parts"]]))
    r3 = await bulk.run_propose_bulk_change(ctx2, {"action": "tag"})
    check("tool: tag without tags, or no filters/topic → recoverable error", not r3.ok and r3.error.recoverable)
    r4 = await bulk.run_propose_bulk_change(ctx2, {"action": "delete", "filters": {"tag": "x"}})
    check("tool: no delete action", not r4.ok)

    # Permission toggles (step 3d).
    import agent.loop as loop
    from agent.schemas import AgentScopes
    all_on = loop.allowed_tool_names(AgentScopes(compose=True, organize=True, destructive=True))
    read_only = loop.allowed_tool_names(AgentScopes(compose=False, organize=False))
    check("scopes: compose/organize off → draft, edit and bulk tools absent",
          {"draft_note", "stage_note_edit", "propose_bulk_change"} <= all_on
          and not ({"draft_note", "stage_note_edit", "propose_bulk_change"} & read_only) and "search_notes" in read_only)
    decl = {d.name: d for d in loop._function_declarations(all_on, allow_trash=False)}
    enum = decl["propose_bulk_change"].parameters.properties["action"].enum
    check("scopes: trash off → not even offered as an action", "trash" not in enum and "archive" in enum, str(enum))
    check("scopes: the registry's own schema is untouched", "trash" in bulk.PROPOSE_BULK_CHANGE_SCHEMA["properties"]["action"]["enum"])
    r5 = await bulk.run_propose_bulk_change(ctx2, {"action": "trash", "filters": {"tag": "x"}})
    check("scopes: the tool refuses trash when it's off (backstop)", not r5.ok and r5.error.code == "not_allowed")
    note = loop._scopes_note(AgentScopes(compose=False, organize=True, destructive=False))
    check("scopes: the model is told what's turned off", "drafting" in note and "trash" in note)

    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
