# Markwhen Full Syntax Reference

Source: https://docs.markwhen.com/syntax/

---

## Table of Contents
1. [Header / Frontmatter](#header)
2. [Events](#events)
3. [Date Formats](#dates)
4. [Relative Dates](#relative)
5. [Event IDs and Dependencies](#ids)
6. [Due Dates](#due)
7. [Sections](#sections)
8. [Tags](#tags)
9. [Properties](#properties)
10. [Recurring Events](#recurring)
11. [Weekdays](#weekdays)
12. [Comments](#comments)
13. [Quick Reference Table](#quickref)

---

## 1. Header / Frontmatter {#header}

Everything before the first event is the header. Optional `---` delimiters are supported (YAML frontmatter style).

```
---
title: My Timeline
description: Optional longer description
timezone: Europe/Berlin
dateFormat: d/M/y   # Use European date formatting (d/M/y). Default is American M/d/y
#Work: blue
#Personal: green
#Urgent: red
---
```

### Supported Header Fields

| Field | Description | Example |
|-------|-------------|---------|
| `title` | Page/document title | `title: Q2 Roadmap` |
| `description` | Additional context | `description: Planning doc for Q2` |
| `timezone` | IANA timezone or offset | `timezone: Europe/Berlin` or `timezone: +1` |
| `dateFormat` | Switch to European formatting | `dateFormat: d/M/y` |
| `#TagName: color` | Color for a tag | `#Feature: "#3b82f6"` |

Colors can be named CSS colors (`blue`, `red`, `orange`, `green`, `yellow`, `aquamarine`, etc.) or hex codes (`#a13bbb`).

---

## 2. Events {#events}

Basic event syntax:
```
DateRange: Event description
```

With tag:
```
2026-05-01/2026-06-30: Project milestone #TagName
```

With properties and checklist (indented under event line):
```
2026-05-01/2026-06-30: Feature development #Feature
  id: feature-dev
  assignees: [Alice, Bob]
  contact: alice@example.com
  location: "Munich, Germany"
  - [ ] Write spec
  - [x] Code review done
  - [ ] Deploy
```

With markdown-style link and image in description:
```
2026-06-01: [Project launch](https://example.com) #Launch
2026-07-04: July 4th event ![](https://example.com/photo.jpg) #Holiday
```

---

## 3. Date Formats {#dates}

### EDTF (Recommended — unambiguous)

```
2026                  # whole year
2026-05               # whole month
2026-05-01            # single day
2026-05-01/2026-08-31 # explicit range
2026-05/2026-08       # month-level range
2026-05/6 months      # start + duration
```

### American (default non-EDTF)

```
05/01/2026            # May 1, 2026
05/2026               # May 2026
05/01/2026-08/31/2026 # range
```

### European (requires `dateFormat: d/M/y` in header)

```
01/05/2026            # May 1, 2026
01/05/2026-31/08/2026 # range
```

### Casual

```
May 1 2026
18 March 2026
March 16 12:19pm
4 January 1996
Oct 8 2012 9am
```

### ISO8601 (full precision, T and Z required)

```
2026-05-01T09:00:00Z
2031-11-19T01:35:10Z-2099-08-04T18:22:48Z
```

### Granularity / Implicit End Dates

If no end date is given, the event lasts through the end of its granularity:

| Written | Inferred End |
|---------|-------------|
| `2026` | Dec 31, 2026 |
| `2026-05` | May 31, 2026 |
| `2026-05-01` | May 1, 2026 (whole day) |

---

## 4. Relative Dates {#relative}

Relative dates base themselves on the **end of the previous event** (top-to-bottom parse order). Use for serial/dependent workflows.

```
// Sequential phases
2026-01-01 - 2 weeks: Phase 1
1 month: Phase 2       // starts immediately after Phase 1, lasts 1 month
2 weeks: Phase 3       // starts immediately after Phase 2, lasts 2 weeks
1 week - 3 days: Phase 4  // starts 1 week after Phase 3, lasts 3 days
```

Supported duration units:
`milliseconds`, `seconds`, `minutes`, `hours`, `days`, `weeks`, `months`, `years`

### Two-part relative range: `X - Y`

`X days - Y weeks` means: start X days after previous event, last Y weeks.

```
2026-01-01 - 2 weeks: Buffer period, lasts 2 weeks
5 days - 3 weeks: 5-day offset, then 3-week task
```

---

## 5. Event IDs and Dependencies {#ids}

Assign an ID property to reference an event elsewhere.

```
2026-01-15/2 weeks: Sprint 1
  id: sprint1

after !sprint1 2 weeks: Sprint 2           // starts at end of sprint1
after !sprint1 3 weeks: Parallel track     // also starts at end of sprint1
```

The word `after` is optional:
```
!sprint1 2 weeks: Sprint 2    // equivalent
```

### `.start` and `.end` Modifiers

```
2026-01-01/2026-03-31: Phase A
  id: phaseA
2026-04-01/2026-06-30: Phase B
  id: phaseB

!phaseA.start / !phaseB.end: Full project window (Phase A start → Phase B end)
!phaseA.end / !phaseB.start: Gap between phases
```

### Dependency Span

```
!event1 / !event2: Span from end of event1 to start of event2
```

---

## 6. Due Dates {#due}

Express events that must finish *before* a deadline:

```
2026-12-01: Submission deadline
  id: deadline

before !deadline 1 week: Final proofread    // ends 1 week before deadline
before !deadline 2 weeks - 1 month: Camera-ready  // ends 2 weeks before, lasts 1 month
```

`by` and `before` are equivalent:
```
by !deadline 1 week: Proofread
```

**Important**: Event IDs must be defined *before* they are referenced — define your anchor deadlines first.

---

## 7. Sections {#sections}

Use Markdown-style `#` through `######` headers to group events. Sections auto-close at the same or higher level.

```
# Phase 1: Planning

2026-01/2026-02: Requirements gathering

## Research

2026-01-15/3 weeks: Literature review

## Design

2026-02-01/2 weeks: Architecture

# Phase 2: Implementation

2026-03-01/3 months: Development
```

### Section style

By default, sections render as collapsible groups. To render as a full-width section band:

```
# My Section
style: section

2026-01: Event inside section-style container
```

---

## 8. Tags {#tags}

Tags are `#words` in event descriptions. Define colors in the header.

```yaml
# Header
#Backend: "#3b82f6"
#Frontend: orange
#Blocked: red
#Done: green
```

```
2026-03/1 month: Auth service #Backend
2026-04/2 weeks: Login page #Frontend #Blocked
```

Multiple tags per event are supported. Tags are also used in sections:

```
## Backend Work #Backend
```

---

## 9. Properties {#properties}

Properties are key-value pairs written on indented lines directly under an event:

```
2026-05/3 months: Feature work
  id: feature              // referenced with !feature
  assignees: [Alice, Bob]
  contact: alice@example.com
  location: "Munich, Germany"
  - [ ] Write spec
  - [x] Code review
  - [ ] Ship
```

Standard property keys:
- `id` — event identifier, used for `!id` references
- `assignees` — list of assignees `[Name1, Name2]`
- `contact` — email or contact info
- `location` — place string

Any custom key-value pair is also valid and will be stored in the parsed AST.

---

## 10. Recurring Events {#recurring}

```
October 7, 1989 every year for 10 years: Annual review
2026-03-04 every week for 12 weeks: Weekly standup
2026-01/2026-03 every 2 years x9: Bi-annual event (9 times)
Feb 1 2026 every 6 months for 10 times: Semi-annual check-in
```

General syntax:
```
[date] every [duration] (for [count | duration]) | x[count]
```

---

## 11. Weekdays {#weekdays}

Use `business days`, `weekdays`, or `work days` to count only Mon–Fri:

```
2026-05-01 - 5 business days: Short sprint
10 weekdays: Follow-up work
```

Does not account for holidays — weekends only.

---

## 12. Comments {#comments}

```
// This line is ignored by the parser
```

---

## 13. Quick Reference {#quickref}

| Item | Syntax | Example |
|------|--------|---------|
| Single-day event | `YYYY-MM-DD: Description` | `2026-05-01: Launch day` |
| Date range | `start/end: Description` | `2026-05/2026-08: Build phase` |
| Duration range | `start/N units: Description` | `2026-05-01/3 months: Milestone` |
| Tag inline | `#tagname` in description | `2026-05: Feature work #Backend` |
| Tag color in header | `#tag: color` | `#Backend: blue` |
| Section header | `# Title` | `# Phase 1` |
| Comment | `// text` | `// this is skipped` |
| Event ID | `id: name` (property) | `id: sprint1` |
| Reference ID | `after !name duration` | `after !sprint1 2 weeks: ...` |
| Due date | `before !name duration` | `before !deadline 1 week: ...` |
| Dependency span | `!a / !b` | `!phase1 / !phase2: Gap` |
| Checklist item | `- [ ] text` | `- [ ] Write spec` |
| Checked item | `- [x] text` | `- [x] Done` |
| Relative date | `N units` | `2 weeks: Next sprint` |
| Recurring | `date every N unit for M times` | `2026-01 every week for 12 weeks: Standup` |
| Weekdays | `N business days` | `5 business days: Sprint` |
| Image | `![alt](url)` | `![](https://example.com/img.png)` |
| Link | `[text](url)` | `[Docs](https://docs.markwhen.com)` |
