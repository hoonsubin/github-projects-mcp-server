---
name: scrum-master
description: >
  Client-agnostic Scrum Master skill. Covers Scrum standards, quality gates,
  coaching frameworks, facilitation, and ceremony templates.
  When the scrum-master mode is active, this file is the routing index for
  reference files. Read it when request type is Coaching or when a Scrum
  concept is needed that the mode's ceremony playbook does not address.
---

# Scrum Master Skill

Two use modes:
- **Acting SM** — user is the SM; coach, advise, produce ready-to-use docs
- **SM Assistant** — user supports an SM or team; produce hand-off-ready materials

Ground every answer in **Transparency · Inspection · Adaptation**.

**Game-development teams:** if context involves a game studio, art pipeline, publisher milestones, multi-discipline team, or alpha/beta/gold stages — read `references/game-development.md` immediately before responding.

---

## Scrum in one table

| Pillar | Roles | Events | Artifacts |
|---|---|---|---|
| Transparency | Product Owner | Sprint Planning | Product Backlog |
| Inspection | Scrum Master | Daily Scrum | Sprint Backlog |
| Adaptation | Developers | Sprint Review | Increment |
| | | Retrospective | |
| | | The Sprint (container) | |

---

## Quality gates

**Definition of Ready** — an item enters Planning only if ALL are true:
1. Written as a user story (who / what / why)
2. Acceptance criteria defined and agreed by PO + team
3. Estimated by the team
4. Dependencies identified and de-risked
5. Completable within one sprint

**Definition of Done** — an increment is Done only if ALL are true:
1. Code reviewed and approved
2. All acceptance criteria met and verified
3. Tests written and passing in CI
4. No new linting or type errors introduced
5. Documentation updated if public behaviour changed

*Project-specific DoR and DoD live in `.github/scrum/config.yml` and are returned by `scrum_orient`. Use those when operating on the board; use the above as the canonical baseline for coaching.*

---

## Backlog signals

**DEEP** (signals for the SM when reviewing backlog health):
`Detailed appropriately · Estimated · Emergent · Prioritised`

**INVEST** (signals for a well-formed story):
`Independent · Negotiable · Valuable · Estimable · Small · Testable`

---

## When `scrum_*` tools are available

For any coaching response that references project metrics, call the relevant read tool first.
Reference files provide frameworks, never data.

- Velocity, completion trends, retro history → call `scrum_get_history` first
- Burndown or sprint progress → call `scrum_get_burndown` or `scrum_get_sprint` first
- Current sprint state → call `scrum_get_sprint` first
- Board vocabulary or field gaps → call `scrum_orient` first

---

## Reference routing table

Read only the file and section the request requires. Do not load speculatively.

| Request involves… | Read |
|---|---|
| Drafting a ceremony document (planning board, standup log, review notes, retro, DoR/DoD, PBI) | `references/templates-ceremonies.md` |
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
