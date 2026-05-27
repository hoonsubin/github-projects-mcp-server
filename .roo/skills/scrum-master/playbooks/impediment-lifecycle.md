# Impediment Lifecycle Playbook

Lifecycle: `open → in_progress → resolved`
- open: logged, nobody actively working the blocker
- in_progress: someone is actively removing it
- resolved: blocker cleared; sprint item may resume

## §creation — Log a New Impediment

Triggered by: human reports a blocker, or proactive detection (blocked item with no logged impediment).

1. `scrum_find_items(types: ["impediment"])` — check for an existing open impediment matching the
   reported blocker. Do not create a duplicate.
2. If no match: `scrum_log_impediment` with:
   - `description`: what is blocked and why
   - `affects`: `{ story: { id: <item ref.id> } }` — link to affected story when known
   - `raised_by`: login from `vocabulary.team` if available
   - `priority`: highest-tier display name from `vocabulary.priority`
3. `scrum_update_story` on the affected story with comment noting the impediment was logged.
   Do not change story status automatically — confirm with human first.

SM moves:
- Blocker affects whole sprint, not a single story: `affects: { sprint: "current" }`.
- Multiple stories blocked by same root cause: log one impediment; link to primary story;
  reference secondary stories in the description body.

## §progress — Move to In-Progress

Triggered by: human confirms someone is actively working the blocker.

1. Locate the impediment: `scrum_find_items(types: ["impediment"])` or `scrum_get_story` on known ref.
2. `scrum_update_impediment(ref, status: "in_progress")`
3. Comment on affected story: "Impediment [title] is now being actively worked."

SM moves:
- In_progress >1 day: surface at next session. "What's the latest on [blocker]?"
- In_progress >2 days: escalate. Name it, state age, ask what external action is needed.

## §resolution — Close an Impediment

Triggered by: human reports blocker cleared, or SM observes affected story resumed.

1. Locate ref:
   - Human names it: `scrum_find_items(types: ["impediment"], search: "<keyword>")`
   - Human has story number: `scrum_get_story(ref: { number: N })` → read `blocked_by`
2. `scrum_update_impediment(ref, status: "resolved", resolution_notes: "<how resolved>")` —
   `resolution_notes` is REQUIRED. Do not close without it.
3. Comment on originally affected story: "Impediment cleared: [summary]. Story is unblocked."
4. If story status is still "Blocked": ask whether to move it back to prior status, or confirm
   it's still blocked for a different reason.

SM moves:
- Human says "it's fine now" with no detail: "What changed? I need to record the resolution."
- Resolution revealed a systemic issue: flag as recurring per `3_sm_stance.xml` dysfunction signals.
- Story still blocked after impediment resolved: log a fresh impediment — do not reopen resolved one.

## Escalation Protocol

| Age | Action |
|---|---|
| Day 0 | `scrum_log_impediment` — same-day, always |
| Day 1 | Surface: "Impediment [X] has been open 1 day with no progress." |
| Day 2+ | Escalate: name it, state age, ask what external action is needed |
| 2 sprints | Flag as recurring impediment type per `references/dysfunctions.md` |

Escalation is the SM's duty, not the team's.
