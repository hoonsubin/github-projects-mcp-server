# Markwhen Project Management Templates

Ready-to-use `.mw` templates for common use cases.

---

## 1. Conference Paper / Academic Submission

```mw
---
title: Paper Submission Tracker
timezone: Europe/Berlin
#Writing: "#4a90d9"
#Review: orange
#Admin: gray
#Milestone: "#e11d48"
---

// Define hard deadline first
2026-09-15: Submission deadline
  id: deadline

// Working backward and forward from start
2026-04-01/3 weeks: Related work & literature review #Writing
  id: litreview

after !litreview 4 weeks: First draft #Writing
  id: draft1

after !draft1 1 week: Supervisor review #Review
  id: review1

after !review1 2 weeks: Second draft (revisions) #Writing
  id: draft2

after !draft2 1 week: Co-author review #Review
  id: review2

before !deadline 4 weeks - 2 weeks: Final revision and formatting #Writing
before !deadline 2 weeks - 1 week: Proofread and check references #Admin
before !deadline 1 week: Final submission prep and camera-ready #Admin #Milestone
```

---

## 2. Software Sprint Board

```mw
---
title: Sprint Tracker – Q2 2026
timezone: Europe/Berlin
#Feature: blue
#Bug: red
#DevOps: purple
#QA: green
---

# Sprint 1

2026-04-07/2026-04-18: Sprint 1
  id: s1

  2026-04-07/1 day: Sprint planning
  2026-04-08/6 business days: Development #Feature
  after !s1 -3 days - 2 days: QA / testing #QA
  2026-04-18/1 day: Sprint review + retro

// Bug fixes tracked separately
2026-04-10: Hotfix – auth regression #Bug
  id: hotfix1

# Sprint 2

after !s1 2 weeks: Sprint 2
  id: s2

  2 days: Planning
  8 business days: Development #Feature
  3 days: QA #QA
  1 day: Review + retro

# Sprint 3

after !s2 2 weeks: Sprint 3
  id: s3
```

---

## 3. PhD / Dissertation Timeline

```mw
---
title: PhD Timeline
timezone: Europe/Berlin
#Research: "#4a90d9"
#Writing: green
#Admin: gray
#Milestone: "#e11d48"
---

# Year 1

2024-10/6 months: Literature review & gap analysis #Research
  id: litreview

after !litreview 3 months: Research design & methodology #Research
  id: design

# Year 2

after !design 6 months: Data collection / fieldwork #Research
  id: data

after !data 3 months: Data analysis #Research
  id: analysis

# Year 3

after !analysis 6 months: Writing dissertation #Writing
  id: writing

after !writing 2 months: Internal review & revisions #Writing
  id: revisions

2027-10-01: Submission #Milestone
  id: submission

before !submission 1 month: Format check & final edits #Admin
before !submission 2 weeks: Print & bind #Admin

2027-12-01: Viva / Defence #Milestone
```

---

## 4. Product Roadmap

```mw
---
title: Product Roadmap 2026
#Discovery: "#8b5cf6"
#Build: "#3b82f6"
#Launch: "#10b981"
#Maintenance: gray
---

# Q1 2026

2026-01/2 months: User research & discovery #Discovery
  id: discovery
  assignees: [Product, Design]

after !discovery 1 month: Prototype & validation #Discovery
  id: prototype

# Q2 2026

after !prototype 3 months: Build v1.0 #Build
  id: v1
  - [ ] Backend API
  - [ ] Frontend UI
  - [ ] Auth
  - [ ] Tests

2026-06-30: v1.0 Launch #Launch
  id: launch

# Q3–Q4 2026

after !launch 1 month: Post-launch fixes #Maintenance
after !launch 2 months - 3 months: v1.1 Feature set #Build
```

---

## 5. Personal / Weekly Planner

```mw
---
title: April–June 2026
timezone: Europe/Berlin
dateFormat: d/M/y
#Work: blue
#Personal: green
#Health: orange
#Admin: gray
---

# April 2026

2026-04-07/2026-04-11: Work week 15 #Work
  - [x] Submit expense report
  - [ ] Prepare slides for talk

2026-04-14: Doctor appointment #Health
2026-04-17/2026-04-19: Conference travel #Work
  - [ ] Book hotel
  - [x] Register

2026-04-25/1 week: Family visit #Personal

# May 2026

2026-05-01/2026-05-31: Thesis chapter draft #Work
  id: chapter
  - [ ] Outline (1 week)
  - [ ] Draft sections (2 weeks)
  - [ ] Revise (1 week)

before !chapter.end 3 days: Send to supervisor #Work

2026-05-15: Car service #Admin
```

---

## 6. Event / Conference Planning

```mw
---
title: CARRI Colloquium Planning
timezone: Europe/Berlin
#Venue: purple
#Content: blue
#Comms: orange
#Logistics: gray
#Milestone: red
---

2026-09-01: Planning kickoff
  id: kickoff

after !kickoff 2 weeks: Venue confirmed #Venue
  id: venue

after !kickoff 1 month: Call for abstracts sent #Comms
  id: cfa
  - [ ] Write CFP text
  - [ ] Send to mailing list

after !cfa 6 weeks: Abstract submission deadline #Milestone
  id: abstract-deadline

after !abstract-deadline 2 weeks: Acceptance notifications #Comms

// Target event date
2026-11-28: Colloquium day #Milestone
  id: event

before !event 2 weeks: Final programme published #Comms
before !event 1 week: Logistics confirmed #Logistics
  - [ ] Catering
  - [ ] AV setup
  - [ ] Room booking confirmed

before !event 3 days: Speaker briefing sent #Comms
```
