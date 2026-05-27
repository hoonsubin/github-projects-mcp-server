# Impediment Lifecycle Playbook

> Covers the full lifecycle of a board impediment: creation, progress, and resolution.
> For initial logging only, see `audit-logging.md` + `scrum_log_impediment`.
> This playbook is referenced from `1_workflow.xml` for `ImpedimentResolution` requests.

---

## Lifecycle States

```
open → in_progress → resolved
```

- **open**: logged but nobody is actively working the blocker
- **in_progress**: someone is actively removing the blocker (waiting on a person, PR, approval, etc.)
- **resolved**: blocker cleared; sprint item may resume

---

## §creation — Logging a New Impediment

*Triggered by: human reports a blocker, or proactive detection (blocked item with no logged impediment).*

**Tool sequence:**
1. `scrum_find_items(types: ["impediment"])` — check for an existing open impediment that matches
   the reported blocker. Do not create a duplicate if one already exists.
2. If no match: `scrum_log_impediment` with:
   - `description`: full description of what is blocked and why
   - `affects`: `{ story: { id: <item ref.id> } }` — always link to the affected story when known
   - `raised_by`: login of the person who raised it (from `vocabulary.team` if available)
   - `priority`: highest-tier display name from `vocabulary.priority` (default when unspecified)
3. `scrum_update_story` on the affected story with `comment` noting the impediment was logged.
   Do not change the story's status automatically — confirm with the human first.

**SM moves:**
- *Blocker affects the whole sprint, not a single story*: use `affects: { sprint: "current" }`.
- *Multiple stories blocked by the same root cause*: log one impediment; link it to the primary
  story. Reference secondary stories in the description body.

---

## §progress — Moving to In-Progress

*Triggered by: human confirms someone is actively working the blocker.*

**Tool sequence:**
1. `scrum_find_items(types: ["impediment"])` — locate the open impediment by description or
   by calling `scrum_get_item_detail` on a known ref.
2. `scrum_update_impediment(ref, status: "in_progress")` — no resolution_notes needed yet.
3. Post a comment on the affected story: "Impediment [title] is now being actively worked."

**SM moves:**
- *Impediment in_progress for > 1 day*: surface at next standup. Ask: "What's the latest on [blocker]?"
- *Impediment in_progress for > 2 days*: escalate. Name the impediment explicitly and ask what
  external action is required to unblock it. This is the SM's escalation duty — do not wait for
  the team to ask.

---

## §resolution — Closing an Impediment

*Triggered by: human reports the blocker is cleared, or SM observes the affected story resumed.*

**Tool sequence:**
1. Locate the impediment ref:
   - If the human names it: `scrum_find_items(types: ["impediment"], search: "<keyword>")`
   - If the human has a story number: `scrum_get_item_detail(ref: { number: N })` → read
     `blocked_by` to find the linked impediment ref.id
2. `scrum_update_impediment(ref, status: "resolved", resolution_notes: "<how it was resolved>")` —
   `resolution_notes` is REQUIRED on resolution. Do not close an impediment without a note.
3. Post a comment on the originally affected story:
   "Impediment cleared: [summary of resolution]. Story is unblocked and may resume."
4. If the affected story's status is still "Blocked" (or equivalent from `vocabulary.status`):
   ask the human whether to move it back to its prior status, or confirm it should stay blocked
   for a different reason.

**SM moves:**
- *Human says "it's fine now" with no detail*: ask for one sentence: "What changed? I need to
  record the resolution." Do not close without it.
- *Resolution revealed a systemic issue* (same impediment type has appeared before):
  flag as a recurring impediment per `3_sm_stance.xml` dysfunction signal.
- *Story is still blocked after impediment resolved*: a new impediment exists — do not reopen the
  resolved one. Log a fresh impediment with the new description.

---

## Impediment Escalation Protocol

| Age       | Action                                                                                    |
|---|---|
| Day 0     | `scrum_log_impediment` — same-day, always                                                 |
| Day 1     | Surface at next session: "Impediment [X] has been open 1 day with no progress."           |
| Day 2+    | Escalate explicitly: name it, state the age, ask what external action is needed.          |
| 2 sprints | Flag as a recurring impediment type per `references/dysfunctions.md` §recurring_impediment |

Escalation is the SM's duty, not the team's. Do not wait to be asked.
