# Scrum Artifact Templates

## Table of Contents
1. [Product Backlog Item (User Story)](#1-product-backlog-item-user-story)
2. [Definition of Ready (DoR)](#2-definition-of-ready-dor)
3. [Definition of Done (DoD)](#3-definition-of-done-dod)
4. [Sprint Planning Board](#4-sprint-planning-board)
5. [Daily Standup Log](#5-daily-standup-log)
6. [Sprint Review Notes](#6-sprint-review-notes)
7. [Sprint Retrospective](#7-sprint-retrospective)
8. [Full Sprint Archive Page](#8-full-sprint-archive-page)
9. [Impediment Log](#9-impediment-log)
10. [Decision Log](#10-decision-log)
11. [Team Charter](#11-team-charter)
12. [Velocity Tracker](#12-velocity-tracker)
13. [Sprint Kickoff Agenda](#13-sprint-kickoff-agenda)

---

## 1. Product Backlog Item (User Story)

```markdown
### [PBI-XXX] Title

**Type:** Feature / Bug / Tech Debt / Spike  
**Priority:** High / Medium / Low  
**Estimate:** [story points]  
**Epic:** [parent epic name or link]

**User Story:**  
As a [type of user], I want [some goal] so that [some reason].

**Acceptance Criteria:**
- [ ] Given [context], when [action], then [outcome]
- [ ] Given [context], when [action], then [outcome]

**Out of Scope:**
- [explicitly what this story does NOT cover]

**Dependencies:** [other PBIs or external blockers]

**Technical Notes:** [optional]

**Definition of Ready:**
- [ ] Acceptance criteria defined
- [ ] Estimate agreed
- [ ] Dependencies identified
- [ ] UI/UX considerations documented (if applicable)
```

---

## 2. Definition of Ready (DoR)

```markdown
# Definition of Ready — [Team Name]
_Version [N] — Updated [YYYY-MM-DD]_

A backlog item may enter Sprint Planning only if ALL of the following are true:

- [ ] Written in user story format or equivalent (clear "who / what / why")
- [ ] Acceptance criteria clearly defined and agreed by PO + team
- [ ] Estimated by the development team
- [ ] Dependencies identified and either resolved or de-risked
- [ ] UI/UX mockups or wireframes attached (if applicable)
- [ ] Technical approach understood at a high level
- [ ] Testing requirements outlined
- [ ] Item is small enough to be completed within a single sprint
```

---

## 3. Definition of Done (DoD)

```markdown
# Definition of Done — [Team Name]
_Version [N] — Updated [YYYY-MM-DD]_

A Product Backlog Item is Done only when ALL of the following are true:

**Development**
- [ ] Code written and self-reviewed
- [ ] Code reviewed and approved by at least one peer
- [ ] No new linting or static analysis warnings

**Testing**
- [ ] Unit tests written and passing (min. [X]% coverage)
- [ ] Integration tests passing
- [ ] Acceptance criteria verified by PO or designee
- [ ] Regression tests run and clean

**Documentation**
- [ ] Inline code comments updated (if applicable)
- [ ] User-facing documentation updated (if applicable)
- [ ] API documentation updated (if applicable)

**Deployment**
- [ ] Feature deployed to staging environment
- [ ] No critical bugs introduced
- [ ] Deployed to production (if continuous deployment in use)
```

---

## 4. Sprint Planning Board

```markdown
## 🏃 Sprint [N] — [Start Date] to [End Date]

### Sprint Goal
> _One outcome-based sentence describing what change this sprint creates._
> Example: "Enable users to complete checkout as a guest, reducing abandonment."

### Capacity Plan

| Team Member | Available Days | Planned Hours | Notes |
|---|---|---|---|
| [Name] | [X] | [Y] | [e.g., 2 days PTO] |
| **Total** | | | |

### Sprint Backlog

| ID | Title | Assigned To | Estimate | Status |
|---|---|---|---|---|
| PBI-001 | | | | 🔵 To Do |
| PBI-002 | | | | 🟡 In Progress |
| PBI-003 | | | | 🟠 In Review |
| PBI-004 | | | | ✅ Done |

**Status Key:** 🔵 To Do · 🟡 In Progress · 🟠 In Review · ✅ Done · 🔴 Blocked

### Burndown Tracker

| Day | Remaining Points | Notes |
|---|---|---|
| Day 1 | [N] | Sprint start |
| Day 3 | [N] | |
| Day 5 | [N] | |
| Day 7 | [N] | |
| Day 10 | [N] | Sprint end |
| **Ideal End** | 0 | |
```

---

## 5. Daily Standup Log

```markdown
## Daily Standup Log — Sprint [N]

| Date | What was done | What will be done | Blockers |
|---|---|---|---|
| [YYYY-MM-DD] | | | |
| [YYYY-MM-DD] | | | |
```

---

## 6. Sprint Review Notes

```markdown
## Sprint [N] Review

**Date:** [YYYY-MM-DD]  
**Sprint Goal:** [restate the goal]  
**Goal Achieved?** ✅ Yes / ❌ No / ⚠️ Partially  
**Attendees:** [names / stakeholder roles]

### Increment Demo

| Item | Status | Stakeholder Feedback |
|---|---|---|
| PBI-001: [Title] | ✅ Done | [feedback] |
| PBI-002: [Title] | ❌ Not Done | [reason] |

### Backlog Changes Triggered by Feedback
- [New item or reprioritization]

### Sprint Summary

| Field | Value |
|---|---|
| Committed Points | |
| Completed Points | |
| Velocity | [X]% commitment ratio |
| Key Decisions Made | |
| Impediments Encountered | |
```

---

## 7. Sprint Retrospective

```markdown
## Sprint [N] Retrospective

**Date:** [YYYY-MM-DD]  
**Facilitator:** [Scrum Master name]  
**Format:** Start/Stop/Continue _(or: 4Ls / Sailboat / Mad-Sad-Glad)_

### Observations

| Category | Observations |
|---|---|
| ✅ What went well | |
| ⚠️ What needs improvement | |
| 🚀 What to start doing | |
| 🛑 What to stop doing | |

### Committed Improvement for Sprint [N+1]
> _One specific, actionable, measurable change the team commits to._
> Example: "Update the board immediately after standup — not end of day."

### Follow-up: Last Sprint's Commitment
> **Commitment from Sprint [N-1]:** [state it]  
> **Did we follow through?** ✅ Yes / ❌ No / ⚠️ Partially  
> **Notes:** [what happened]
```

---

## 8. Full Sprint Archive Page

Use this to preserve sprint history (move here after sprint closes).

```markdown
# Sprint Archive

## Sprint [N] — [Start Date] to [End Date]

| Field | Value |
|---|---|
| Sprint Goal | |
| Goal Achieved? | ✅ / ❌ / ⚠️ |
| Committed Points | |
| Completed Points | |
| Retro Commitment | |
| Retro Commitment Followed Through? | |

_[Paste full sprint backlog table here for historical reference]_
```

---

## 9. Impediment Log

```markdown
## Impediment Log — Sprint [N]

| # | Impediment | Raised By | Date Raised | Owner | Status | Date Resolved |
|---|---|---|---|---|---|---|
| 1 | [Description] | [Name] | [Date] | [SM] | 🔴 Open | |
| 2 | [Description] | [Name] | [Date] | [SM] | ✅ Resolved | [Date] |

**Rule:** Any impediment open for more than 2 days without progress must be escalated by the Scrum Master.
```

---

## 10. Decision Log

```markdown
## Decision Log

> Append-only. Never edit or delete entries — only add new entries that supersede prior ones.

| # | Decision | Alternatives Considered | Rationale | Owner | Date |
|---|---|---|---|---|---|
| D-001 | [Decision made] | [What else was considered] | [Why this was chosen] | [Name] | [Date] |
```

---

## 11. Team Charter

```markdown
# Team Charter — [Team Name]
_Version [N] — [YYYY-MM-DD]_

## Team Members
| Name | Role | Availability |
|---|---|---|
| | | |

## Our Sprint Cadence
- Sprint length: [X] weeks
- Planning: [day + time]
- Daily Standup: [time], [sync/async]
- Review: [day + time]
- Retrospective: immediately after Review / [day + time]

## Working Agreements
_How we agree to work together. Revisit every quarter._

1. We update the Sprint Backlog immediately after standup — not end of day.
2. We raise blockers the day they appear — not when they've been sitting for a week.
3. We swarm on in-progress items before pulling new ones.
4. The Retrospective is sacred — we never skip it.
5. [Add team-specific agreements here]

## Communication Norms
- Primary sync channel: [e.g., team chat thread]
- Urgent issues: [e.g., direct message to SM + PO]
- Decision record: Decision Log (append-only markdown)
- Async standup deadline: [09:30 / agreed time]

## Definition of Done — v[N]
_See separate DoD document. Reviewed at every retrospective._

## Definition of Ready — v[N]
_See separate DoR document. Reviewed quarterly._
```

---

## 12. Velocity Tracker

```markdown
## Velocity Tracker — [Team Name]

| Sprint | Start Date | End Date | Committed SP | Completed SP | Commitment Ratio | Sprint Goal Met? | Retro Commitment |
|---|---|---|---|---|---|---|---|
| Sprint 1 | | | | | | ✅/❌/⚠️ | |
| Sprint 2 | | | | | | ✅/❌/⚠️ | |
| Sprint 3 | | | | | | ✅/❌/⚠️ | |
| **3-Sprint Avg** | | | | | | | |

### Velocity Chart (text sparkline)

```
Sprint:  1    2    3    4    5    6
SP:      18   22   19   24   21   23
         ▄    █    ▅    ██   ▇    ██
```

### Notes
- Planning velocity = average of last 3 completed sprints
- Never use velocity as a performance target; use it as a planning input only
- If commitment ratio consistently < 80%: address in retrospective (planning accuracy problem)
- If commitment ratio consistently > 100%: address in retrospective (over-conservative commitment or scope changes mid-sprint)
```

---

## 13. Sprint Kickoff Agenda

For teams starting sprint planning — print or paste into the meeting doc.

```markdown
## Sprint [N] Planning — [YYYY-MM-DD]

**Timebox:** [X] hours  
**Sprint Dates:** [Start] → [End]  
**Facilitator:** [Scrum Master]

---

### 1. Capacity Check (10 min)

| Team Member | Available Days | Focus Factor | Effective Days |
|---|---|---|---|
| | | 0.65 | |
| **Total** | | | |

---

### 2. Sprint Goal (10 min)

> **Proposed by PO:** _[one outcome-based sentence]_
>
> **Agreed Goal:** _[finalised by team]_

---

### 3. Item Selection

| PBI ID | Title | Estimate | Assigned To | Notes |
|---|---|---|---|---|
| | | | | |
| **Total SP** | | | | |

---

### 4. Commitment Confirmation

> Does the team believe this Sprint Backlog is achievable given our capacity?
> [ ] Yes — Sprint Planning closed
> [ ] No — remove items: [which ones]
```
