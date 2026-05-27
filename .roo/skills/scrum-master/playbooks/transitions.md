# Transitions Playbook

On-demand only. Load on explicit human request for project setup, restart, or board reconciliation.

**Trigger phrases:** "set up Scrum", "first sprint", "bootstrap", "we paused", "picking this back up",
"restarting", "board is outdated", "didn't track", "we kept building", "need to catch up"

**Also trigger when:** `scrum_orient` returns missing field mappings or no iteration history; board
has items but no sprint assignments; in-progress items dated >3× configured sprint length; user
confirms development happened but board does not reflect it.

Three scenarios: **project_bootstrap**, **stale_recovery**, **board_catchup**.
All follow the pattern: detect → sequential elicitation → board audit → story review → update
config.yml → baseline → plan first/next sprint.

The story_review_protocol below applies within all three whenever individual items are assessed.

## Story Review Protocol

For each item: run the three checks in sequence. Offer reclassification or breakdown when signals
are present — do not force. Confirm with human before writing. Apply `scrum_update_story` when settled.

**Check 1 — Sufficiency:** is this understood well enough to estimate and commit?
Signals: body is vague ("research X"), team can't agree on estimate, untested assumption embedded.
If insufficient: offer to convert to a Spike. Rewrite with research question, expected output, time-box.

**Check 2 — Size:** completable within one sprint?
Signals: estimate >40% of velocity; multiple independent deliverables; spans multiple user types.
If too large — offer two paths:
1. Split now: workflow step / user type / data variation / happy path first
2. Keep as Epic placeholder; refine only the first child story now

**Check 3 — Type:**
- Feature: new user-visible capability. Full DoR applies.
- Bug: unintended behaviour. DoR: repro steps, severity, affected area.
- Tech Debt: internal improvement. DoR: rationale, DoD impact if deferred, estimate.
- Spike: time-boxed investigation. Output is knowledge, not code.
If ambiguous: "Would a user notice this change, or is it purely internal work?"

After all three checks: confirm scope, apply `scrum_update_story`, move to next item.

## Playbook: Project Bootstrap

**Phase 1 — Project context** (no tool calls yet)
Ask: project name and ultimate goal; team members and roles; hard external constraints.
Write `project.name` and `project.team` to `.github/scrum/config.yml`. Note milestone dates.

**Phase 2 — Board audit**
1. `scrum_orient` + read `.github/scrum/config.yml` — assess configuration completeness
2. `scrum_get_board_health` then `scrum_find_items` — load all existing items
3. Present inventory: "I found [N] items. [X] in-progress, [Y] in backlog, [Z] with no status."
4. Ask: "Do any reflect work already done, or work no longer relevant?"
   - Done: `scrum_set_field(field: "status", value: vocabulary.status["done"])` — never hardcode "Done"
   - Irrelevant: label as icebox. Never delete.
   - Board near-empty: skip Phase 3, jump to Phase 4.

**Phase 3 — Velocity baseline** (rough estimates are fine)
Ask: roughly how much shipped in the past 4–8 weeks; how many items finished per typical sprint;
was team fully focused or splitting time?
Derive rough velocity. If none: `available_days × focus_factor × team_size` (default 0.65).
Set `scrum.sprint.velocity_window` in config.yml. Annotate: "Bootstrap estimate — refine after 2–3 sprints."

**Phase 4 — Quality gates**
Ask: "What does 'done' mean? What must be true before something is finished?"
Ask: "What would prevent starting work on an item? What makes something 'not ready yet'?"
Write `definition_of_done` and `definition_of_ready` to config.yml (3–5 items each; label v1).
Call `scrum_add_vocabulary` if board is missing status options that match config.

**Phase 5 — Sprint parameters**
Ask: sprint length (2 weeks is default); sprint start day and ceremony days.
Write `scrum.sprint.length_weeks` and `scrum.sprint.start_day`.
If field mappings missing: read available fields from `scrum_orient`; propose mappings; confirm
before writing to `backends.github.field_mapping`.

**Phase 6 — Story review**
Apply story_review_protocol to all active backlog items. In-progress first, then backlog.
After: "Sprint-ready: [...]. Needs refinement: [...]. Converted or split: [...]."

**Phase 7 — First sprint**
Ask: "Sprint 0 (setup, no increment) or Sprint 1 (real commitments)?"
`scrum_plan_sprint` with agreed scope and proposed Sprint Goal.
Check `platform_state.template_uris`; if `sprint_planning` present, access `scrum://template/sprint_planning`.

## Playbook: Stale Recovery

**Phase 1 — Understand the pause**
Ask: when did work stop; what caused it and is it resolved; have team members joined or left?
`scrum_get_analytics` — find last active sprint and velocity.
If root cause not resolved: name it before planning. Do not commit to re-planning without a credible
answer to "what changes between now and sprint start?"

**Phase 2 — Scope validity**
Ask: has product direction changed; any new external constraints; is most of the backlog still valid?

**Phase 3 — Velocity rebaseline** (only if pause >2 sprint lengths OR team composition changed)
"Last recorded velocity was [X] SP/sprint. Does that still feel reliable?"
If not: use capacity formula. "Treat first sprint back as calibration — commit at 60–70% of estimated capacity."

**Phase 4 — Board audit**
`scrum_find_items(scope: "sprint")` for in-progress; `scrum_find_items` for backlog.
Per in-progress item, offer four options: "Resume as-is / Re-estimate / Defer to backlog / Close won't-do."
Apply story_review_protocol to any item human is uncertain about.

**Phase 5 — Recovery planning**
`scrum_plan_sprint` with 60–70% of estimated velocity.
Sprint Goal: "Prove the team can deliver a working increment in one sprint."

## Playbook: Board Catchup

**Phase 1 — Assess the gap**
Ask: how far behind is the board; was development consistent or in bursts; any record of what got done?
`scrum_get_board_health` then `scrum_find_items(scope: "sprint")` and full backlog.
Present inventory with date range of last activity.
Solo/small team: reduce ceremony overhead; focus is board accuracy and forward visibility.
Large gap with no records: "We're building a working board, not an audit trail. Approximate is fine."

**Phase 2 — Reconstruct done work**
"Walk me through what you built since the board was last updated. Rough groupings are fine."
Per item described as completed:
- Match on board → `scrum_set_field(field: "status", value: vocabulary.status["done"])` — never literal "Done"
- No match → create new item and immediately mark done
- Partially done → update body; split remaining work into a new open item
Do not create sprint assignments for historical work.

**Phase 3 — Triage remaining items**
Present all remaining open items. Apply story_review_protocol to each.
"Are there things you're planning to build that aren't on the board yet?"

**Phase 4 — Establish baseline**
Count Done items from Phase 2. SP if estimates exist: sum / elapsed sprints. Else: item count / sprint length.
Ask: "Is that pace sustainable, or was it an unusual push?"
Write velocity baseline to config.yml; annotate as reconstructed.
If DoD and DoR not in config: run Phase 4 of project_bootstrap.

**Phase 5 — Forward planning**
"Should we set up the next sprint now, or refine the backlog first?"
- Planning now → `ceremony-backlog-transitions.md §sprint_planning`
- Refinement first → `ceremony-backlog-transitions.md §backlog_refinement`, then schedule planning

## Config.yml Write Guidance

- Always read `.github/scrum/config.yml` before writing. Update only explicitly elicited keys.
  Preserve all existing content and structure.
- Never overwrite `auth.*` values — these are environment variable references.
- `backends.*.field_mapping`: propose based on `scrum_orient` field discovery. Confirm before writing.
  Field names are case-sensitive.
- `status_display` and `priority_display`: propose full mapping; confirm before writing.
- `definition_of_ready` and `definition_of_done`: write as YAML lists. Add `# v1 - [date]` when first written.
- After writing field mappings (`backends.*.field_mapping.*`, `status_display`, `priority_display`,
  `type_mapping`): call `scrum_orient` again — these writes change live board option resolution.
  Metadata-only writes (DoR, DoD, sprint length, team roster, deadline_field): re-orient NOT needed.
- Field values requiring platform-specific IDs: fetch via `scrum_orient` — never ask the human.
