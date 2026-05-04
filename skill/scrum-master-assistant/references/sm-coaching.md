# Scrum Master Coaching, Facilitation & Team Health

## Table of Contents
1. [Coaching Models](#1-coaching-models)
2. [Facilitation Techniques](#2-facilitation-techniques)
3. [Retrospective Format Library](#3-retrospective-format-library)
4. [Conflict Resolution](#4-conflict-resolution)
5. [Team Health Metrics](#5-team-health-metrics)
6. [Remote / Distributed Team SM](#6-remote--distributed-team-sm)
7. [Onboarding a New Scrum Team](#7-onboarding-a-new-scrum-team)
8. [SM Self-Assessment](#8-sm-self-assessment)

---

## 1. Coaching Models

### GROW Model (Goal, Reality, Options, Will)
Use when an individual or team knows something is wrong but can't find the path forward.

| Phase | SM question examples |
|---|---|
| **Goal** | "What outcome do you want from this conversation?" / "What does success look like?" |
| **Reality** | "What's actually happening right now?" / "What have you already tried?" |
| **Options** | "What could you do?" / "What would you do if the constraint didn't exist?" |
| **Will** | "What will you do next?" / "When will you do it?" / "What support do you need?" |

**Rule:** In coaching mode, ask questions — don't provide answers. If the person asks "what should I do?", redirect: "What do *you* think the options are?"

### Powerful Questions (Coaching Posture)
- "What's the worst that could happen if you tried that?"
- "What would you advise someone else in your position?"
- "What's stopping you from doing that right now?"
- "On a scale of 1–10, how confident are you? What would make it a 10?"
- "What assumption are you making that might not be true?"

### Feedback Model (SBI)
Situation → Behaviour → Impact. Keep feedback observable and specific:
> "During today's standup [situation], you spent 10 minutes on a technical deep-dive [behaviour], which meant three team members couldn't share updates [impact]."

Avoid labels ("you're disorganised") — describe behaviour only.

---

## 2. Facilitation Techniques

### Diverge → Converge
Every productive meeting has two phases:
1. **Diverge**: Generate options, surface all perspectives (no evaluation yet)
2. **Converge**: Select, prioritise, and commit

Don't let convergence happen prematurely. If the loudest voice shuts down options early: "Let's hear from everyone before we decide."

### Dot Voting (quick prioritisation)
Each participant gets N dots (usually 3–5). Silently stick dots on the options they care most about. Discuss the top items. Works for retro actions, backlog triage, feature priority.

### 1-2-4-All (Liberating Structures)
1 minute silent reflection → 2-person pairs → groups of 4 → whole room. Surfaces quiet voices and prevents groupthink.

### Timeboxing (strict facilitation)
- Announce the timebox at the start: "We have 15 minutes for this."
- Give a 2-minute warning.
- When time is up, ask: "Do we have enough to decide, or do we need 5 more minutes?" — get explicit agreement before extending.

### Parking Lot
Keep a visible "parking lot" (sticky note, doc heading, whiteboard corner) for important topics that are off-scope right now. Review it at the end of the meeting: defer, schedule, or discard each item.

### Fist to Five (consent check)
Quick consensus gauge after a proposal:
- Fist (0): Block — I cannot support this
- 1–2: Strong concerns; needs modification
- 3: Concerns noted but won't block
- 4: Good enough; support it
- 5: Full enthusiasm

Proceed if no fists; address 1s and 2s first.

---

## 3. Retrospective Format Library

Choose format based on team mood and sprint context.

### Start / Stop / Continue
**Best for:** Quick, familiar teams. Tired team.
Three columns: Start (should we begin?), Stop (should we end?), Continue (keep it).

### 4Ls
**Best for:** Reflective sprints; learning-heavy work.
Liked / Learned / Lacked / Longed For.

### Sailboat (Speedboat)
**Best for:** Teams feeling stuck or frustrated.
Wind (what helps) / Anchors (what slows us) / Rocks ahead (risks) / Island (goal).

### Mad / Sad / Glad
**Best for:** Morale is low; trust needs rebuilding.
Start with emotional acknowledgment before jumping to fixes.

### Five Whys
**Best for:** Recurring dysfunction with a known symptom.
Take one problem statement → ask "Why?" five times → surface root cause.
Write the chain: `Why? → Because... → Why? → Because...`

### Timeline Retrospective
**Best for:** Longer sprints; release retrospectives; post-mortems.
1. Team maps key events on a timeline (collaborative)
2. Each event gets a mood indicator: 😊 / 😐 / 😞
3. Discuss patterns — not individual incidents

### KALM (Keep / Add / Less / More)
**Best for:** Process-heavy teams wanting to tune rather than overhaul.
Keep: doing this exactly right | Add: new practice to try | Less: reduce this | More: amplify this.

---

## 4. Conflict Resolution

### Distinguish Conflict Type First

| Type | Signs | SM approach |
|---|---|---|
| **Task conflict** | Disagreement on *what* to do | Healthy — facilitate structured debate; ask each side to steelman the other |
| **Process conflict** | Disagreement on *how* to work | Restate shared Sprint Goal; redirect to "what process serves the goal?" |
| **Relationship conflict** | Personal friction; blame | Separate people from the problem; use SBI feedback; consider 1:1 coaching first |

### De-escalation in Ceremonies
If a ceremony becomes heated:
1. Pause the meeting: "Let's take a 5-minute break."
2. Validate both sides publicly: "I can see this matters to both of you."
3. Redirect to shared interest: "What outcome do we both want here?"
4. If unresolved → close the meeting; schedule a structured 1:1 or mediated conversation

### SM is Not a Judge
The SM's job is not to pick a winner. Facilitate the team to reach its own decision. If the team is genuinely stuck: use Dot Voting, Fist to Five, or timeboxed discussion with a coin-flip fallback ("We'll try Alice's approach for one sprint, then evaluate").

---

## 5. Team Health Metrics

Track per sprint. No tooling required — maintain in a markdown table.

```markdown
## Team Health Dashboard — Sprint [N]

| Metric | Value | Trend | Notes |
|---|---|---|---|
| Velocity (SP completed) | | ↑ / → / ↓ | |
| Commitment ratio (completed/committed) | | | Target: 80–100% |
| Impediments raised | | | |
| Impediments resolved same sprint | | | Target: 100% |
| Standup avg duration (min) | | | Target: ≤15 |
| Retro commitment followed through? | ✅ / ❌ / ⚠️ | | |
| Psychological safety (1–5 self-report) | | | Raise in retro if <3 |
| Team satisfaction (1–5 self-report) | | | Anonymous |
```

**Self-report questions** (end of retro, anonymous index cards or anonymous chat):
- "On a scale of 1–5, how safe do you feel raising problems in this team?"
- "On a scale of 1–5, how satisfied are you with how we worked this sprint?"

Trend is more important than absolute value. Three consecutive ↓ in any metric → bring to retro explicitly.

---

## 6. Remote / Distributed Team SM

### Adapted Ceremonies

| Ceremony | Remote adaptation |
|---|---|
| Sprint Planning | Video call with shared screen; use collaborative markdown doc instead of physical board |
| Daily Standup | Async standup via chat (each person posts their 3-point update by agreed time) or short video call; never skip |
| Sprint Review | Video call + screen share; record for stakeholders who can't attend |
| Retrospective | Use shared markdown doc or collaborative canvas; virtual sticky notes via any shared writing tool |

### Async Standup Template

```markdown
## Standup — [YYYY-MM-DD]

**Alice**
- ✅ Done: [what moved the Sprint Goal]
- 🔜 Today: [what I'll do]
- 🚧 Blockers: [none / describe]

**Bob**
- ✅ Done:
- 🔜 Today:
- 🚧 Blockers:
```

Post in team chat by 09:30 (or agreed time). SM reviews all posts within 1 hour; follows up on any blocker that day.

### Remote SM Tips
- Over-communicate: written decisions, written retro commitments, written impediment log — visibility replaces physical presence
- Camera-on norms during ceremonies (propose, don't mandate; model the behaviour yourself)
- SM "office hours": 30-min daily open slot for anyone to drop in; reduces async pile-up
- Watch for silent voices in video calls — use 1-2-4-All and written rounds before verbal

---

## 7. Onboarding a New Scrum Team

Use this sequence when starting fresh with a team that is new to Scrum.

### Week 0 — Foundation
- [ ] Run a half-day Scrum overview session (roles, events, artifacts, values)
- [ ] Facilitate Team Charter creation (working agreements, communication norms, DoD v1)
- [ ] Agree sprint length and ceremony schedule
- [ ] Set up markdown artifact files and Markwhen timeline

### Sprint 1 — Learning Sprint
- [ ] Keep Sprint Goal simple and achievable — success builds confidence
- [ ] SM attends every standup; actively coaches (Teacher stance)
- [ ] Run a full retro; focus on process learning, not just delivery

### Sprint 2–3 — Norming
- [ ] SM steps back from facilitating standup — let team run it
- [ ] Coach PO on backlog refinement rhythm
- [ ] Review DoD; upgrade it based on what was learned

### Sprint 4+ — Performing
- [ ] SM shifts to Coach and Impediment Remover stances
- [ ] Measure health metrics; surface trends in retro
- [ ] Focus energy on organisational blockers, not team mechanics

---

## 8. SM Self-Assessment

Periodically ask yourself:

**Facilitation**
- Am I talking less than 20% of the time in ceremonies?
- Am I creating space for quiet voices?
- Am I timeboxing consistently?

**Coaching**
- Am I asking questions before giving answers?
- Am I enabling self-organisation or creating dependency on myself?
- Do team members solve problems before bringing them to me?

**Impediment Removal**
- Is my impediment log current?
- Have I escalated anything open for more than 2 days?
- Am I tracking organisational patterns, not just individual blockers?

**Team Health**
- Do I have data on velocity and satisfaction trends?
- Did last sprint's retro commitment actually happen?
- Do team members feel safe raising bad news?

**Red flags (seek coaching yourself if yes)**
- You regularly assign tasks to specific developers
- You report individual performance up the chain
- Ceremonies run over timebox consistently without team noticing
- You feel indispensable to the team's operation
