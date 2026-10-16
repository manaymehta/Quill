"""Offline checks for grouping (agent/grouping.py): the meaning-based grouping
and the validation of the AI's naming answers. No network, no quota."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agent.grouping import _clean_tag, _GroupNaming, _Misfit, apply_naming, cluster_vectors  # noqa: E402

results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")


rng = np.random.default_rng(7)
DIM = 64
shared = rng.normal(size=DIM) * 3          # what every note has in common
centers = [rng.normal(size=DIM) for _ in range(3)]


def note_vec(center, spread=0.35):
    v = shared + center + rng.normal(size=DIM) * spread
    return v / np.linalg.norm(v)


# 3 topics × 4 notes, plus 3 loners on their own random topics.
vectors = [note_vec(c) for c in centers for _ in range(4)] + [note_vec(rng.normal(size=DIM) * 1.2, 0.1) for _ in range(3)]
truth = [t for t in range(3) for _ in range(4)] + [10, 11, 12]
groups = cluster_vectors(np.array(vectors))
pure = all(len({truth[i] for i in g}) == 1 for g in groups)
topic_groups = sorted(sorted(truth[i] for i in g) for g in groups if truth[g[0]] < 10)
check("three clear topics come out as three pure groups", pure and topic_groups == [[0] * 4, [1] * 4, [2] * 4],
      str([[truth[i] for i in g] for g in groups]))
check("loners stay ungrouped", all(truth[g[0]] < 10 for g in groups))
check("largest group first", [len(g) for g in groups] == sorted((len(g) for g in groups), reverse=True))
check("fewer than 2 notes → no groups", cluster_vectors(np.array(vectors[:1])) == [])

# A shared component alone must not glue everything together (centering).
same_ish = np.array([note_vec(rng.normal(size=DIM) * 1.5, 0.05) for _ in range(6)])
check("notes that only share 'being notes' aren't grouped together", all(len(g) < 6 for g in cluster_vectors(same_ish)))


def notes(prefix, n):
    return [{"noteId": f"{prefix}{i}", "title": f"{prefix} note {i}"} for i in range(n)]


g1, g2, g3, g4 = notes("a", 3), notes("b", 2), notes("c", 2), notes("d", 2)


def answer(group, name="", tag="", same_as=0, coherent=True, misfits=()):
    return _GroupNaming(group=group, name=name, tag=tag, sameAs=same_as, coherent=coherent,
                        misfits=[_Misfit(label=lbl, reason=r) for lbl, r in misfits])


final, ungrouped = apply_naming([g1, g2, g3, g4], [
    answer(1, "Docker setup", "Docker Setup!", misfits=[(3, "about a job application"), (9, "bad label")]),
    answer(2, "Cooking", "cooking"),
    answer(3, "More cooking", "food", same_as=2),
    answer(4, "Random", "misc", coherent=False),
])
names = [g["name"] for g in final]
check("sameAs merges a group into the earlier one", "Cooking" in names and "More cooking" not in names
      and len(next(g for g in final if g["name"] == "Cooking")["notes"]) == 4, str(names))
check("incoherent group dropped to ungrouped", "Random" not in names and {n["noteId"] for n in ungrouped} == {"d0", "d1"})
docker = next(g for g in final if g["name"] == "Docker setup")
check("misfits mapped by label; unknown labels ignored", docker["misfits"] == {"a2": "about a job application"}, str(docker["misfits"]))
check("tags cleaned to lowercase-dashes", docker["tag"] == "docker-setup", docker["tag"])

final, ungrouped = apply_naming([g1, g2], [])
check("no AI answers → plain names, nothing dropped", [g["name"] for g in final] == ["Group 1", "Group 2"] and not ungrouped)

final, _ = apply_naming([g1, g2], [answer(1, "X", coherent=False), answer(2, "Y", same_as=1)])
check("merging into a dropped group keeps the group on its own", [g["name"] for g in final] == ["Y"])

final, _ = apply_naming([g1, g2], [answer(2, "Late", same_as=5), answer(2, "Dup"), answer(7, "Bad")])
check("bad sameAs, duplicate and unknown group answers are ignored", sorted(g["name"] for g in final) == ["Group 1", "Late"],
      str([g["name"] for g in final]))
check("empty tag falls back to the name", _clean_tag("", "Job hunt") == "job-hunt" and _clean_tag("###", "") == "group")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
