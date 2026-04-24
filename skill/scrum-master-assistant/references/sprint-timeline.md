# Sprint Timelines & Release Roadmaps (Markwhen)

## Table of Contents
1. [Single Sprint Timeline](#1-single-sprint-timeline)
2. [Multi-Sprint Release Roadmap](#2-multi-sprint-release-roadmap)
3. [Team Capacity Calendar](#3-team-capacity-calendar)
4. [Scrum of Scrums / Program Increment](#4-scrum-of-scrums--program-increment)
5. [Usage Notes](#5-usage-notes)

---

## 1. Single Sprint Timeline

Complete ceremony scaffold for a 2-week sprint. Adjust `2026-05-05` to your actual sprint start.

```markwhen
---
title: Sprint [N] — [Team Name]
timezone: Europe/Berlin
#Planning: "#4a90d9"
#Review: "#f59e0b"
#Retro: "#10b981"
#Refinement: "#8b5cf6"
#Milestone: "#ef4444"
---

// ─── Sprint Container ───────────────────────────────────────────────
2026-05-05/2 weeks: Sprint [N]
  id: sprint

// ─── Ceremonies ─────────────────────────────────────────────────────
2026-05-05/4h: Sprint Planning #Planning
  id: planning
  location: Conference Room / Remote
  - [ ] PO presents Sprint Goal
  - [ ] Team selects items
  - [ ] Sprint Backlog agreed

2026-05-05 every day for 10 days: Daily Standup (15 min) #Milestone
  id: standup

2026-05-15/2h: Sprint Review #Review
  id: review
  - [ ] Demo only Done increments
  - [ ] Stakeholder feedback captured
  - [ ] Backlog updates noted

2026-05-15/1h30m: Sprint Retrospective #Retro
  id: retro
  - [ ] One committed improvement decided

// ─── Mid-Sprint Refinement ──────────────────────────────────────────
after !planning 5 days / 2h: Backlog Refinement #Refinement
  id: refinement
  - [ ] Top 10 items refined for next sprint

// ─── Burndown Milestones ────────────────────────────────────────────
2026-05-07: Burndown check (25% through)
2026-05-09: Burndown check (50% through)
2026-05-13: Burndown check (75% through)
before !sprint.end 1 day: Sprint freeze (no new items)
  id: freeze
```

---

## 2. Multi-Sprint Release Roadmap

Release made of 4 sprints; each sprint chains from the last.

```markwhen
---
title: [Product] Release Roadmap — Q2 2026
timezone: Europe/Berlin
#Sprint: "#3b82f6"
#Milestone: "#ef4444"
#QA: "#f59e0b"
#Release: "#10b981"
---

// ─── Sprint Chain ────────────────────────────────────────────────────
2026-04-07/2 weeks: Sprint 1 — Foundation #Sprint
  id: s1
  - Core authentication flow
  - Data model setup

after !s1 2 weeks: Sprint 2 — Core Features #Sprint
  id: s2
  - User dashboard
  - API integration

after !s2 2 weeks: Sprint 3 — Polish & Edge Cases #Sprint
  id: s3
  - Error handling
  - Performance improvements

after !s3 2 weeks: Sprint 4 — Hardening #Sprint
  id: s4
  - Regression testing
  - Docs & release notes

// ─── QA & Release ────────────────────────────────────────────────────
after !s3 3 days / 1 week: QA Cycle #QA
  id: qa

after !qa 3 days: Release Candidate freeze #Milestone
  id: rc

2026-06-30: Target Release Date #Release
  id: release_date

before !release_date 3 days: Stakeholder sign-off #Milestone
before !release_date 1 week: Final regression pass #QA
```

---

## 3. Team Capacity Calendar

Track absences and holidays per person to feed Sprint Planning.

```markwhen
---
title: Team Capacity — Sprint [N]
timezone: Europe/Berlin
#Alice: "#4a90d9"
#Bob: "#f59e0b"
#Carol: "#10b981"
#Holiday: "#9ca3af"
---

// ─── Sprint Window ───────────────────────────────────────────────────
2026-05-05/2 weeks: Sprint [N]
  id: sprint

// ─── Public Holidays ─────────────────────────────────────────────────
2026-05-09: Public Holiday — [Name] #Holiday

// ─── Individual Absences ─────────────────────────────────────────────
2026-05-07/2 days: Alice — Conference travel #Alice
2026-05-13: Bob — Medical appointment #Bob

// ─── Capacity Summary (add as comment) ───────────────────────────────
// Sprint working days: 9 (10 - 1 holiday)
// Alice: 7 / 9 days (78%)
// Bob:   8 / 9 days (89%)
// Carol: 9 / 9 days (100%)
// Team focus factor: 0.65
// Effective capacity: (7+8+9) * 0.65 = 15.6 person-days
```

---

## 4. Scrum of Scrums / Program Increment

For multi-team coordination across a Program Increment (PI).

```markwhen
---
title: Program Increment 3 — 2026
timezone: Europe/Berlin
#TeamA: "#3b82f6"
#TeamB: "#f59e0b"
#TeamC: "#10b981"
#SoS: "#8b5cf6"
#PI: "#ef4444"
---

// ─── PI Window ───────────────────────────────────────────────────────
2026-04-01/3 months: PI 3 — Q2 2026
  id: pi3

// ─── Team Sprints (all teams, same cadence) ──────────────────────────
# Team A

2026-04-07/2 weeks: Team A — Sprint 7 #TeamA
  id: ta_s7
after !ta_s7 2 weeks: Team A — Sprint 8 #TeamA
  id: ta_s8
after !ta_s8 2 weeks: Team A — Sprint 9 #TeamA

# Team B

2026-04-07/2 weeks: Team B — Sprint 7 #TeamB
  id: tb_s7
after !tb_s7 2 weeks: Team B — Sprint 8 #TeamB
after last 2 weeks: Team B — Sprint 9 #TeamB

# Coordination

2026-04-07 every 2 weeks for 6 iterations: Scrum of Scrums #SoS

// ─── PI Milestones ────────────────────────────────────────────────────
2026-04-01/3 days: PI Planning #PI
2026-06-25/1 day: PI Demo & Inspect #PI
2026-06-26: PI Retrospective #PI
```

---

## 5. Usage Notes

**Rendering:** `mw sprint.mw output.html` — opens a self-contained Gantt+calendar.

**Sprint template workflow:**
1. Copy template 1 → fill in team name, sprint number, start date
2. Adjust ceremony durations to match your team's actual timeboxes
3. Commit `.mw` file to git alongside your sprint markdown artifacts
4. Re-render each sprint for the team dashboard or stakeholder view

**Naming convention (recommended):**
```
docs/
  sprints/
    sprint-07.mw
    sprint-07.md        ← sprint planning board + retro notes
    sprint-08.mw
    sprint-08.md
  release/
    q2-2026-roadmap.mw
```

**Tags:** Define one colour per person for capacity calendar; one colour per ceremony type for sprint timeline. Consistent colour coding makes the Gantt scannable at a glance.
