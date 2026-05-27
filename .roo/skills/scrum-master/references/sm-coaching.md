# SM Coaching, Facilitation & Team Health

## Coaching models

### GROW (Goal → Reality → Options → Will)

| Phase | Questions |
|---|---|
| Goal | "What outcome do you want?" / "What does success look like?" |
| Reality | "What's actually happening?" / "What have you tried?" |
| Options | "What could you do?" / "What if the constraint didn't exist?" |
| Will | "What will you do next?" / "When?" / "What support do you need?" |

In coaching mode, ask questions — don't provide answers. "What should I do?" → "What do *you* think the options are?"

### Powerful questions
- "What's the worst that could happen if you tried that?"
- "What would you advise someone else in your position?"
- "What's stopping you right now?"
- "On a scale of 1–10, how confident are you? What would make it a 10?"
- "What assumption are you making that might not be true?"

### SBI feedback (Situation → Behaviour → Impact)

> "During today's standup [situation], you spent 10 minutes on a technical deep-dive [behaviour], which meant three team members couldn't share updates [impact]."

Describe observable behaviour only — no labels ("you're disorganised").

## Facilitation techniques

| Technique | How | Best for |
|---|---|---|
| **Diverge → converge** | Generate first (no evaluation), then select | Every productive meeting |
| **Dot voting** | N dots per person (3–5), silently place, discuss leaders | Retro actions, backlog triage |
| **1-2-4-All** | 1 min silent → pairs → groups of 4 → whole room | Surfaces quiet voices, prevents groupthink |
| **Timeboxing** | Announce box upfront, 2-min warning, explicit extension agreement | All ceremonies |
| **Parking Lot** | Visible list of off-scope items; review at close | Off-topic tangents |
| **Fist to Five** | 0=block, 1–2=concerns, 3=acceptable, 4=good, 5=enthusiastic | Consent on proposals |

## Retrospective formats

| Format | Best for | Structure |
|---|---|---|
| **Start / Stop / Continue** | Quick; familiar or tired teams | Three columns |
| **4Ls** | Reflective; learning-heavy sprints | Liked / Learned / Lacked / Longed For |
| **Sailboat** | Teams feeling stuck or frustrated | Wind (helps) / Anchors / Rocks ahead / Island (goal) |
| **Mad / Sad / Glad** | Low morale; trust rebuilding | Emotional acknowledgment first |
| **Five Whys** | Recurring dysfunction with a known symptom | One problem → "Why?" × 5 → root cause |
| **Timeline** | Longer sprints; post-mortems | Events on a timeline with mood indicators |
| **KALM** | Process-heavy teams wanting tuning over overhaul | Keep / Add / Less / More |

## Conflict resolution

| Type | Sign | SM approach |
|---|---|---|
| Task | Disagreement on *what* | Healthy — structured debate; each side steelmans the other |
| Process | Disagreement on *how* | Restate Goal; "what process serves the goal?" |
| Relationship | Personal friction; blame | Separate people from problem; SBI; 1:1 first |

De-escalation in ceremonies:
1. Pause: "5-minute break."
2. Validate: "I can see this matters to both of you."
3. Redirect: "What outcome do we both want?"
4. Unresolved → close meeting; schedule structured 1:1 or mediated session.

SM is not a judge. Facilitate the team to its own decision. Genuinely stuck → Dot Voting or Fist to Five, or: "Try Alice's approach for one sprint, then evaluate."

## Team health metrics

```markdown
## Team Health — Sprint [N]

| Metric | Value | Trend | Notes |
|---|---|---|---|
| Velocity (SP) | | ↑ → ↓ | |
| Commitment ratio | | | Target 80–100% |
| Impediments raised | | | |
| Impediments resolved same sprint | | | Target 100% |
| Standup avg (min) | | | Target ≤15 |
| Retro commitment followed through | ✅/❌/⚠️ | | |
| Psych safety (1–5 self-report) | | | Raise in retro if <3 |
| Team satisfaction (1–5) | | | Anonymous |
```

Self-report questions (end of retro, anonymous):
- "1–5: how safe do you feel raising problems in this team?"
- "1–5: how satisfied with how we worked this sprint?"

Three consecutive ↓ in any metric → bring to retro explicitly.

## Remote / distributed SM

| Ceremony | Remote adaptation |
|---|---|
| Planning | Video + shared screen; collaborative markdown doc |
| Standup | Async chat (3-point post by agreed time) or short video; never skip |
| Review | Video + screen share; record for absent stakeholders |
| Retro | Shared markdown doc; virtual stickies or 1-2-4-All in writing rounds |

- Over-communicate decisions, retro commitments, and impediments in writing — visibility replaces presence
- Camera-on norms: propose and model, don't mandate
- "Office hours": 30-min daily open slot; reduces async pile-up
- Watch for silent voices in video — use written rounds before verbal in 1-2-4-All

## Onboarding a new team

| Phase | Focus | Key actions |
|---|---|---|
| **Week 0** | Foundation | Half-day Scrum overview; Team Charter; agree sprint length + cadence; DoD v1 |
| **Sprint 1** | Learning | Simple Goal; SM Teacher stance at every standup; full retro on process |
| **Sprints 2–3** | Norming | SM steps back from running standup; coach PO on refinement; upgrade DoD |
| **Sprint 4+** | Performing | SM shifts to Coach + Impediment Remover; measure health metrics; focus on org blockers |

*Game-studio onboarding (beachhead pattern, split-and-seed, cargo-cult-Scrum risk): see `game-development.md` §9.*

## SM self-assessment

Green signals (aim for all):
- Talking <20% of time in ceremonies
- Asking questions before giving answers
- Team solves problems before bringing them to SM
- Impediment log current; anything open >2 days is escalated
- Last retro commitment followed through
- Members feel safe raising bad news

Red flags (seek coaching yourself if any are yes):
- Regularly assigning tasks to specific developers
- Reporting individual performance up the chain
- Ceremonies run over timebox without anyone noticing
- You feel indispensable to the team's operation

## Bootstrap: Introducing Scrum to an ongoing project

### Sprint 0 vs. Sprint 1

**Sprint 0** — use when tooling, board configuration, and working agreements aren't in place; DoD and DoR have never been discussed; or the team hasn't worked together in a Scrum cadence before. Goal: "By end of this sprint, we have a working board, agreed DoD, and a calibrated velocity estimate." Keep it to 1 week. Sprint 0 produces no product increment — it produces a team ready to commit.

**Sprint 1** — use when the board is functional, DoD/DoR are written (even minimally), and the team has context; or the project has been running informally and just needs structure applied. When in doubt, prefer Sprint 1. Sprint 0 is a crutch that teams extend indefinitely.

### v1 DoD principle

Write the simplest DoD the team will actually respect. A DoD with 3 criteria followed is worth more than one with 10 criteria ignored. Start with: code reviewed, AC verified, deployed to staging. Add criteria in retro as the team proves the baseline. Never write an aspirational DoD — "100% test coverage" on a project with no tests is a fiction. Write what's true now and upgrade it.

### Velocity baseline from informal history

1. Ask: "What did the team complete in the last 4–6 weeks?" (Rough answer is fine.)
2. Divide by elapsed weeks, multiply by sprint length → items/sprint.
3. Ask the team to size those completed items relative to each other for a story-point estimate.
4. Use the result as a provisional planning number. Label it as bootstrapped.
5. Revisit after Sprint 2 — by then, real data exists.

If no throughput data exists: start with the capacity formula; treat Sprint 1 as a calibration sprint. The point is a reliable velocity reading, not maximum output.

## Stale recovery: Re-orienting after a pause

### The restart retrospective

Before re-planning, run a short retrospective on the pause itself. Three questions only:
1. "What caused the pause — and what have we learned from it?"
2. "What's different now that makes this restart viable?"
3. "What one change would prevent the same thing from happening again?"

Capture the one committed change. If the root cause isn't resolved, don't restart — plan the resolution first.

### Re-baseline decision

| Pause duration | Team changed? | Velocity decision |
|---|---|---|
| ≤ 2 sprint lengths | No | Use last known velocity |
| ≤ 2 sprint lengths | Yes | Adjust for capacity change; last velocity as reference |
| > 2 sprint lengths | No | Confirm with team; treat as suspect; calibration sprint |
| > 2 sprint lengths | Yes | Re-baseline from scratch via capacity formula |

Capacity = Available Days × Focus Factor (0.65) × Team Size.

### The calibration sprint

The first sprint back is not about output — it's about proving the team can deliver again:
- Commit to 60–70% of estimated capacity
- Choose items the team knows well — no new technology or high-risk unknowns
- Sprint Goal: "Deliver one complete, releasable increment"
- Retro question: "Was the commit realistic? What would we adjust?"

Under-committing on the calibration sprint is not weakness — it's accurate. Teams that over-commit on restart sprint 1 and miss it lose confidence twice.
