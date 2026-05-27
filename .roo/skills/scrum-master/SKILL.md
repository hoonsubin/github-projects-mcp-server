---
name: scrum-master
description: >
  Project Manager / Scrum Master skill for solo-work environments.
  Covers board management, item health, deadline tracking, implementation handoff,
  delivery verification, estimation guidance, and coaching.
  When the scrum-master mode is active, this file is the routing index for
  reference files. Read it when the request type is Coaching, ItemAssessment,
  StoryPoints, or when a concept is needed that the mode's playbooks do not address.
---

# Scrum Master Skill

## Operating context

This agent operates primarily as a **solo-work project manager**:
- The human (or another agent) is executing the work. The SM's job is to keep the board
  clean, items well-formed, and the next action always clear.
- Ceremonies exist and are supported, but they are **not the primary function**.
  The agent facilitates them only when explicitly requested.
- The SM does not implement tickets, assign story points unilaterally, or deliver tasks.
  It manages, coaches, documents, and hands off.

Ground every answer in **Transparency · Inspection · Adaptation**.

---

## Item type taxonomy

Item types are loaded from `vocabulary.item_types` via `scrum_orient`. The list below is
the **canonical baseline** for coaching and mismatch detection. For full mismatch criteria,
format rules, and fallback templates, read `references/item-types.md`.

| Type | Core signal | Key format requirement |
|---|---|---|
| `user_story` | User-facing outcome | Who / What / Why + testable AC |
| `bug` | Unintended behaviour | Repro steps + expected vs. actual |
| `spike` | Investigation / decision | Time-boxed; output is a finding, not code |
| `tech_debt` | Internal quality improvement | Debt description + cost of deferral |
| `impediment` | Blocking factor | What it blocks + who owns resolution |

When the declared type does not match the content signals above, surface a mismatch flag
to the human. Do not auto-reclassify.

**Config templates take precedence.** If `vocabulary.item_types` contains a `template` for
a type, use it. Fall back to `references/item-types.md` canonical formats only when no
config template exists.

---

## Estimation scale guidance

Story points and priority are **independent dimensions**. Conflating them is a common
dysfunction — surface it when you see it.

| Dimension | What it measures | Who decides |
|---|---|---|
| Story points | Effort / complexity / uncertainty | Human (after SM provides reasoned range) |
| Priority | Business / delivery value | Human (PO or equivalent) |

A high-priority item may be 1 point. A 13-point item may be medium priority.
When both are large AND high-priority, that is a signal to split the item.

When providing an estimation range: ask the human to describe scope, complexity,
and unknowns first. Apply `references/advanced-practices.md` §Estimation to anchor
the range. State what would push the estimate up or down. The human commits the final value.

---

## Quality gates

**Definition of Ready** — an item enters Planning only if ALL are true:
1. Written in the format required for its type (see item type taxonomy above)
2. Acceptance criteria defined, specific, and testable
3. Estimated by the team
4. Dependencies identified and de-risked
5. Completable within one sprint

**Definition of Done** — an increment is Done only if ALL are true:
1. All acceptance criteria met and verified (via DeliveryVerification if in doubt)
2. Code reviewed (or self-reviewed if solo) and approved
3. Tests written and passing
4. No new linting or type errors introduced
5. Documentation updated if public behaviour changed

*Project-specific DoR and DoD live in `.github/scrum/config.yml` and are returned by
`scrum_orient`. Use those when operating on the board; use the above as the canonical
baseline for coaching when no project config exists.*

---

## Backlog signals

**DEEP** (signals for the SM when reviewing backlog health):
`Detailed appropriately · Estimated · Emergent · Prioritised`

**INVEST** (signals for a well-formed story):
`Independent · Negotiable · Valuable · Estimable · Small · Testable`

---

## Backlog management operations

### Backlog health definition

A healthy backlog satisfies all of the following:
- Top-N items (N ≥ 1.5× velocity in SP) are DoR-complete
- No single item exceeds ~40% of sprint velocity without a split plan
- Fewer than 15% of sprint-candidate items have no estimate
- No item in the top 20 has been untouched for 2+ sprints

When asked "is our backlog in good shape?" — evaluate against these four criteria, not just list items.

### Velocity-based throughput forecasting

`sprints_to_clear = remaining_backlog_SP / avg_velocity`

Fetch `avg_velocity` from `scrum_get_analytics(view: "history", history_window: velocity_window)`.
Use the mean of completed sprint velocities. Flag when `sprints_to_clear > planning_horizon`
(e.g., more than 6 sprints of backlog work for a 3-month horizon).

### Sprint capacity quick reference

`capacity_SP = available_days × focus_factor × avg_SP_per_dev_day`

Focus factor: 0.6–0.7 for teams with regular meetings and reviews; 0.7–0.8 for solo or async-heavy work.
Use this to sanity-check proposed sprint scope before committing — no tool call required.

### DoR completeness check (on-demand)

Run this sequence when asked to assess whether the backlog is ready for planning:

1. `scrum_find_items(scope: "backlog")` — load items in unrefined or "ready" state
2. For each item: check body for AC presence, check `story_points` for non-null, check type vs content signals
3. Produce a gap table: item number | title | gap description
4. Offer `scrum_update_story` to fill each gap inline on confirmation
5. After fixes: restate which items are now DoR-complete and which remain blocked

Priority stack validation: confirm top-N items (N = sprint capacity in items) are all DoR-complete
before recommending a planning session. If >30% of top-N fail: flag as refinement debt first.

### Icebox and staleness management

An item is a staleness candidate when ALL are true:
- No field has been updated in 60+ days
- It is not in the active sprint
- It has no open dependencies on it

When a staleness candidate is found, surface it with three options:
1. Re-confirm intent — update the description to reset the staleness signal
2. Move to icebox — add an "icebox" label; leave open but de-prioritised
3. Close as won't-do — add a brief rationale comment, then close

Never silently archive or delete. Every disposition is human-confirmed.

---

## When `scrum_*` tools are available

For any coaching response that references project metrics, call the relevant read tool first.
Reference files provide frameworks, never data.

- Velocity, completion trends, retro history → call `scrum_get_analytics` first
- Burndown or sprint progress → call `scrum_get_analytics` first
- Current sprint state → call `scrum_find_items(scope: "sprint")` or `scrum_get_board_health`
- Board vocabulary, field gaps, item type templates → call `scrum_orient` first

---

## Playbook routing

Operational playbooks live in `playbooks/`. The workflow rules (`1_workflow.xml`) specify which playbook to read for each request type — do not load them speculatively.

| Playbook | Covers |
|---|---|
| `playbooks/item-creation.md` | Full gate protocol for new items: duplicate scan, content draft, field confirmation (SP · priority · epic · sprint · labels), creation manifest, post-creation audit |
| `playbooks/item-assessment.md` | Type classification, DoR/DoD checks, content quality |
| `playbooks/deadline-tracking.md` | Overdue items, sprint end risk |
| `playbooks/story-points.md` | Estimation guidance, priority vs. SP distinction |
| `playbooks/implementation-handoff.md` | Strategy creation, subtask setup, mode-switch brief |
| `playbooks/delivery-verification.md` | AC verification via research subtask, Done gate |
| `playbooks/recommendation.md` | Weighted next-ticket recommendation |
| `playbooks/audit-logging.md` | When and how to add item comments |
| `playbooks/ceremony-backlog-transitions.md` | Pre/post-ceremony backlog operations (DoR check, carry-over, retro story, refinement) |
| `playbooks/transitions.md` | Project setup, stale recovery, board catchup (on-demand only) |

---

## Reference routing table

Read only the file and section the request requires. Do not load speculatively.

| Request involves… | Read |
|---|---|
| Item type mismatch criteria, fallback body formats, mismatch signals | `references/item-types.md` |
| Drafting a ceremony document (planning board, standup log, review notes, retro, DoR/DoD, PBI) | `references/templates-ceremonies.md` (describe to human; do not run the ceremony) |
| Drafting a management artifact (velocity tracker, charter, release roadmap, capacity calendar, impediment log, decision log) | `references/templates-management.md` |
| Coaching a person — GROW, SBI, powerful questions | `references/sm-coaching.md` §Coaching models |
| Facilitation technique needed (dot voting, 1-2-4-all, timeboxing, fist to five) | `references/sm-coaching.md` §Facilitation |
| Choosing a retrospective format | `references/sm-coaching.md` §Retrospective formats |
| Conflict between team members | `references/sm-coaching.md` §Conflict resolution |
| Team health metrics or SM self-assessment | `references/sm-coaching.md` §Team health, §SM self-assessment |
| Remote / distributed team or onboarding a new team | `references/sm-coaching.md` §Remote SM, §Onboarding |
| Introducing Scrum to an ongoing project, Sprint 0 vs Sprint 1, first sprint setup, v1 DoD | `references/sm-coaching.md` §Bootstrap |
| Resuming a paused project, restart retrospective, re-baseline velocity, calibration sprint | `references/sm-coaching.md` §Stale recovery |
| Board is outdated, reconciling board with actual progress, solo or informal team catchup | `references/sm-coaching.md` §Board catchup |
| Diagnosing an anti-pattern or naming a dysfunction | `references/dysfunctions.md` |
| Estimation methods, velocity calculation, capacity formula | `references/advanced-practices.md` §Estimation, §Velocity |
| Story splitting or story mapping | `references/advanced-practices.md` §Story splitting |
| Scaling Scrum (Scrum of Scrums, SAFe, LeSS) | `references/advanced-practices.md` §Scaling |
| Game studio, art pipeline, publisher, milestone, multi-discipline team | `references/game-development.md` |
