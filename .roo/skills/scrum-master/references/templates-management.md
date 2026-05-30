# Management & Tracking Templates

Copy-paste Markdown templates for team management, tracking, and planning artifacts.
Ceremony-level templates (PBI, DoR, DoD, planning board, standup, review, retro) → `templates-ceremonies.md`.

---

## Sprint Archive

```markdown
# Sprint Archive

## Sprint [N] - [Start] to [End]

| Field | Value |
|---|---|
| Goal | |
| Achieved | ✅/❌/⚠️ |
| Committed SP | |
| Completed SP | |
| Retro Commitment | |
| Followed Through | |

_[Paste full sprint backlog table for history]_
```

---

## Velocity Tracker

```markdown
## Velocity - [Team]

| Sprint | Start | End | Committed | Completed | Ratio | Goal Met | Retro Commitment |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | ✅/❌/⚠️ | |
| **3-Sprint Avg** | | | | | | | |

### Notes
- Planning velocity = avg of last 3 completed sprints
- Velocity is a planning input, not a performance target
- Ratio <80% consistently → planning accuracy issue
- Ratio >100% consistently → over-conservative or mid-sprint scope shifts
```

---

## Impediment Log

```markdown
## Impediment Log - Sprint [N]

| # | Impediment | Raised By | Date | Owner | Status | Resolved |
|---|---|---|---|---|---|---|
| 1 | | | | SM | 🔴 Open | |
| 2 | | | | SM | ✅ Resolved | |

**Rule:** Open >2 days without progress → SM escalates.
```

---

## Decision Log

```markdown
## Decision Log
> Append-only. Never edit or delete - only add new entries that supersede prior ones.

| # | Decision | Alternatives | Rationale | Owner | Date |
|---|---|---|---|---|---|
| D-001 | | | | | |
```

---

## Team Charter

```markdown
# Team Charter - [Team]
_v[N] - [YYYY-MM-DD]_

## Members

| Name | Role / Discipline | Availability |
|---|---|---|

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
4. Retrospective is sacred - never skipped.
5. [team-specific]

## Communication Norms
- Sync: [team chat thread]
- Urgent: DM SM + PO
- Decisions: append-only Decision Log
- Async standup deadline: [time]

## Definition of Done - v[N]
_See separate DoD; reviewed every retro._

## Definition of Ready - v[N]
_See separate DoR; reviewed quarterly._
```

---

## Release Roadmap (multi-sprint)

```markdown
## Release Roadmap - [Release Name / Quarter]

| Sprint | Dates | Sprint Goal | Key Deliverables | Status |
|---|---|---|---|---|
| Sprint 1 | YYYY-MM-DD → YYYY-MM-DD | Foundation | Core auth, data model | 🟢 Planned |
| Sprint 2 | YYYY-MM-DD → YYYY-MM-DD | Core features | User dashboard, API | 🟢 Planned |
| Sprint 3 | YYYY-MM-DD → YYYY-MM-DD | Polish & edges | Error handling, perf | 🟢 Planned |
| Sprint 4 | YYYY-MM-DD → YYYY-MM-DD | Hardening | Regression, docs, release notes | 🟢 Planned |

### Milestones
- **YYYY-MM-DD** - Stakeholder sign-off
- **YYYY-MM-DD** - Release candidate freeze
- **YYYY-MM-DD** - **Target release date**

**Status:** 🟢 Planned · 🔵 In Progress · ✅ Done · ⚠️ At Risk · 🔴 Blocked
```

*Game projects: map sprints to stages (concept / pre-prod / production / post-prod) and pair with the milestone tracker in `game-development.md` §8.*

---

## Capacity Calendar (multi-sprint)

```markdown
## Capacity Calendar - [Team] - Sprints [N] to [N+M]

| Member | Sprint [N] | Sprint [N+1] | Sprint [N+2] | Notes |
|---|---|---|---|---|
| Alice | 9/10 | 10/10 | 8/10 | Conference S[N+2] |
| Bob | 10/10 | 7/10 | 10/10 | PTO S[N+1] |
| **Team total** | 19/20 | 17/20 | 18/20 | |

### Notes
- Available days = working days minus absences and holidays
- Effective capacity = available days × focus factor (0.6–0.7)
- Alert the team in retro when any member dips below 60% available
```

---

## Game-team additions

*For multi-disciplinary teams (artists, designers, audio, QA, producer alongside programmers). Read `game-development.md` for the full context behind these.*

### DoD additions for cross-discipline teams

```markdown
**Art / Audio**
- [ ] Asset verified on target platform (not just dev PC)
- [ ] Asset budget respected (poly count, texture size, audio file size)
- [ ] Approved by art/audio director

**Design**
- [ ] Mechanic is playable end-to-end this sprint (no "parts on the floor")
- [ ] Tunable parameters exposed for designer
- [ ] Conditions of Satisfaction signed off by designer + QA

**QA**
- [ ] CoS verified on target platform(s)
- [ ] Regression tests run on adjacent areas
- [ ] No new high-priority bugs in bug database
```

### Sprint Backlog with Approval column

```markdown
| ID | Title | Owner | Est | To Do | WIP | In Review | Pending Approval | Done |
|---|---|---|---|---|---|---|---|---|

**Pending Approval rule:** items here are functionally complete; awaiting director or PO sign-off.
Items >2 days in this column are impediments.
```

### Game release / milestone tracker

```markdown
## Release Tracker - [Project]

| Milestone | Target Date | Stage | Status | Sprint |
|---|---|---|---|---|
| Concept Treatment | | Concept | | |
| Vertical Slice | | Pre-prod | | |
| Alpha (content complete) | | Production | | |
| Beta (feature complete) | | Production | | |
| Gold Master / Submission | | Post-prod | | |

**Hardening sprints** before alpha and gold: no new features; bugs + polish + cert prep only.
```
