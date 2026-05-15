# Scrum Dysfunctions & Anti-Patterns

*Game-studio-specific anti-patterns → `game-development.md` §7.*

---

## Role dysfunctions

### Product Owner

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Committee PO | Can't decide without N approvals | Single accountable PO; stakeholders advise, PO decides |
| Absent PO | Team guessing; items arrive unprepared | Negotiate ≥30% sprint time; async availability windows |
| Mini-manager PO | Assigns tasks; checks status at standup | Educate on role; SM intervenes |
| Backlog hoarder | 200+ items, nothing removed | Prune bottom 20% quarterly; untouched 2 sprints → ice box |
| Feature factory | Outcomes ignored; only feature count matters | Outcome-based Sprint Goals; OKRs alongside backlog |

### Scrum Master

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Scrum Police | Enforces rigidly without coaching | Refocus on *why*, not *that* |
| Secretary SM | Takes notes, manages calendars, reports up | Redirect to coaching, facilitation, impediments |
| Invisible SM | Impediments pile up; no facilitation | Active impediment log; reviewed every standup |
| SM = PM | Assigns tasks, tracks individual output | Clarify servant-leader mandate; team self-organises |

### Development Team

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Hero culture | One person does 80%; others wait | Pair; knowledge sharing; rotate ownership |
| Siloed specialists | "Not my job"; handoffs over collaboration | Cross-train; mob programming; T-shape |
| Over-commitment spiral | Consistently takes more than completes | 3-sprint avg velocity + 20% buffer |
| No self-organisation | Always waits for SM/PO direction | SM stops answering "what should I do?"; team walks the board |

---

## Ceremony dysfunctions

### Sprint Planning

| Dysfunction | Fix |
|---|---|
| No Sprint Goal | PO drafts proposed outcome before meeting; team finalises |
| Unrefined items at planning | Hold refinement 2–3 days prior; nothing below DoR enters |
| Planning runs 4+ hours | Pre-refine; timebox 2 hr/sprint-week; close when plan is clear |
| Goal broken immediately | Set Goal *before* item selection, not after |

### Daily Standup

| Dysfunction | Fix |
|---|---|
| Status report to SM | Redirect: "How does this serve the Goal?" |
| Runs 30–45 min | Hard 15-min timebox; park detail immediately |
| Blockers raised but not resolved | SM logs every blocker; same-day follow-up |
| Board updated end-of-day | Norm: update right after standup |

### Sprint Review

| Dysfunction | Fix |
|---|---|
| Pure demo, no dialogue | Ask stakeholders questions; converse, don't present |
| "Almost done" features shown | Enforce DoD; only Done = demoed |
| No stakeholders attend | PO cultivates; SM helps with logistics |
| Zero backlog changes from review | Explicitly ask: "What should change in the backlog?" |

### Retrospective

| Dysfunction | Fix |
|---|---|
| Same issues every sprint | Owners on actions; track follow-through next retro |
| Skipped | SM protects calendar; no sprint closes without retro |
| Blame sessions | Norms set up front; "processes, not people" |
| No committed action | One measurable commitment, every retro |

---

## Artifact dysfunctions

| Dysfunction | Fix |
|---|---|
| Backlog looks the same sprint after sprint | PO refines top 10 every refinement; prunes irrelevant |
| No acceptance criteria | PO writes AC before refinement; no AC → blocked from planning |
| Duplicate sources of truth | Single source; other views read-only |
| PO adds items mid-sprint | Only team modifies sprint; PO requests via next Planning |
| DoD lowered for deadline | Tech-debt item instead; never lower |
| Burndown flat 3+ days | SM escalates; re-plan remaining work at standup |

---

## Team dysfunctions

### Low psychological safety
**Signs:** no one speaks in retros; blockers reported late or hidden; mistakes covered up.
**Fixes:** SM sets explicit norms each retro; PO thanks team for surfacing bad news; celebrate learnings from failures.

### Knowledge concentration
**Signs:** one person is the only one who can do a critical thing; velocity collapses when they're absent.
**Fixes:** pair on critical paths; "truck number" exercise; rotate ownership.

---

## Organisational dysfunctions

| Dysfunction | Symptoms | Fix |
|---|---|---|
| **Dark Scrum** (waterfall in disguise) | Sprint length meaningless; planning is re-labelling a pre-assigned list; retro feedback never reaches management | Tie sprint outcomes to actual releases; real team ownership; management attends Reviews |
| **Too many teams on one codebase** | Merge conflicts every sprint; integration sprint each quarter | Vertical team ownership by feature domain; invest in CI/CD; Scrum of Scrums or LeSS |
| **Manager skipping the SM layer** | Manager assigns tasks directly to devs; SM has no authority | SM + management alignment session; SM reports team health, not individual output |
| **Cargo Cult Scrum** | Ceremonies happen, principles don't; team concludes "Scrum doesn't work" | Focus retros on principles before practices; prove value with one working increment per sprint |
