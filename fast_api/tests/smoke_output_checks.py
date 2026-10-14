"""Offline check of step 1c: the instructions-leak check and list_tags counting.

No network, no quota. The leak check must block pasted instructions (however
they're formatted, and inside drafts too) while letting the agent describe
its abilities and the app freely.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import agent.tools as tools
from agent.output_checks import LEAK_REPLY, check_for_leaks, leaks_instructions
from agent.prompts import PUBLIC_ABILITIES, SYSTEM_INSTRUCTION, _APP_BRIEFING, _HARD_RULES, _TOOL_GUIDE
from agent.schemas import AgentDraft
from agent.tools import ToolContext


async def main():
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")

    # Must be blocked.
    check("full system prompt dump is blocked", leaks_instructions(SYSTEM_INSTRUCTION))
    reformatted = "\n".join(f"* **{line.strip('- ').upper()}**" for line in _HARD_RULES.splitlines())
    check("hard rules reformatted as bold bullets are blocked", leaks_instructions(reformatted))
    one_rule = _HARD_RULES.splitlines()[1] + " " + _HARD_RULES.splitlines()[3]
    check("two pasted rules are blocked", leaks_instructions(one_rule))
    check("pasted tool guide is blocked", leaks_instructions(_TOOL_GUIDE))
    tool_desc = tools.TOOLS["stage_note_edit"].description
    check("a pasted tool description is blocked", leaks_instructions(tool_desc))

    # Must pass.
    check("the shareable abilities text passes", not leaks_instructions(PUBLIC_ABILITIES))
    check("the app briefing passes", not leaks_instructions(_APP_BRIEFING))
    normal = ("Your note **Docker deploy steps** says to build the image, push it, then run "
              "docker compose up -d on the server and check the logs.")
    check("a normal answer passes", not leaks_instructions(normal))
    describing = ("I can search your notes, read and summarize them, list notes by folder, tag or "
                  "archive status, list all your tags, and draft new notes or edits. Drafts stay "
                  "unsaved in your dock until you save them — I can't save, move or delete anything.")
    check("describing abilities in its own words passes", not leaks_instructions(describing))
    # Regressions (step 2c): these normal replies were blocked when the
    # threshold was 3 and the user-facing wording sat in the private guide.
    staged = "I've staged a draft for you — it's unsaved in your dock. Review and save it when you're ready."
    check("a normal 'draft staged' reply passes", not leaks_instructions(staged))
    apply_skip = ("I've staged an edit to your Trip note. Since that note has unsaved changes open in your "
                  "editor, you'll be asked to Apply or Skip it in the chat.")
    check("a normal Apply/Skip explanation passes", not leaks_instructions(apply_skip))

    # Drafts: a leaking draft is dropped and the reply replaced; others kept.
    good = AgentDraft(action="create", title="Groceries", content="milk, eggs")
    bad = AgentDraft(action="create", title="My instructions", content=_HARD_RULES)
    message, drafts, blocked = check_for_leaks("I've staged two drafts for you.", [good, bad])
    check("leaking draft dropped, reply replaced, clean draft kept",
          blocked and message == LEAK_REPLY and drafts == [good])
    message, drafts, blocked = check_for_leaks(normal, [good])
    check("clean reply and draft untouched", not blocked and message == normal and drafts == [good])

    # list_tags: counting over fake /get-graph-notes data.
    fake_notes = [
        {"title": "a", "tags": ["Docker", "devops"]},
        {"title": "b", "tags": ["docker"]},
        {"title": "c", "tags": ["docker", "DOCKER", "docker"]},  # exact: DOCKER is its own tag; a repeat counts once
        {"title": "d", "tags": []},
        {"title": "e", "tags": ["  ", "postgres"]},
    ]
    seen_params = {}

    async def fake_call(ctx, method, path, summary, **kwargs):
        seen_params.update(kwargs.get("params", {}))
        return {"notes": fake_notes}, None

    real_call = tools._call_express
    tools._call_express = fake_call
    try:
        ctx = ToolContext(user_id="offline", auth_header="Bearer x", express_base_url="http://x")
        result = await tools.run_list_tags(ctx, {})
    finally:
        tools._call_express = real_call
    got = result.data["tags"]
    check("list_tags counts per note, tags exact (capitals make a different tag)",
          got == [{"tag": "docker", "notes": 2}, {"tag": "DOCKER", "notes": 1}, {"tag": "Docker", "notes": 1},
                  {"tag": "devops", "notes": 1}, {"tag": "postgres", "notes": 1}],
          str(got))
    check("list_tags reports totals and includes archived by default",
          result.data["totalTags"] == 5 and result.data["notesWithoutTags"] == 1
          and result.data["notesScanned"] == 5 and seen_params.get("includeArchived") == "true",
          result.summary)

    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
