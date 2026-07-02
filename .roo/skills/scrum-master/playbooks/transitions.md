# Transitions Playbook

On-demand only. Load on explicit human request for project setup, restart, or board reconciliation.

**Trigger phrases:** "set up Scrum", "first sprint", "bootstrap", "we paused", "picking this back up",
"restarting", "board is outdated", "didn't track", "we kept building", "need to catch up"

**Also trigger when:** the project's Scrum configuration is missing field mappings or has no
iteration history; board has items but no sprint assignments; in-progress items dated >3× configured
sprint length; user confirms development happened but board does not reflect it.

Three scenarios: **project_bootstrap**, **stale_recovery**, **board_catchup**.
All follow the pattern: detect → sequential elicitation → board audit → story review → update
Scrum configuration → baseline → plan first/next sprint.

The story_review_protocol below applies within all three whenever individual items are assessed.

## Story Review Protocol

For each item: run the three checks in sequence. Offer reclassification or breakdown when signals
are present - do not force. Confirm with human before writing. Apply the agreed change once settled.

**Check 1 - Sufficiency:** is this understood well enough to estimate and commit?
Signals: body is vague ("research X"), team can't agree on estimate, untested assumption embedded.
If insufficient: offer to convert to a Spike. Rewrite with research question, expected output, time-box.

**Check 2 - Size:** completable within one sprint?
Signals: estimate >40% of velocity; multiple independent deliverables; spans multiple user types.
If too large - offer two paths:
1. Split now: workflow step / user type / data variation / happy path first
2. Keep as Epic placeholder; refine only the first child story now

**Check 3 - Type:**
- Feature: new user-visible capability. Full DoR applies.
- Bug: unintended behaviour. DoR: repro steps, severity, affected area.
- Tech Debt: internal improvement. DoR: rationale, DoD impact if deferred, estimate.
- Spike: time-boxed investigation. Output is knowledge, not code.
If ambiguous: "Would a user notice this change, or is it purely internal work?"

After all three checks: confirm scope, apply the agreed classification, move to next item.

## Playbook: Project Bootstrap

**Phase 1 - Project context** (pure conversation — no board changes yet)
Ask: project name and ultimate goal; team members and roles; hard external constraints.
Record the project name, goal, and team in the project's Scrum configuration. Note milestone dates.

**Phase 2 - Board audit**
1. Assess how complete the project's Scrum configuration already is.
2. Load all existing items, across sprints and the backlog.
3. Present inventory: "I found [N] items. [X] in-progress, [Y] in backlog, [Z] with no status."
4. Ask: "Do any reflect work already done, or work no longer relevant?"
   - Done: move it to the project's configured "done" status - never hardcode the literal word "Done"
   - Irrelevant: label as icebox. Never delete.
   - Board near-empty: skip Phase 3, jump to Phase 4.

**Phase 3 - Velocity baseline** (rough estimates are fine)
Ask: roughly how much shipped in the past 4–8 weeks; how many items finished per typical sprint;
was team fully focused or splitting time?
Derive rough velocity. If none: `available_days × focus_factor × team_size` (default 0.65).
Record the velocity lookback window in the project's Scrum configuration. Annotate: "Bootstrap
estimate - refine after 2–3 sprints."

**Phase 4 - Quality gates**
Ask: "What does 'done' mean? What must be true before something is finished?"
Ask: "What would prevent starting work on an item? What makes something 'not ready yet'?"
Record the Definition of Done and Definition of Ready in the project's Scrum configuration
(3–5 items each; label as v1).
Add any status options the board is missing that this configuration now requires.

**Phase 5 - Sprint parameters**
Ask: sprint length (2 weeks is default); sprint start day and ceremony days.
Record sprint length and start day in the project's Scrum configuration.
If field mappings are missing: identify the board's available fields, propose mappings, and confirm
with the human before writing them into the project's backend configuration.

**Phase 6 - Story review**
Apply story_review_protocol to all active backlog items. In-progress first, then backlog.
After: "Sprint-ready: [...]. Needs refinement: [...]. Converted or split: [...]."

**Phase 7 - First sprint**
Ask: "Sprint 0 (setup, no increment) or Sprint 1 (real commitments)?"
Commit the agreed scope and proposed Sprint Goal to the sprint.
If a sprint-planning template is available for this project, use it.

## Playbook: Stale Recovery

**Phase 1 - Understand the pause**
Ask: when did work stop; what caused it and is it resolved; have team members joined or left?
Reconstruct recent velocity from the last few completed sprints' item data (use the project's
configured velocity lookback window).
If root cause not resolved: name it before planning. Do not commit to re-planning without a credible
answer to "what changes between now and sprint start?"

**Phase 2 - Scope validity**
Ask: has product direction changed; any new external constraints; is most of the backlog still valid?

**Phase 3 - Velocity rebaseline** (only if pause >2 sprint lengths OR team composition changed)
"Last recorded velocity was [X] SP/sprint. Does that still feel reliable?"
If not: use the capacity formula. "Treat first sprint back as calibration - commit at 60–70% of
estimated capacity."

**Phase 4 - Board audit**
Gather in-progress sprint items, then the full backlog.
Per in-progress item, offer four options: "Resume as-is / Re-estimate / Defer to backlog / Close won't-do."
Apply story_review_protocol to any item human is uncertain about.

**Phase 5 - Recovery planning**
Commit to the sprint at 60–70% of estimated velocity.
Sprint Goal: "Prove the team can deliver a working increment in one sprint."

## Playbook: Board Catchup

**Phase 1 - Assess the gap**
Ask: how far behind is the board; was development consistent or in bursts; any record of what got done?
Gather current sprint data alongside the full backlog.
Present inventory with date range of last activity.
Solo/small team: reduce ceremony overhead; focus is board accuracy and forward visibility.
Large gap with no records: "We're building a working board, not an audit trail. Approximate is fine."

**Phase 2 - Reconstruct done work**
"Walk me through what you built since the board was last updated. Rough groupings are fine."
Per item described as completed:
- Match on board → move it to the project's configured "done" status - never the literal word "Done"
- No match → create new item and immediately mark done
- Partially done → update body; split remaining work into a new open item
Do not create sprint assignments for historical work.

**Phase 3 - Triage remaining items**
Present all remaining open items. Apply story_review_protocol to each.
"Are there things you're planning to build that aren't on the board yet?"

**Phase 4 - Establish baseline**
Count Done items from Phase 2. SP if estimates exist: sum / elapsed sprints. Else: item count / sprint length.
Ask: "Is that pace sustainable, or was it an unusual push?"
Record the velocity baseline in the project's Scrum configuration, annotated as reconstructed.
If DoD and DoR aren't yet configured: run Phase 4 of project_bootstrap.

**Phase 5 - Forward planning**
"Should we set up the next sprint now, or refine the backlog first?"
- Planning now → `ceremony-backlog-transitions.md §sprint_planning`
- Refinement first → `ceremony-backlog-transitions.md §backlog_refinement`, then schedule planning

## Configuration Change Principles

- Read the project's existing Scrum configuration before writing to it. Update only what was
  explicitly elicited from the human. Preserve everything else, structure included.
- Never invent a configuration value - confirm with the human, or derive it from what the board
  already exposes.
- Authentication/credential values are never something this playbook writes or asks about.
- Changes that affect how live board options resolve (field mappings, status/priority display
  names, type mappings) need re-establishing the project's vocabulary afterward; changes that are
  metadata-only (DoR, DoD, sprint length, team roster, deadline field) don't.
