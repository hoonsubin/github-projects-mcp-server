# Scrum Dysfunctions & Anti-Patterns

1. [Role dysfunctions](#1-role-dysfunctions)
2. [Ceremony dysfunctions](#2-ceremony-dysfunctions)
3. [Artifact dysfunctions](#3-artifact-dysfunctions)
4. [Team dysfunctions](#4-team-dysfunctions)
5. [Organisational dysfunctions](#5-organisational-dysfunctions)
6. [Diagnostic questions](#6-diagnostic-questions)

For game-studio-specific anti-patterns (production-by-calendar, parts-on-the-garage-floor, approval bottleneck, discipline silos, mini-waterfall sprints), see `references/game-development.md` §7.

---

## 1. Role dysfunctions

### Product Owner

| Anti-pattern    | Symptom                                      | Fix                                                       |
| --------------- | -------------------------------------------- | --------------------------------------------------------- |
| Committee PO    | Can't decide without N approvals             | Single accountable PO; stakeholders advise, PO decides    |
| Absent PO       | Team guessing; items arrive unprepared       | Negotiate ≥30% sprint time; async availability windows    |
| Mini-manager PO | Assigns tasks; checks status at standup      | Educate on role; SM intervenes                            |
| Backlog hoarder | 200+ items, nothing removed                  | Prune bottom 20% quarterly; untouched 2 sprints → ice box |
| Feature factory | Outcomes ignored; only feature count matters | Outcome-based Sprint Goals; OKRs alongside backlog        |

### Scrum Master

| Anti-pattern | Symptom                                    | Fix                                             |
| ------------ | ------------------------------------------ | ----------------------------------------------- |
| Scrum Police | Enforces rigidly without coaching          | Refocus on _why_, not _that_                    |
| Secretary SM | Takes notes, manages calendars, reports up | Redirect to coaching, facilitation, impediments |
| Invisible SM | Impediments pile up; no facilitation       | Active impediment log; reviewed every standup   |
| SM = PM      | Assigns tasks, tracks individual output    | Clarify servant-leader; team self-organizes     |

### Development Team

| Anti-pattern           | Symptom                                   | Fix                                                          |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Hero culture           | One person does 80%; others wait          | Pair; knowledge sharing; rotate ownership                    |
| Siloed specialists     | "Not my job"; handoffs over collaboration | Cross-train; mob program; T-shape                            |
| Over-commitment spiral | Consistently takes more than completes    | Use 3-sprint avg velocity + 20% buffer                       |
| No self-organization   | Always waits for SM/PO direction          | SM stops answering "what should I do?"; team walks the board |

---

## 2. Ceremony dysfunctions

### Sprint Planning

| Dysfunction                         | Fix                                                           |
| ----------------------------------- | ------------------------------------------------------------- |
| No Sprint Goal                      | PO drafts proposed outcome before meeting; team finalizes     |
| Unrefined items at planning         | Hold refinement 2–3 days prior; nothing below DoR enters      |
| Planning runs 4+ hours every sprint | Pre-refine; timebox 2hr/sprint-week; close when plan is clear |
| Goal broken immediately             | Set Goal _before_ item selection, not after                   |

### Daily Standup

| Dysfunction                      | Fix                                          |
| -------------------------------- | -------------------------------------------- |
| Status report to SM              | Redirect: "How does this serve the Goal?"    |
| Runs 30–45 min                   | Hard 15-min timebox; park detail immediately |
| Blockers raised but not resolved | SM logs every blocker; same-day follow-up    |
| Board updated end-of-day         | Norm: update right after standup             |

### Sprint Review

| Dysfunction                      | Fix                                                  |
| -------------------------------- | ---------------------------------------------------- |
| Pure demo, no dialogue           | Ask stakeholders questions; converse, don't present  |
| "Almost done" features shown     | Enforce DoD; only Done = demoed                      |
| No stakeholders attend           | PO cultivates; SM helps with logistics               |
| Zero backlog changes from review | Explicitly ask: "What should change in the backlog?" |

### Retrospective

| Dysfunction              | Fix                                                  |
| ------------------------ | ---------------------------------------------------- |
| Same issues every sprint | Owners on actions; track follow-through next retro   |
| Skipped                  | SM protects calendar; no sprint closes without retro |
| Blame sessions           | Norms set up front; "processes, not people"          |
| No committed action      | One measurable commitment, every retro               |

---

## 3. Artifact dysfunctions

### Product Backlog

| Dysfunction                        | Fix                                                           |
| ---------------------------------- | ------------------------------------------------------------- |
| Looks the same sprint after sprint | PO refines top 10 every refinement; prunes irrelevant         |
| No acceptance criteria             | PO writes AC before refinement; no AC → blocked from planning |
| Duplicate sources of truth         | Single source; other views read-only                          |

### Sprint Backlog

| Dysfunction              | Fix                                               |
| ------------------------ | ------------------------------------------------- |
| PO adds items mid-sprint | Only team modifies; PO requests via next Planning |
| Board not updated daily  | Norm: right after standup                         |
| Tasks have no owners     | Self-assign at standup                            |

### Increment / DoD

| Dysfunction                   | Fix                                          |
| ----------------------------- | -------------------------------------------- |
| DoD lowered for deadline      | Tech-debt item instead; never lower          |
| No DoD                        | Build one in next retro; start minimal, grow |
| "Done" means different things | Version-stamp DoD; review at every retro     |

### Burndown

| Dysfunction                         | Fix                                           |
| ----------------------------------- | --------------------------------------------- |
| Not updated daily                   | SM owns daily update as non-negotiable        |
| Flat for 3+ days                    | Escalate; re-plan remaining work at standup   |
| Late-sprint heroics save the sprint | Address in retro; fix planning, not execution |

---

## 4. Team dysfunctions

### Low psychological safety

**Signs:** no one speaks in retros; blockers reported late or hidden; mistakes covered up.
**Fixes:** SM sets explicit norms each retro; PO thanks team for surfacing bad news early; celebrate learnings from failures.

### Knowledge concentration

**Signs:** one person is the only one who can do a critical thing; velocity collapses when they're absent.
**Fixes:** pair on critical paths; "truck number" exercise; rotate ownership.

---

## 5. Organisational dysfunctions

### Dark Scrum (waterfall in disguise)

**Symptoms:** sprint length meaningless (releases happen quarterly); Planning is re-labelling a pre-assigned task list; retro feedback never reaches management.
**Fix:** tie sprint outcomes to actual releases; real team ownership of process; management attends Reviews.

### Too many teams on one codebase

**Symptoms:** merge conflicts every sprint; teams blocking each other; integration sprint each quarter.
**Fix:** vertical team ownership by feature domain; invest in CI/CD; consider Scrum of Scrums or LeSS.

### Manager skipping the SM layer

**Symptoms:** manager assigns tasks directly to devs; SM has no authority to remove blockers; team reverts to waterfall habits.
**Fix:** SM + management alignment session on SM mandate; SM reports team health, not individual output.

### Cargo Cult Scrum

**Symptoms:** ceremonies happen, principles don't (no transparency, no self-organization, no working increment); team concludes "Scrum doesn't work."
**Fix:** focus retros on _principles_ before _practices_; prove value with a single working increment, sprint by sprint.

---

## 6. Diagnostic questions

**Sprint Goal**

- Can every member state it without looking?
- Outcome-based, or just a feature list?

**Backlog**

- Top 10 refined every sprint?
- Items >6 months old that have never moved?
- Every sprint-ready item has AC?

**Ceremonies**

- Planning ends with clear Goal + realistic commitment?
- Standup ≤15 min?
- Review generates backlog changes?
- Retro produces exactly one committed improvement?

**Artifacts**

- Sprint Backlog updated daily?
- Burndown charted daily?
- Impediment log live?
- One source of truth per artifact?

**Team Health**

- Members swarm on blockers, or wait?
- DoD version-stamped and respected?
- Retro commitments followed through?
