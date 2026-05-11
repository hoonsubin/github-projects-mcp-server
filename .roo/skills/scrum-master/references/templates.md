# Scrum Artifact Templates

Copy-paste-ready Markdown templates. Game-specific variants noted inline.

1. [PBI / User Story](#1-pbi--user-story)
2. [Definition of Ready](#2-definition-of-ready)
3. [Definition of Done](#3-definition-of-done)
4. [Sprint Planning Board](#4-sprint-planning-board)
5. [Daily Standup Log](#5-daily-standup-log)
6. [Sprint Review Notes](#6-sprint-review-notes)
7. [Retrospective](#7-retrospective)
8. [Sprint Archive](#8-sprint-archive)
9. [Impediment Log](#9-impediment-log)
10. [Decision Log](#10-decision-log)
11. [Team Charter](#11-team-charter)
12. [Velocity Tracker](#12-velocity-tracker)
13. [Sprint Planning Agenda](#13-sprint-planning-agenda)
14. [Game-team additions](#14-game-team-additions)
15. [Release Roadmap (multi-sprint)](#15-release-roadmap-multi-sprint)
16. [Capacity Calendar (multi-sprint)](#16-capacity-calendar-multi-sprint)

---

## 1. PBI / User Story

```markdown
### [PBI-XXX] Title

**Type:** Feature / Bug / Tech Debt / Spike
**Priority:** High / Med / Low **Estimate:** [SP] **Epic:** [parent]

**User Story:** As a [user], I want [goal] so that [reason].

**Acceptance Criteria:**

- [ ] Given [context], when [action], then [outcome]

**Out of Scope:** [explicitly excluded]
**Dependencies:** [other PBIs / external blockers]
**Technical Notes:** [optional]

**DoR:** AC defined · estimate agreed · dependencies identified · UI/UX attached if applicable
```

---

## 2. Definition of Ready

```markdown
# Definition of Ready — [Team]

_v[N] — [YYYY-MM-DD]_

An item enters Sprint Planning only if ALL are true:

- [ ] User-story format (or equivalent who/what/why)
- [ ] Acceptance criteria defined and agreed by PO + team
- [ ] Estimated by the dev team
- [ ] Dependencies identified, resolved or de-risked
- [ ] UI/UX mockups or wireframes attached (if applicable)
- [ ] Technical approach understood at a high level
- [ ] Testing requirements outlined
- [ ] Small enough to complete in one sprint
```

---

## 3. Definition of Done

```markdown
# Definition of Done — [Team]

_v[N] — [YYYY-MM-DD]_

A PBI is Done only when ALL are true:

**Build**

- [ ] Code written and self-reviewed
- [ ] Peer-reviewed and approved
- [ ] No new linter / static-analysis warnings

**Test**

- [ ] Unit tests written and passing (≥[X]% coverage)
- [ ] Integration tests passing
- [ ] AC verified by PO or designee
- [ ] Regression tests clean

**Docs**

- [ ] Inline comments updated (if applicable)
- [ ] User-facing docs updated (if applicable)
- [ ] API docs updated (if applicable)

**Deploy**

- [ ] Deployed to staging
- [ ] No critical bugs introduced
- [ ] Deployed to production (if CD in use)
```

---

## 4. Sprint Planning Board

```markdown
## 🏃 Sprint [N] — [Start] to [End]

### Sprint Goal

> _One outcome-based sentence._
> e.g. "Enable guest checkout to reduce abandonment."

### Capacity

| Member    | Avail Days | Planned Hrs | Notes         |
| --------- | ---------- | ----------- | ------------- |
| [Name]    | [X]        | [Y]         | [e.g. 2d PTO] |
| **Total** |            |             |               |

### Sprint Backlog

| ID      | Title | Owner | Est | Status   |
| ------- | ----- | ----- | --- | -------- |
| PBI-001 |       |       |     | 🔵 To Do |

**Status:** 🔵 To Do · 🟡 In Progress · 🟠 In Review · ✅ Done · 🔴 Blocked

### Burndown

| Day | SP Remaining | Notes       |
| --- | ------------ | ----------- |
| 1   | [N]          | start       |
| 5   |              |             |
| 10  | 0            | end (ideal) |
```

---

## 5. Daily Standup Log

```markdown
## Standup — Sprint [N]

| Date       | Done | Doing | Blockers |
| ---------- | ---- | ----- | -------- |
| YYYY-MM-DD |      |       |          |
```

---

## 6. Sprint Review Notes

```markdown
## Sprint [N] Review

**Date:** [YYYY-MM-DD] **Goal:** [restate] **Achieved?** ✅/❌/⚠️
**Attendees:** [names / stakeholder roles]

### Demo

| Item    | Status      | Stakeholder Feedback |
| ------- | ----------- | -------------------- |
| PBI-001 | ✅ Done     | [feedback]           |
| PBI-002 | ❌ Not Done | [reason]             |

### Backlog Changes from Feedback

- [new or reprioritized]

### Sprint Summary

| Field            | Value |
| ---------------- | ----- |
| Committed SP     |       |
| Completed SP     |       |
| Commitment Ratio |       |
| Key Decisions    |       |
| Impediments      |       |
```

---

## 7. Retrospective

```markdown
## Sprint [N] Retrospective

**Date:** [YYYY-MM-DD] **Facilitator:** [SM]
**Format:** Start/Stop/Continue _(or 4Ls / Sailboat / Mad-Sad-Glad / KALM / 5 Whys / Timeline)_

### Observations

| Category             | Observations |
| -------------------- | ------------ |
| ✅ Went well         |              |
| ⚠️ Needs improvement |              |
| 🚀 Start             |              |
| 🛑 Stop              |              |

### Committed Improvement for Sprint [N+1]

> _One specific, actionable, measurable change._

### Follow-up: Last Sprint's Commitment

> **From Sprint [N-1]:** [state it]
> **Followed through?** ✅/❌/⚠️ **Notes:** [what happened]
```

---

## 8. Sprint Archive

```markdown
# Sprint Archive

## Sprint [N] — [Start] to [End]

| Field            | Value    |
| ---------------- | -------- |
| Goal             |          |
| Achieved         | ✅/❌/⚠️ |
| Committed SP     |          |
| Completed SP     |          |
| Retro Commitment |          |
| Followed Through |          |

_[Paste full sprint backlog table for history]_
```

---

## 9. Impediment Log

```markdown
## Impediment Log — Sprint [N]

| #   | Impediment | Raised By | Date | Owner | Status      | Resolved |
| --- | ---------- | --------- | ---- | ----- | ----------- | -------- |
| 1   |            |           |      | SM    | 🔴 Open     |          |
| 2   |            |           |      | SM    | ✅ Resolved |          |

**Rule:** Open >2 days without progress → SM escalates.
```

---

## 10. Decision Log

```markdown
## Decision Log

> Append-only. Never edit/delete — only add new entries that supersede prior ones.

| #     | Decision | Alternatives | Rationale | Owner | Date |
| ----- | -------- | ------------ | --------- | ----- | ---- |
| D-001 |          |              |           |       |      |
```

---

## 11. Team Charter

```markdown
# Team Charter — [Team]

_v[N] — [YYYY-MM-DD]_

## Members

| Name | Role/Discipline | Availability |
| ---- | --------------- | ------------ |

## Sprint Cadence

- Length: [X] weeks
- Planning: [day, time]
- Standup: [time, sync/async]
- Review: [day, time]
- Retro: immediately after Review / [day, time]

## Working Agreements

1. Update Sprint Backlog right after standup, not end of day.
2. Raise blockers the day they appear.
3. Swarm on in-progress items before pulling new ones.
4. Retrospective is sacred — never skipped.
5. [team-specific]

## Communication Norms

- Sync: [team chat thread]
- Urgent: [DM SM + PO]
- Decisions: append-only Decision Log
- Async standup deadline: [time]

## Definition of Done — v[N]

_See separate DoD; reviewed every retro._

## Definition of Ready — v[N]

_See separate DoR; reviewed quarterly._
```

---

## 12. Velocity Tracker

```markdown
## Velocity — [Team]

| Sprint           | Start | End | Committed | Completed | Ratio | Goal Met | Retro Commitment |
| ---------------- | ----- | --- | --------- | --------- | ----- | -------- | ---------------- |
| 1                |       |     |           |           |       | ✅/❌/⚠️ |                  |
| **3-Sprint Avg** |       |     |           |           |       |          |                  |

### Sparkline

Sprint: 1 2 3 4 5 6
SP: 18 22 19 24 21 23
▄ █ ▅ ██ ▇ ██

### Notes

- Planning velocity = avg of last 3 completed sprints
- Velocity is a planning input, not a performance target
- Ratio <80% consistently → planning accuracy issue
- Ratio >100% consistently → over-conservative or scope shifts mid-sprint
```

---

## 13. Sprint Planning Agenda

```markdown
## Sprint [N] Planning — [YYYY-MM-DD]

**Timebox:** [X] hr **Sprint:** [Start] → [End] **Facilitator:** [SM]

### 1. Capacity (10 min)

| Member    | Days | Focus Factor | Effective Days |
| --------- | ---- | ------------ | -------------- |
|           |      | 0.65         |                |
| **Total** |      |              |                |

### 2. Sprint Goal (10 min)

> **PO proposes:** _[outcome sentence]_
> **Agreed:** _[final]_

### 3. Item Selection

| PBI          | Title | Est | Owner | Notes |
| ------------ | ----- | --- | ----- | ----- |
|              |       |     |       |       |
| **Total SP** |       |     |       |       |

### 4. Commitment

> Achievable given capacity?
> [ ] Yes — close [ ] No — remove: [items]
```

---

## 14. Game-team additions

For multi-disciplinary teams (artists, designers, audio, QA, producer alongside programmers).

### DoD additions for cross-discipline teams

```markdown
**Art/Audio additions**

- [ ] Asset on target platform verified (not just dev PC)
- [ ] Asset budget respected (poly count, texture size, audio file size)
- [ ] Approved by art/audio director (or by-proxy via approval column)
- [ ] No regression in build performance

**Design additions**

- [ ] Mechanic is playable end-to-end this sprint (not "parts on the floor")
- [ ] Tunable parameters exposed for designer
- [ ] Conditions of Satisfaction signed off by designer + QA

**QA additions**

- [ ] CoS verified on target platform(s)
- [ ] Regression tests run on adjacent areas
- [ ] No new high-priority bugs in bug database

**Production additions**

- [ ] No new external dependencies introduced unannounced
- [ ] First-party / cert implications flagged if any
```

### Sprint Backlog Board with Approval column

```markdown
| ID  | Title | Owner | Est | To Do | WIP | In Review | Pending Approval | Done |
| --- | ----- | ----- | --- | ----- | --- | --------- | ---------------- | ---- |

**"Pending Approval" rule:** items here are functionally complete; awaiting art/audio director, license holder, or PO sign-off. Items >2 days in this column are impediments.
```

### Production-stage Kanban board

```markdown
| Backlog | Concept(1) | Model(2) | Rig(1) | Animate(2) | Audio(1) | Integrate(1) | Done |
| ------- | ---------- | -------- | ------ | ---------- | -------- | ------------ | ---- |

**(N)** = WIP limit per column. Pile-ups = bottlenecks; empty columns = starvation.
Cycle time per step ≤ takt time. See `references/game-development.md` §3.
```

### Bug database (post-alpha replacement for product backlog)

```markdown
## Bug Database — Post-Alpha

| #     | Severity    | Area | Description | Repro Steps | Found By | Owner | Status         |
| ----- | ----------- | ---- | ----------- | ----------- | -------- | ----- | -------------- |
| B-001 | A (blocker) |      |             |             |          |       | 🔴 Open        |
| B-002 | B (major)   |      |             |             |          |       | 🟡 In Progress |

**Severity:** A=blocker (cert fail, crash) · B=major (gameplay broken) · C=minor (visual) · D=polish
**Triage:** PO + QA lead daily; team pulls top-priority items each morning.
```

### Release / milestone tracker

```markdown
## Release Tracker — [Project]

| Milestone                       | Target Date | Stage      | Status | Sprint |
| ------------------------------- | ----------- | ---------- | ------ | ------ |
| Concept Treatment               |             | Concept    |        |        |
| Vertical Slice / First Playable |             | Pre-prod   |        |        |
| Alpha (content complete)        |             | Production |        |        |
| Beta (feature complete)         |             | Production |        |        |
| Gold Master / Submission        |             | Post-prod  |        |        |
| Cert / Launch                   |             | Post-prod  |        |        |

**Hardening sprints** scheduled before alpha and gold: no new features; bugs + polish + cert prep.
```

---

## 15. Release Roadmap (multi-sprint)

A release groups several sprints toward a milestone. Track them as a single table.

```markdown
## Release Roadmap — [Release Name / Quarter]

| Sprint   | Dates                   | Sprint Goal    | Key Deliverables                | Status     |
| -------- | ----------------------- | -------------- | ------------------------------- | ---------- |
| Sprint 1 | YYYY-MM-DD → YYYY-MM-DD | Foundation     | Core auth, data model           | 🟢 Planned |
| Sprint 2 | YYYY-MM-DD → YYYY-MM-DD | Core features  | User dashboard, API             | 🟢 Planned |
| Sprint 3 | YYYY-MM-DD → YYYY-MM-DD | Polish & edges | Error handling, perf            | 🟢 Planned |
| Sprint 4 | YYYY-MM-DD → YYYY-MM-DD | Hardening      | Regression, docs, release notes | 🟢 Planned |

### Milestones

- **YYYY-MM-DD** — Stakeholder sign-off
- **YYYY-MM-DD** — Final regression pass
- **YYYY-MM-DD** — Release candidate freeze
- **YYYY-MM-DD** — **Target release date**

**Status:** 🟢 Planned · 🔵 In Progress · ✅ Done · ⚠️ At Risk · 🔴 Blocked
```

For game projects, map sprints to stages (concept / pre-prod / production / post-prod) and use the Release / milestone tracker in §14 alongside this template.

---

## 16. Capacity Calendar (multi-sprint)

Track each member's working days across upcoming sprints to feed Planning. Numbers are `available days / total working days` per sprint.

```markdown
## Capacity Calendar — [Team] — Sprints [N] to [N+M]

| Member         | Sprint [N] | Sprint [N+1] | Sprint [N+2] | Sprint [N+3] | Notes                      |
| -------------- | ---------- | ------------ | ------------ | ------------ | -------------------------- |
| Alice          | 9/10       | 10/10        | 8/10         | 10/10        | Conference S[N+2]          |
| Bob            | 10/10      | 7/10         | 10/10        | 5/10         | PTO S[N+1], surgery S[N+3] |
| Carol          | 10/10      | 10/10        | 9/10         | 10/10        | Public holiday S[N+2]      |
| **Team total** | 29/30      | 27/30        | 27/30        | 25/30        |                            |

### Notes

- **Available days** = working days minus absences and holidays
- **Effective capacity** = available days × focus factor (typically 0.6–0.7 for meetings, email, context-switching)
- Alert the team in retro when any member dips below 60% available
- Holidays affecting the whole team go in a separate row and reduce _Total_, not _Available_
```
