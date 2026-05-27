# Transitions Playbook

> On-demand only. Load this playbook when the human explicitly requests project setup,
> project restart, or board reconciliation. Do not load proactively.

**Trigger phrases:** "set up Scrum", "first sprint", "bootstrap", "we paused",
"picking this back up", "restarting", "board is outdated", "didn't track",
"we kept building", "need to catch up"

**Also trigger when:**
- `scrum_orient` returns missing field mappings or no iteration history
- Board has items but no sprint assignments and no sprint history
- In-progress items have dates older than 3× the configured sprint length
- User confirms development happened but the board does not reflect it

Three scenario types: **project_bootstrap**, **stale_recovery**, **board_catchup**.
All three follow the same pattern: detect scenario → sequential elicitation → board audit
→ story review → update config.yml → establish baseline → plan first/next sprint.

The `story_review_protocol` below applies within all three playbooks whenever individual
items are being assessed.

---

## Story Review Protocol

For each item under review: run the three checks in sequence. Offer reclassification or
breakdown when signals are present — do not force. Always confirm with the human before
writing changes. Apply `scrum_update_story` after each item is fully settled.

**Check 1: Sufficiency** — Is this item understood well enough to estimate and commit to?

Signals: body is vague ("research X", "figure out Y"), team cannot agree on an estimate,
an untested assumption is embedded, item depends on an unanswered question.

If insufficient: offer to convert to a time-boxed Spike. Rewrite with a clear research
question, expected output, and time-box. Set type to `spike`.

**Check 2: Size** — Can this be completed within one sprint?

Signals: estimate exceeds ~40% of sprint velocity, item contains multiple independent
deliverables, spans multiple user types or workflow steps.

If too large, offer two paths:
1. Break into smaller stories now — apply splitting patterns: workflow step / user type /
   data variation / happy path first. Reference `references/advanced-practices.md §Story splitting`.
2. Keep as Epic placeholder; refine only the first child story now.

**Check 3: Type** — What kind of work is this?

- **Feature**: new capability users would notice. Full DoR applies.
- **Bug**: unintended behaviour. DoR: repro steps, severity, affected area.
- **Tech Debt**: internal improvement. DoR: rationale, DoD impact if deferred, estimate.
- **Spike**: time-boxed investigation. Output is knowledge. No SP estimate.

If ambiguous: "Would a user notice this change, or is it purely internal work?"

After all three checks: confirm scope with the human, apply `scrum_update_story`, move to next item.

---

## Playbook: Project Bootstrap

Introducing Scrum to an ongoing project for the first time.

**Phase 1 — Project context** (no tool calls yet)

Ask together:
- What is this project, and what is it ultimately trying to achieve?
- Who is on the team, and what is each person's role?
- Are there any hard external constraints — deadlines, milestones, or stakeholder commitments?

Write `project.name` and `project.team` to `.github/scrum/config.yml`. Note milestone dates.

**Phase 2 — Board audit** (agent-driven)

1. Call `scrum_orient` and read `.github/scrum/config.yml` to assess configuration completeness.
2. Call `scrum_get_board_health`, then `scrum_find_items` to load all existing items.
3. Present inventory: "I found [N] items. [X] in-progress, [Y] in backlog, [Z] with no status."
4. Ask: "Do any of these items reflect work that's already done, or work that's no longer relevant?"

Branches:
- Done items: `scrum_set_field(field: "status", value: vocabulary.status["done"])` — NEVER hardcode "Done".
- Irrelevant items: label as icebox. Never delete — preserve history.
- Board empty or near-empty: skip Phase 3, jump to Phase 4.

**Phase 3 — Velocity baseline** (informal, rough estimates are fine)

Ask together:
- Roughly how much has the team shipped in the past 4–8 weeks?
- In a typical week or two, how many items get finished?
- Was the team fully focused, or splitting time across other work?

Derive a rough velocity estimate. If the team has no sense of past throughput, use the capacity
formula: `available_days × focus_factor × team_size` (default focus factor: 0.65). Set
`scrum.sprint.velocity_window` in config.yml. Annotate: "Bootstrap estimate — refine after 2–3 sprints."

**Phase 4 — Quality gates** (ask together, short answers)

- "What does 'done' mean for this project today? What has to be true before something is finished?"
- "What would prevent you from starting work on an item? What makes something 'not ready yet'?"

Write `definition_of_done` and `definition_of_ready` to config.yml (3–5 items each, label as v1).
Call `scrum_add_vocabulary` if the board is missing status options that match config.

**Phase 5 — Sprint parameters** (mechanical, agent proposes defaults)

- "How long should sprints be? (2 weeks is the standard default.)"
- "What day of the week works best for sprint start, planning, and review?"

Write `scrum.sprint.length_weeks` and `scrum.sprint.start_day`. If field mappings are missing,
read available fields from `scrum_orient` and propose mappings. Confirm before writing to
`backends.github.field_mapping`.

**Phase 6 — Story review**

Review all active backlog items using the story_review_protocol above.
Work through items grouped by status: in-progress first, then backlog.
After review: "Here's sprint-ready: [...]. Needs refinement: [...]. Converted or split: [...]."

**Phase 7 — First sprint**

Ask: "Should we call this Sprint 0 (setup and orientation) or Sprint 1 (real commitments from the start)?"
Call `scrum_plan_sprint` with the agreed scope and a proposed Sprint Goal.
Check `platform_state.template_uris`; if `sprint_planning` is present, access `scrum://template/sprint_planning`.

---

## Playbook: Stale Recovery

Re-orienting a project that was actively running Scrum and then paused.

**Phase 1 — Understand the pause**

Ask together:
- "When did active work stop? (A sprint number or approximate date is fine.)"
- "What caused the pause? Is that root cause resolved now?"
- "Have any team members joined or left since the project was active?"

Call `scrum_get_analytics` to find the last active sprint and its velocity.
If root cause not resolved: name it explicitly before planning. Do not commit to re-planning
until there is a credible answer to "what changes between now and sprint start?"

**Phase 2 — Scope validity**

Ask together:
- "Has the product direction or priorities changed since the pause?"
- "Are there new external constraints — deadlines, stakeholder changes, or technical shifts?"
- "Broadly: is most of the backlog still valid, or does a significant portion need re-evaluation?"

**Phase 3 — Velocity rebaseline** (only if pause > 2 sprint lengths OR team composition changed)

"The last recorded velocity was [X] SP/sprint. Given the pause and any team changes, does that still feel reliable?"

If not reliable: use capacity formula as the new baseline. "We'll treat the first sprint back as
a calibration sprint — commit conservatively (60–70% of estimated capacity)."

**Phase 4 — Board audit**

Call `scrum_find_items(scope: "sprint")` for in-progress items, then `scrum_find_items` for the backlog.
For each in-progress item, offer four options: "Resume as-is / Re-estimate / Defer to backlog / Close as won't-do."
Apply story_review_protocol to any item the human is uncertain about.

**Phase 5 — Recovery planning**

Call `scrum_plan_sprint` with a conservative scope (60–70% of estimated velocity).
Set calibration Sprint Goal: "Prove the team can deliver a working increment in one sprint."

---

## Playbook: Board Catchup

Board is outdated; development actually continued. Reconcile board with reality.

**Phase 1 — Assess the gap**

Ask together:
- "How far behind is the board? (Weeks, months, rough feature count — any estimate is fine.)"
- "Was development happening consistently, or in bursts?"
- "Do you have any record of what got done — commits, release notes, changelogs, or even just memory?"

Call `scrum_get_board_health`, then `scrum_find_items(scope: "sprint")` and `scrum_find_items` for the full backlog.
Present inventory with date range of last activity.

For solo developer or team of 1–2: reduce ceremony overhead; focus is board accuracy and forward visibility.
For large gap with no records: "We're building a working board, not an audit trail. Approximate is fine."

**Phase 2 — Reconstruct done work**

"Walk me through what you built or shipped since the board was last updated. Rough groupings are fine."

For each item described as completed:
- Find a matching board item → mark done via `scrum_set_field(field: "status", value: vocabulary.status["done"])`.
  NEVER pass "Done" literally — always resolve from vocabulary map.
- No matching item → create a new item and immediately mark done.
- Partially completed → update body to reflect current state; split remaining work into a new open item.

Do not create sprint assignments for historical work. Mark items Done directly.

**Phase 3 — Triage remaining items**

Present all remaining open items. Apply story_review_protocol to each.
After reviewing: "Are there things you're planning to build that aren't on the board yet?"

**Phase 4 — Establish baseline**

Count Done items from Phase 2. If estimates exist: sum SP / elapsed sprints. If not: use item count / sprint length.
Ask: "Is that pace sustainable going forward, or was it an unusual push?"
Write velocity baseline to config.yml. Annotate as reconstructed.
If DoD and DoR are not yet in config: run Phase 4 of project_bootstrap now.

**Phase 5 — Forward planning**

"Should we set up the next sprint now, or refine the backlog a bit more first?"
- Planning now → follow ceremony-backlog-transitions.md §sprint_planning.
- Refinement first → follow ceremony-backlog-transitions.md §backlog_refinement, then schedule planning.

---

## Config.yml Write Guidance

Applies across all three playbooks whenever config.yml is written.

- Always read `.github/scrum/config.yml` before writing. Update only keys that have been
  explicitly elicited. Preserve all existing content and structure.
- Never overwrite `auth.*` values — these are environment variable references.
- For `backends.*.field_mapping`: propose values based on `scrum_orient` field discovery.
  Confirm with the human before writing. Field names are case-sensitive.
- For `status_display` and `priority_display`: propose the full mapping and confirm before writing.
- Write `definition_of_ready` and `definition_of_done` as YAML lists. Add comment `# v1 - [date]` when first written.
- After writing field mappings (`backends.*.field_mapping.*`, `status_display`, `priority_display`,
  `type_mapping`) to config.yml, call `scrum_orient` again — these writes change live board option
  resolution. For metadata-only writes (DoR, DoD, sprint length, team roster, deadline_field),
  re-orient is NOT needed.
- If a field value requires a platform-specific ID, fetch it via `scrum_orient` — never ask the human.
