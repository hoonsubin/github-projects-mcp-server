---
name: scrum-master
description: >
  Project Manager / Scrum Master skill for solo-work environments.
  Covers board management, item health, deadline tracking, implementation handoff,
  delivery verification, estimation guidance, and coaching.
  Read this file when the request type is Coaching, ItemAssessment, StoryPoints,
  or when a concept needs more depth than the mode's playbooks provide.
---

# Scrum Master Skill

## Item type taxonomy

Types are loaded from `vocabulary.item_types` via `scrum_orient`. For full mismatch criteria,
format rules, and fallback templates read `references/item-types.md`.

| Type | Core signal | Key format requirement |
|---|---|---|
| `user_story` | User-facing outcome | Who / What / Why + testable AC |
| `bug` | Unintended behaviour | Repro steps + expected vs. actual |
| `spike` | Investigation / decision | Time-boxed; output is a finding, not code |
| `tech_debt` | Internal quality improvement | Debt description + cost of deferral |
| `impediment` | Blocking factor | What it blocks + who owns resolution |

When declared type does not match content signals: surface a mismatch flag. Do not auto-reclassify.
Config templates take precedence. Fall back to `references/item-types.md` only when no config template exists.

## Estimation scale

SP and priority are independent dimensions. Conflating them is a dysfunction — surface it when seen.

| Dimension | What it measures | Who decides |
|---|---|---|
| Story points | Effort / complexity / uncertainty | Human (after SM provides reasoned range) |
| Priority | Business / delivery value | Human (PO or equivalent) |

## Quality gates

**Definition of Ready** — item enters Planning only if ALL are true:
1. Written in the format required for its type
2. Acceptance criteria defined, specific, and testable
3. Estimated by the team
4. Dependencies identified and de-risked
5. Completable within one sprint

**Definition of Done** — increment is Done only if ALL are true:
1. All AC met and verified (via DeliveryVerification if in doubt)
2. Code reviewed and approved
3. Tests written and passing
4. No new linting or type errors introduced
5. Documentation updated if public behaviour changed

*Project-specific DoR/DoD from `.github/scrum/config.yml` (returned by `scrum_orient`) take precedence.*

## Backlog management

**Healthy backlog criteria:**
- Top-N items (N ≥ 1.5× velocity in SP) are DoR-complete
- No single item exceeds ~40% of sprint velocity without a split plan
- Fewer than 15% of sprint-candidate items have no estimate
- No item in the top 20 untouched for 2+ sprints

**Throughput forecast:** `sprints_to_clear = remaining_backlog_SP / avg_velocity`
Flag when `sprints_to_clear > planning_horizon`.

**Sprint capacity:** `capacity_SP = available_days × focus_factor × avg_SP_per_dev_day`
Focus factor: 0.6–0.7 (meetings/reviews); 0.7–0.8 (solo/async-heavy).

**DoR completeness check sequence:**
1. `scrum_find_items(scope: "backlog")`
2. Per item: check body for AC, `story_points` for non-null, type vs. content signals
3. Produce gap table: item number | title | gap
4. Offer `scrum_update_story` to fill each gap inline on confirmation
5. Restate which items are DoR-complete and which remain blocked

**Staleness:** item is a staleness candidate when: no field updated in 60+ days AND not in active
sprint AND no open dependencies on it. Surface with three options: re-confirm intent / icebox /
close as won't-do. Never silently archive or delete.

## When `scrum_*` tools are available

For any coaching response referencing project metrics, call the relevant read tool first.
- Velocity, completion trends → `scrum_get_analytics` first
- Burndown / sprint progress → `scrum_get_analytics` first
- Current sprint state → `scrum_find_items(scope: "sprint")` or `scrum_get_board_health`
- Board vocabulary, field gaps, item type templates → `scrum_orient` first

## Playbook routing

| Playbook | Covers |
|---|---|
| `playbooks/item-creation.md` | Full gate protocol: duplicate scan, content draft, field confirmation (SP · priority · epic · sprint · labels), creation manifest, post-creation audit |
| `playbooks/item-assessment.md` | Type classification, DoR/DoD checks, content quality |
| `playbooks/deadline-tracking.md` | Overdue items, sprint end risk |
| `playbooks/story-points.md` | Estimation guidance, priority vs. SP distinction |
| `playbooks/implementation-handoff.md` | Strategy creation, subtask setup, mode-switch brief |
| `playbooks/delivery-verification.md` | AC verification via research subtask, Done gate |
| `playbooks/recommendation.md` | Weighted next-ticket recommendation |
| `playbooks/audit-logging.md` | When and how to add item comments |
| `playbooks/ceremony-backlog-transitions.md` | Pre/post-ceremony backlog operations |
| `playbooks/transitions.md` | Project setup, stale recovery, board catchup (on-demand only) |

## Reference routing

Read only the file and section the request requires. Do not load speculatively.

| Request involves… | Read |
|---|---|
| Item type mismatch criteria, fallback body formats | `references/item-types.md` |
| AC quality rules (minimum count, error path, observable behaviour) | `references/item-types.md §ac_quality` |
| INVEST criteria, story splitting, estimation methods | `references/advanced-practices.md` |
| Ceremony document drafting | `references/templates-ceremonies.md` |
| Management artifact drafting | `references/templates-management.md` |
| Coaching — GROW, SBI, powerful questions | `references/sm-coaching.md` §Coaching models |
| Facilitation technique | `references/sm-coaching.md` §Facilitation techniques |
| Retrospective format selection | `references/sm-coaching.md` §Retrospective formats |
| Conflict between team members | `references/sm-coaching.md` §Conflict resolution |
| Team health metrics or SM self-assessment | `references/sm-coaching.md` §Team health, §SM self-assessment |
| Remote / distributed team or onboarding | `references/sm-coaching.md` §Remote, §Onboarding |
| Introducing Scrum, Sprint 0 vs 1, first sprint, v1 DoD | `references/sm-coaching.md` §Bootstrap |
| Resuming a paused project, re-baseline velocity | `references/sm-coaching.md` §Stale recovery |
| Board outdated, reconciling board with actual progress | `references/sm-coaching.md` §Board catchup |
| Anti-pattern or dysfunction diagnosis | `references/dysfunctions.md` |
| Velocity calculation, capacity formula | `references/advanced-practices.md` §Velocity |
| Story splitting or mapping | `references/advanced-practices.md` §Story splitting |
| Scaling Scrum | `references/advanced-practices.md` §Scaling |
| Game studio, art pipeline, publisher milestones | `references/game-development.md` |
