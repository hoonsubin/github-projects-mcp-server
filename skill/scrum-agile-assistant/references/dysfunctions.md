# Scrum Dysfunctions & Anti-Patterns

## Table of Contents

1. [Role Dysfunctions](#1-role-dysfunctions)
2. [Ceremony Dysfunctions](#2-ceremony-dysfunctions)
3. [Artifact Dysfunctions](#3-artifact-dysfunctions)
4. [Team Dysfunctions](#4-team-dysfunctions)
5. [Organisational Dysfunctions](#5-organisational-dysfunctions)
6. [Diagnostic Questions](#6-diagnostic-questions)

---

## 1. Role Dysfunctions

### Product Owner

| Anti-Pattern           | Symptoms                                                            | Fix                                                                             |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Committee PO**       | PO can't make decisions without approval from multiple stakeholders | Clarify single-accountable PO with mandate; stakeholders advise, PO decides     |
| **Absent PO**          | Team guesses on requirements; items arrive at planning unprepared   | Negotiate minimum 30% sprint time from PO; establish async availability windows |
| **Mini-manager PO**    | PO assigns tasks, attends standups to check status                  | Educate PO on role boundary; SM intervenes                                      |
| **Backlog hoarder**    | Backlog has 200+ items, nothing ever gets removed                   | PO prunes bottom 20% each quarter; items not touched in 2 sprints go to ice box |
| **Feature factory PO** | Outcomes ignored; only feature count matters                        | Shift to outcome-based Sprint Goals; introduce OKRs alongside backlog           |

### Scrum Master

| Anti-Pattern     | Symptoms                                                     | Fix                                                              |
| ---------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| **Scrum Police** | SM enforces process rigidly without coaching intent          | Refocus SM on _why_ practices exist, not just _that_ they happen |
| **Secretary SM** | SM takes meeting notes, manages calendars, reports status up | Redirect SM energy to coaching, facilitation, impediment removal |
| **Invisible SM** | Impediments pile up; ceremonies have no facilitation         | SM actively tracks impediment log; reviews at every standup      |
| **SM = PM**      | SM assigns tasks, tracks individual output, manages the team | Clarify servant-leader role; team self-organizes task assignment |

### Development Team

| Anti-Pattern               | Symptoms                                                        | Fix                                                                 |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Hero culture**           | One person does 80% of the work; others wait                    | SM encourages pairing; knowledge-sharing sessions; rotate ownership |
| **Siloed specialists**     | "That's not my job" culture; hand-offs instead of collaboration | Cross-training; mob programming; T-shaped skills investment         |
| **Over-commitment spiral** | Team consistently takes on more than they complete              | Use average velocity from last 3 sprints; add 20% buffer            |
| **No self-organization**   | Team always waits for SM/PO to tell them what to do next        | SM stops answering "what should I do?"; team walks the board        |

---

## 2. Ceremony Dysfunctions

### Sprint Planning

| Dysfunction                         | Fix                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------- |
| No Sprint Goal defined              | PO drafts a proposed outcome before meeting; team finalizes            |
| Items not refined at planning       | PO holds refinement 2–3 days before; nothing enters planning below DoR |
| Planning runs 4+ hours every sprint | Pre-refine backlog; timebox to 2hr/sprint-week; end when plan is clear |
| Team immediately breaks Sprint Goal | Set Sprint Goal before selecting items, not after                      |

### Daily Standup

| Dysfunction                           | Fix                                                             |
| ------------------------------------- | --------------------------------------------------------------- |
| Status report to SM                   | Redirect to Sprint Goal: "How does this help us meet our goal?" |
| Runs 30–45 minutes                    | Hard timebox 15 min; park detailed discussions immediately      |
| Blockers mentioned but never resolved | SM logs every blocker; follows up same day                      |
| Team updates board at end of day      | Update board immediately post-standup                           |

### Sprint Review

| Dysfunction                          | Fix                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Pure demo, no dialogue               | Ask stakeholders questions proactively; don't present — converse           |
| "Almost done" features shown         | Enforce DoD; only Done = demonstrated                                      |
| No stakeholders attend               | PO cultivates relationships; SM helps with logistics                       |
| Review leads to zero backlog changes | Explicitly ask: "What should change in the backlog based on what you saw?" |

### Sprint Retrospective

| Dysfunction              | Fix                                                                      |
| ------------------------ | ------------------------------------------------------------------------ |
| Same issues every sprint | Assign owners to improvement actions; track follow-through in next retro |
| Retrospective skipped    | SM protects calendar; no sprint closes without retro                     |
| Blame sessions           | SM establishes norms; use "processes, not people" framing                |
| No committed action      | End every retro with exactly one measurable commitment for next sprint   |

---

## 3. Artifact Dysfunctions

### Product Backlog

| Dysfunction                                        | Fix                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| Backlog looks the same sprint after sprint         | PO refines top 10 items every refinement; prunes irrelevant items      |
| Items have no acceptance criteria                  | PO writes AC before refinement; items without AC blocked from planning |
| Duplicate sources of truth (backlog in Jira + doc) | Designate single source; all other views are read-only                 |

### Sprint Backlog

| Dysfunction              | Fix                                                                       |
| ------------------------ | ------------------------------------------------------------------------- |
| PO adds items mid-sprint | Only team can modify Sprint Backlog; PO requests via next Sprint Planning |
| Board not updated daily  | Team norm: update immediately after standup                               |
| Tasks have no owners     | Team self-assigns at standup each morning                                 |

### Increment / DoD

| Dysfunction                                       | Fix                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| DoD lowered to meet deadline                      | Create tech-debt backlog item instead; never lower DoD                |
| Team has no DoD                                   | Facilitate DoD creation in next retrospective; start minimal and grow |
| "Done" means different things to different people | Version-stamp DoD; review at every retro                              |

### Burndown Chart

| Dysfunction                                | Fix                                                         |
| ------------------------------------------ | ----------------------------------------------------------- |
| Chart not updated daily                    | SM owns daily update as non-negotiable                      |
| Flat for 3+ days                           | SM escalates immediately; re-plan remaining work at standup |
| Late sprint heroics always save the sprint | Address root cause in retro; fix planning, not execution    |

---

## 4. Team Dysfunctions

### Psychological Safety

Signs of low psychological safety:

- No one speaks up in retrospectives
- Blockers are reported late or not at all
- Mistakes are hidden instead of surfaced

Fixes:

- SM sets explicit norms at start of each retrospective
- PO thanks team for surfacing bad news early
- Celebrate learnings from failures, not just successes

### Knowledge Concentration

Signs:

- One person is the only one who can do a critical task
- Velocity collapses when that person is absent

Fixes:

- Pair programming on critical paths
- "Truck number" exercise: "If X were hit by a truck tomorrow, what would break?"
- Rotation of ownership each sprint

---

## 5. Organisational Dysfunctions

### Scrum as Waterfall in Disguise (Dark Scrum)

Symptoms:

- Sprint length is meaningless — releases happen quarterly
- Sprint Planning is just re-labelling a pre-assigned task list
- Retrospective feedback never reaches management

Fix: Tie sprint outcomes to actual releases; give team real ownership of process; management attends
Sprint Reviews.

### Too Many Teams on One Codebase

Symptoms:

- Merge conflicts every sprint
- Teams block each other constantly
- Integration sprint at the end of every quarter

Fix: Vertical team ownership by feature domain; invest in CI/CD; consider Scrum of Scrums or LeSS.

### Manager Skipping Scrum Master Layer

Symptoms:

- Manager assigns tasks directly to developers
- SM has no authority to remove blockers
- Team reverts to waterfall habits

Fix: SM and management alignment session on Scrum Master mandate; SM reports team health metrics,
not individual output.

---

## 6. Diagnostic Questions

Use these questions when auditing a Scrum team's health:

**Sprint Goal Quality**

- Can every team member state the Sprint Goal without looking it up?
- Is it outcome-based, or just a list of features?

**Backlog Health**

- Does the PO refine the top 10 items every sprint?
- Are there items older than 6 months that have never moved?
- Does every sprint-ready item have acceptance criteria?

**Ceremony Quality**

- Does the team leave Sprint Planning with a clear Sprint Goal and realistic commitment?
- Does the daily standup stay under 15 minutes?
- Does the Sprint Review generate backlog changes?
- Does the Retrospective produce exactly one committed improvement?

**Artifact Integrity**

- Is the Sprint Backlog updated daily?
- Is the burndown charted every day?
- Is the impediment log actively managed by the SM?
- Is there one and only one source of truth for each artifact?

**Team Health**

- Do team members swarm on blockers or wait for someone else to act?
- Is the Definition of Done version-stamped and respected?
- Are retrospective commitments followed through by the next sprint?
