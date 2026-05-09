---
name: markwhen
description: >
  Expert assistant for writing, reading, editing, and managing Markwhen (.mw) files for project planning,
  task tracking, and timeline creation. Use this skill whenever the user wants to create a Markwhen file,
  convert a project plan or task list into .mw format, parse or explain an existing .mw file, generate a
  Gantt-style timeline, manage deadlines and dependencies, or use the `mw` CLI to render a timeline or
  calendar as HTML. Also trigger for questions about Markwhen syntax (dates, tags, sections, relative dates,
  event IDs, recurrence), setting up the VS Code extension, or using Markwhen with Obsidian. If the user
  mentions "markwhen", ".mw files", "mw CLI", "timeline from text", or asks to track tasks with dates in
  plain text — use this skill immediately.
---

# Markwhen Skill

Markwhen is a plain-text, Markdown-inspired format for expressing timelines, project plans, and task lists.
Files use the `.mw` extension. They can be rendered locally into interactive HTML timelines or calendars
via the `mw` CLI — no cloud required.

## Tooling Setup (Local-First)

**VS Code extension** (recommended editor):
```
ext install Markwhen.markwhen
```
Provides syntax highlighting, live preview (timeline + calendar), and snippet support.

**Obsidian plugin**: Search "markwhen" in Community Plugins.

**CLI** (renders .mw → self-contained HTML):
```sh
npm i -g @markwhen/mw

mw project.mw                        # → project.mw.json (parsed AST)
mw project.mw timeline.html          # → self-contained timeline+Gantt HTML
mw project.mw calendar.html          # → calendar view HTML
```
All HTML output is fully self-contained (no external scripts). Git-friendly: commit `.mw` files, render on demand.

---

## File Structure

```
---
title: My Project
timezone: Europe/Berlin
#Feature: "#4a90d9"
#Bug: red
#Alice: yellow
---

# Phase 1: Research

2026-01/2026-02: Literature review #Alice
  id: lit-review
  - [x] Read 10 papers
  - [ ] Write summary

after !lit-review 3 weeks: Analysis #Alice
  id: analysis

## Phase 2: Writing

after !analysis 1 month: Draft paper
after !analysis 2 weeks - 1 week: Peer review slot

2026-12-01: Submission deadline
  id: deadline
```

---

## Core Syntax Reference

See `references/syntax.md` for the full reference. Summary below.

### Events
```
DateRange: Event description #tag
```

### Date Formats

| Format | Example |
|--------|---------|
| EDTF (recommended) | `2026-05-01`, `2026-05/2026-08` |
| Year only | `2026` |
| Month/year | `2026-05` |
| With time (ISO8601) | `2026-05-01T09:00:00Z` |
| American | `05/01/2026`, `05/2026` |
| European (needs `dateFormat: d/M/y` in header) | `01/05/2026` |
| Casual | `May 1 2026`, `18 March 2026 9am` |
| Relative (from prev event) | `2 weeks`, `3 months`, `5 business days` |
| Duration range | `2026-01/6 months` |

### Relative Dates
Relative dates chain from the previously defined date (top to bottom parse order).

```
// Sequential phases — each starts when the last ends
2026-01-01 - 2 weeks: Phase 1
1 month: Phase 2         // starts right after Phase 1
2 weeks: Phase 3         // starts right after Phase 2
```

### Event IDs & Dependencies
Assign an `id:` property, then reference with `!id`:

```
2026-01-15/2 weeks: Sprint 1
  id: sprint1

after !sprint1 1 week: Sprint 2
after !sprint1 2 weeks: Parallel workstream

// Due dates (ends before a milestone)
2026-12-01: Final deadline
  id: deadline
before !deadline 2 weeks: Final review
```

Dependency spans:
```
!sprint1 / !deadline: Full project window
!sprint1.end / !deadline.start: Time between sprint and deadline
```

### Sections & Nesting
Use `#` through `######` for hierarchy (Markdown-style headers):

```
# Project Alpha

## Backend

2026-01/3 months: API development

## Frontend

2026-02/2 months: UI implementation

# Project Beta

2026-03/6 months: Full build
```

Sections auto-close at same or higher heading level.

### Tags
Defined in header for color, used inline on events:

```yaml
# In header:
#Backend: "#3b82f6"
#Frontend: orange
#Blocked: red
```
```
2026-03/1 month: Auth service #Backend
2026-04/2 weeks: Login page #Frontend
```

### Event Properties
Key-value pairs indented under the event line:

```
2026-05/3 months: Feature development
  assignees: [Alice, Bob]
  contact: alice@example.com
  location: "Munich, Germany"
  id: feature-dev
  - [ ] Write spec
  - [ ] Implement
  - [x] Code review
```

### Recurring Events
```
2026-01-05 every week for 12 weeks: Weekly standup
2026-01-01 every month for 6 months: Monthly review
2026-03-01/2026-03-07 every 2 weeks x8: Bi-weekly sprint
```

### Comments
```
// This is a comment — ignored by the parser
```

---

## Project Management Patterns

See `references/patterns.md` for full templates.

### Pattern: Conference Paper Submission
```
---
title: Paper Submission Tracker
timezone: Europe/Berlin
#Writing: "#4a90d9"
#Review: orange
#Admin: gray
---

2026-03-01: Start writing
  id: start

after !start 6 weeks: First draft complete #Writing
  id: draft1

after !draft1 2 weeks: Supervisor feedback round #Review
  id: feedback

after !feedback 3 weeks: Revised draft #Writing
  id: draft2

// Submission is the anchor deadline
2026-06-30: Submission deadline
  id: submit

before !submit 1 week: Final proofread #Admin
before !submit 2 weeks: Format check #Admin
before !submit 1 month: Camera-ready version #Writing
```

### Pattern: Sprint-based Development
```
---
title: Sprint Board
#Feature: blue
#Bug: red
#DevOps: purple
---

# Sprint 1

2026-05-01/2 weeks: Sprint 1
  id: s1

  2026-05-01/3 days: Planning
  after !s1 1 week - 3 days: Implementation #Feature
  before !s1.end 2 days: Sprint review

# Sprint 2

after !s1 2 weeks: Sprint 2
  id: s2
```

### Pattern: Personal Task Timeline
```
---
title: Q2 2026 Tasks
#Personal: green
#Work: blue
#Health: orange
---

# April

2026-04-14: Doctor appointment #Health
2026-04-20/2026-04-25: Conference travel #Work
  - [x] Book flights
  - [ ] Book hotel
  - [ ] Prepare slides

# May

2026-05-01/2 months: Thesis chapter draft #Work
  id: chapter

before !chapter.end 1 week: Send to supervisor #Work
```

---

## Working with Markwhen Files

When a user provides an existing `.mw` file or asks to create one:

1. **Read** it as plain text — it's just YAML frontmatter + event lines.
2. **Generate** the file and explain each structural decision.
3. **Render** locally with the CLI: `mw file.mw output.html` — open in browser.
4. **Edit** freely in VS Code with the extension for live preview.

When converting from another format (e.g., a Markdown task list, a Notion export, a spreadsheet of dates):
- Map tasks/milestones → events with appropriate date ranges.
- Group related tasks into `#` sections.
- Add meaningful `#tag` labels for filtering/coloring.
- Use `id:` + `after !id` chains where tasks depend on each other.
- Add checklist items (`- [ ]`) for sub-tasks within events.

---

## Full Reference Files

- `references/syntax.md` — Complete syntax with all edge cases and date format table
- `references/patterns.md` — Ready-to-use project management templates
