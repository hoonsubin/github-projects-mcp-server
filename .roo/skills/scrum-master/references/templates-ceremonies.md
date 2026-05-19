# Ceremony Templates

Copy-paste Markdown templates for ceremonies and story-level artifacts.
These are the minimal requirements. Adapt them into different format if required.
Management artifacts (velocity tracker, charter, roadmap, capacity calendar) → `templates-management.md`.

---

## PBI / User Story

```markdown
### [PBI-XXX] Title

**Type:** Feature / Bug / Tech Debt / Spike
**Priority:** High / Med / Low  **Estimate:** [SP]  **Epic:** [parent]

**User Story:** As a [user], I want [goal] so that [reason].

**Acceptance Criteria:**
- [ ] Given [context], when [action], then [outcome]

**Out of Scope:** [explicitly excluded]
**Dependencies:** [other PBIs / external blockers]
**Technical Notes:** [optional]

**DoR:** AC defined · estimate agreed · dependencies identified
```

---

## Definition of Ready

```markdown
# Definition of Ready — [Team]
_v[N] — [YYYY-MM-DD]_

An item enters Sprint Planning only if ALL are true:
- [ ] User-story format (who / what / why)
- [ ] Acceptance criteria defined and agreed by PO + team
- [ ] Estimated by the dev team
- [ ] Dependencies identified, resolved or de-risked
- [ ] UI/UX mockups attached (if applicable)
- [ ] Small enough to complete in one sprint
```

---

## Definition of Done

```markdown
# Definition of Done — [Team]
_v[N] — [YYYY-MM-DD]_

**Build**
- [ ] Code written and self-reviewed
- [ ] Peer-reviewed and approved
- [ ] No new linter / static-analysis warnings

**Test**
- [ ] Unit tests written and passing
- [ ] AC verified by PO or designee
- [ ] Regression tests clean

**Docs**
- [ ] Inline comments updated (if applicable)
- [ ] User-facing docs updated (if applicable)

**Deploy**
- [ ] Deployed to staging
- [ ] No critical bugs introduced
```

---

## Sprint Planning Board

```markdown
## 🏃 Sprint [N] — [Start] to [End]

### Sprint Goal
> _One outcome-based sentence._

### Capacity

| Member | Avail Days | Notes |
|---|---|---|
| [Name] | [X] | [e.g. 2d PTO] |
| **Total** | | |

### Sprint Backlog

| ID | Title | Owner | Est | Status |
|---|---|---|---|---|
| PBI-001 | | | | 🔵 To Do |

**Status:** 🔵 To Do · 🟡 In Progress · 🟠 In Review · ✅ Done · 🔴 Blocked
```

---

## Sprint Planning Agenda

```markdown
## Sprint [N] Planning — [YYYY-MM-DD]
**Timebox:** [X] hr  **Sprint:** [Start] → [End]  **Facilitator:** [SM]

### 1. Capacity (10 min)

| Member | Days | Focus Factor | Effective Days |
|---|---|---|---|
| | | 0.65 | |
| **Total** | | | |

### 2. Sprint Goal (10 min)
> **PO proposes:** _[outcome sentence]_
> **Agreed:** _[final]_

### 3. Item Selection

| PBI | Title | Est | Owner | Notes |
|---|---|---|---|---|
| | | | | |
| **Total SP** | | | | |

### 4. Commitment
> [ ] Achievable given capacity? Yes — close  /  No — remove: [items]
```

---

## Daily Standup Log

```markdown
## Standup — Sprint [N]

| Date | Done | Doing | Blockers |
|---|---|---|---|
| YYYY-MM-DD | | | |
```

**Async format (remote teams):**

```markdown
## Standup — [YYYY-MM-DD]

**[Name]**
- ✅ Done: [moves the Goal]
- 🔜 Today: [plan]
- 🚧 Blockers: [none / describe]
```

---

## Sprint Review Notes

```markdown
## Sprint [N] Review
**Date:** [YYYY-MM-DD]  **Goal:** [restate]  **Achieved?** ✅/❌/⚠️
**Attendees:** [names / stakeholder roles]

### Demo

| Item | Status | Stakeholder Feedback |
|---|---|---|
| PBI-001 | ✅ Done | [feedback] |
| PBI-002 | ❌ Not Done | [reason] |

### Backlog Changes from Feedback
- [new or reprioritised items]

### Sprint Summary

| Field | Value |
|---|---|
| Committed SP | |
| Completed SP | |
| Commitment Ratio | |
| Key Decisions | |
| Open Impediments | |
```

---

## Retrospective

```markdown
## Sprint [N] Retrospective
**Date:** [YYYY-MM-DD]  **Facilitator:** [SM]
**Format:** Start/Stop/Continue _(or 4Ls / Sailboat / Mad-Sad-Glad / KALM / 5 Whys / Timeline)_

### Observations

| Category | Observations |
|---|---|
| ✅ Went well | |
| ⚠️ Needs improvement | |
| 🚀 Start | |
| 🛑 Stop | |

### Committed Improvement for Sprint [N+1]
> _One specific, actionable, measurable change._

### Follow-up: Last Sprint's Commitment
> **From Sprint [N-1]:** [state it]
> **Followed through?** ✅/❌/⚠️  **Notes:** [what happened]
```
