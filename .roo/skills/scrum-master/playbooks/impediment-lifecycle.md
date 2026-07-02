# Impediment Lifecycle Playbook

Lifecycle: `open → in_progress → resolved`
- open: logged, nobody actively working the blocker
- in_progress: someone is actively removing it
- resolved: blocker cleared; sprint item may resume

## §creation - Log a New Impediment

Triggered by: human reports a blocker, or proactive detection (blocked item with no logged impediment).

1. Check for an existing open impediment matching the reported blocker. Do not create a duplicate.
2. If no match: log the new impediment, capturing:
   - What is blocked and why
   - The affected story, linked, when known
   - Who raised it, when available
   - Priority - highest tier by default
3. Comment on the affected story noting the impediment was logged.
   Do not change story status automatically - confirm with human first.

SM moves:
- Blocker affects the whole sprint, not a single story: record it against the sprint rather than
  one story.
- Multiple stories blocked by same root cause: log one impediment; link to primary story;
  reference secondary stories in the description body.

## §progress - Move to In-Progress

Triggered by: human confirms someone is actively working the blocker.

1. Locate the impediment, by keyword search or its known reference.
2. Move it to in-progress.
3. Comment on affected story: "Impediment [title] is now being actively worked."

SM moves:
- In_progress >1 day: surface at next session. "What's the latest on [blocker]?"
- In_progress >2 days: escalate. Name it, state age, ask what external action is needed.

## §resolution - Close an Impediment

Triggered by: human reports blocker cleared, or SM observes affected story resumed.

1. Locate it:
   - Human names it: search impediments by keyword.
   - Human has the story number: look up the story and read what's currently blocking it.
2. Mark it resolved, with resolution notes describing how - notes are required, do not close
   without them.
3. Comment on originally affected story: "Impediment cleared: [summary]. Story is unblocked."
4. If story status is still "Blocked": ask whether to move it back to prior status, or confirm
   it's still blocked for a different reason.

SM moves:
- Human says "it's fine now" with no detail: "What changed? I need to record the resolution."
- Resolution revealed a systemic issue: flag as recurring per `references/dysfunctions.md`.
- Story still blocked after impediment resolved: log a fresh impediment - do not reopen resolved one.

## Escalation Protocol

| Age | Action |
|---|---|
| Day 0 | Log it - same-day, always |
| Day 1 | Surface: "Impediment [X] has been open 1 day with no progress." |
| Day 2+ | Escalate: name it, state age, ask what external action is needed |
| 2 sprints | Flag as recurring impediment type per `references/dysfunctions.md` |

Escalation is the SM's duty, not the team's.
