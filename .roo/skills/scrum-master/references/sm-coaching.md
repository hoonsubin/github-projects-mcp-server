# SM Coaching, Facilitation & Team Health

1. [Coaching models](#1-coaching-models)
2. [Facilitation techniques](#2-facilitation-techniques)
3. [Retrospective formats](#3-retrospective-formats)
4. [Conflict resolution](#4-conflict-resolution)
5. [Team health metrics](#5-team-health-metrics)
6. [Remote / distributed SM](#6-remote--distributed-sm)
7. [Onboarding a new team](#7-onboarding-a-new-team)
8. [SM self-assessment](#8-sm-self-assessment)

For game-studio team patterns, producer-as-SM coaching, communities of practice, distributed game teams: see `references/game-development.md`.

---

## 1. Coaching models

### GROW (Goal, Reality, Options, Will)
For when an individual or team knows something is wrong but can't find the path forward.

| Phase | Question |
|---|---|
| Goal | "What outcome do you want from this conversation?" / "What does success look like?" |
| Reality | "What's actually happening?" / "What have you tried?" |
| Options | "What could you do?" / "What if the constraint didn't exist?" |
| Will | "What will you do next?" / "When?" / "What support do you need?" |

**Rule:** in coaching mode, ask questions — don't provide answers. "What should I do?" → "What do *you* think the options are?"

### Powerful questions
- "What's the worst that could happen if you tried that?"
- "What would you advise someone else in your position?"
- "What's stopping you right now?"
- "On a scale of 1–10, how confident are you? What would make it a 10?"
- "What assumption are you making that might not be true?"

### SBI feedback (Situation → Behaviour → Impact)
Observable and specific:
> "During today's standup [situation], you spent 10 minutes on a technical deep-dive [behaviour], which meant three team members couldn't share updates [impact]."

Avoid labels ("you're disorganised") — describe behaviour only.

---

## 2. Facilitation techniques

### Diverge → converge
Every productive meeting: (1) generate options, surface all perspectives — no evaluation; (2) select, prioritise, commit. If the loudest voice closes things early: "Let's hear from everyone before we decide."

### Dot voting
N dots per participant (3–5). Silently stick on top options. Discuss the leaders. Works for retro actions, backlog triage, feature prioritization.

### 1-2-4-All (Liberating Structures)
1 min silent → 2-person pairs → groups of 4 → whole room. Surfaces quiet voices, prevents groupthink.

### Timeboxing
Announce the box at the start. 2-min warning. When time's up: "Enough to decide, or 5 more minutes?" — explicit agreement before extending.

### Parking Lot
Visible "parking lot" for off-scope-but-important items. Review at meeting close: defer, schedule, or discard each one.

### Fist to Five
Quick consent gauge after a proposal:
- Fist (0): block
- 1–2: strong concerns; needs modification
- 3: concerns noted but won't block
- 4: good enough
- 5: full enthusiasm

Proceed if no fists; address 1s and 2s first.

---

## 3. Retrospective formats

Choose by team mood and sprint context.

### Start / Stop / Continue
**Best for:** quick, familiar teams; tired teams.
Three columns: Start (begin), Stop (end), Continue (keep).

### 4Ls
**Best for:** reflective sprints; learning-heavy work.
Liked / Learned / Lacked / Longed For.

### Sailboat (Speedboat)
**Best for:** teams feeling stuck or frustrated.
Wind (helps) / Anchors (slows us) / Rocks ahead (risks) / Island (goal).

### Mad / Sad / Glad
**Best for:** low morale; trust rebuilding.
Start with emotional acknowledgment before fixes.

### Five Whys
**Best for:** recurring dysfunction with a known symptom.
One problem statement → "Why?" five times → root cause. Write the chain.

### Timeline
**Best for:** longer sprints; release retrospectives; post-mortems.
Map sprint events on a timeline; mood indicator per event (😊 / 😐 / 😞); discuss patterns, not incidents.

### KALM (Keep / Add / Less / More)
**Best for:** process-heavy teams wanting tuning over overhaul.
Keep (exactly right) · Add (try) · Less (reduce) · More (amplify).

---

## 4. Conflict resolution

### Identify the type first

| Type | Sign | SM approach |
|---|---|---|
| Task | Disagreement on *what* | Healthy — facilitate structured debate; each side steelmans the other |
| Process | Disagreement on *how* | Restate Goal; redirect to "what process serves the goal?" |
| Relationship | Personal friction; blame | Separate people from problem; SBI; consider 1:1 first |

### De-escalation in ceremonies
1. Pause: "5-minute break."
2. Validate publicly: "I can see this matters to both of you."
3. Redirect: "What outcome do we both want?"
4. Unresolved → close the meeting; schedule structured 1:1 or mediated conversation.

### SM is not a judge
Don't pick a winner. Facilitate the team to its own decision. Genuinely stuck → Dot Voting, Fist to Five, or timeboxed discussion with coin-flip fallback ("Try Alice's approach for one sprint, then evaluate").

---

## 5. Team health metrics

Maintain in a markdown table — no tooling required.

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

**Self-report questions** (end of retro, anonymous):
- "1–5: how safe do you feel raising problems in this team?"
- "1–5: how satisfied with how we worked this sprint?"

**Trend > absolute value.** Three consecutive ↓ in any metric → bring to retro explicitly.

---

## 6. Remote / distributed SM

### Adapted ceremonies

| Ceremony | Remote |
|---|---|
| Planning | Video + shared screen; collaborative markdown doc |
| Standup | Async chat (3-point post by agreed time) or short video; never skip |
| Review | Video + screen share; record for absent stakeholders |
| Retro | Shared markdown doc / collaborative canvas; virtual stickies |

### Async standup template

```markdown
## Standup — [YYYY-MM-DD]

**Alice**
- ✅ Done: [moves the Goal]
- 🔜 Today: [plan]
- 🚧 Blockers: [none / describe]

**Bob**
- ✅ Done:
- 🔜 Today:
- 🚧 Blockers:
```

Posted by 09:30 (or agreed time). SM reviews within 1 hour; same-day blocker follow-up.

### Remote SM tips
- Over-communicate in writing: decisions, retro commitments, impediments — visibility replaces presence
- Camera-on norms (propose, model, don't mandate)
- "Office hours": 30-min daily open slot for drop-ins; reduces async pile-up
- Watch for silent voices in video — use 1-2-4-All and written rounds before verbal

---

## 7. Onboarding a new team

### Week 0 — Foundation
- [ ] Half-day Scrum overview (roles, events, artifacts, values)
- [ ] Facilitate Team Charter (working agreements, comm norms, DoD v1)
- [ ] Agree sprint length + ceremony schedule
- [ ] Set up markdown artifact files (sprint board, retro, impediment log, release roadmap)

### Sprint 1 — Learning
- [ ] Keep Sprint Goal simple — success builds confidence
- [ ] SM attends every standup; Teacher stance
- [ ] Full retro; focus on process learning, not just delivery

### Sprints 2–3 — Norming
- [ ] SM steps back from facilitating standup — let team run it
- [ ] Coach PO on refinement rhythm
- [ ] Review DoD; upgrade based on what was learned

### Sprint 4+ — Performing
- [ ] SM shifts to Coach + Impediment Remover stances
- [ ] Measure health metrics; surface trends in retro
- [ ] Energy on org blockers, not team mechanics

For game-studio onboarding (beachhead pattern, split-and-seed, federal-vs-state laws, cargo-cult-Scrum risk): see `references/game-development.md` §9.

---

## 8. SM self-assessment

**Facilitation**
- Talking <20% of the time in ceremonies?
- Creating space for quiet voices?
- Timeboxing consistently?

**Coaching**
- Asking questions before giving answers?
- Enabling self-organisation, or creating dependency on me?
- Do team members solve problems before bringing them?

**Impediment removal**
- Log current?
- Anything open >2 days I've escalated?
- Tracking org patterns, not just individual blockers?

**Team health**
- Data on velocity + satisfaction trends?
- Last sprint's retro commitment actually happen?
- Members feel safe raising bad news?

**Red flags (seek coaching yourself if any are yes)**
- Regularly assigning tasks to specific developers
- Reporting individual performance up the chain
- Ceremonies run over timebox without anyone noticing
- You feel indispensable to the team's operation
