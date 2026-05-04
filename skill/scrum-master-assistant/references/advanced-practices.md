# Advanced Scrum Practices

## Table of Contents
1. [Estimation Techniques](#1-estimation-techniques)
2. [Velocity & Capacity Planning](#2-velocity--capacity-planning)
3. [Backlog Refinement Techniques](#3-backlog-refinement-techniques)
4. [Retrospective Formats](#4-retrospective-formats)
5. [Scaling Scrum](#5-scaling-scrum)

---

## 1. Estimation Techniques

### Planning Poker
1. PO reads a backlog item aloud and answers clarifying questions
2. Each team member secretly picks a card (Fibonacci: 1, 2, 3, 5, 8, 13, 21, ?)
3. Cards are revealed simultaneously
4. Outliers explain their reasoning; team discusses; re-vote if needed
5. Consensus = estimate accepted

**Key rule:** Never average — find genuine consensus through discussion.

### T-Shirt Sizing (for epics / roadmap planning)
- XS, S, M, L, XL — relative sizing without committing to point values
- Used for rough roadmap planning before items are sprint-ready

### Three-Point Estimation (for high-risk items)
- **Optimistic** (O): best case
- **Pessimistic** (P): worst case
- **Most Likely** (M): realistic middle
- Formula: Expected = (O + 4M + P) / 6

### Three Amigos
Before estimating, convene: **PO (what)** + **Developer (how)** + **Tester (what could go wrong)**.
This surfaces hidden acceptance criteria and technical unknowns before they become sprint blockers.

---

## 2. Velocity & Capacity Planning

### Calculating Velocity
- Track story points completed (not started) per sprint for last 3–5 sprints
- Use the **average** as your planning velocity — not the highest sprint
- If velocity is erratic, investigate root cause (scope creep, poor refinement, team churn)

### Capacity Planning Formula
```
Capacity = (Available Days × Focus Factor) × Team Size
Focus Factor: typically 0.6–0.7 (accounts for meetings, email, context switching)
```

### Never Use Velocity as a Performance Metric
Velocity is a planning tool only. Rewarding higher velocity creates story point inflation and destroys the signal. Compare velocity to itself over time — never between teams.

---

## 3. Backlog Refinement Techniques

### INVEST Criteria for User Stories
- **I**ndependent — can be developed and deployed alone
- **N**egotiable — scope can be adjusted via conversation
- **V**aluable — delivers value to a user or stakeholder
- **E**stimable — team can size it
- **S**mall — fits within one sprint
- **T**estable — acceptance criteria can be verified

### Story Splitting Patterns
| Pattern | Example |
|---|---|
| Split by workflow step | "Checkout" → "Enter address" / "Select payment" / "Confirm order" |
| Split by user type | "Manage users" → "Admin manages" / "Self-service manages" |
| Split by data variation | "Export report" → "Export CSV" / "Export PDF" |
| Happy path first | Core flow → edge cases / error handling in follow-up stories |

### Priority Horizon Planning (Now / Next / Later / Future)
| Horizon | Detail Level | Sprint Distance |
|---|---|---|
| Now | Fully refined, DoR met | Sprint 1 |
| Next | Basic AC, rough estimate | Sprint 2–3 |
| Later | Described, coarse estimate | Sprint 4–6 |
| Future | Idea-level, no estimate needed | 6+ sprints |

### WSJF Prioritization (Weighted Shortest Job First)
Used in SAFe / scaled environments.
```
WSJF = Cost of Delay / Job Duration
Cost of Delay = User-Business Value + Time Criticality + Risk Reduction/Opportunity Enablement
```
Higher WSJF = higher priority.

---

## 4. Retrospective Formats

### Start / Stop / Continue
Classic and fast. Three columns:
- **Start**: Things we should begin doing
- **Stop**: Things that aren't helping us
- **Continue**: Things that are working

### 4Ls
- **Liked**: What did you enjoy?
- **Learned**: What did you learn?
- **Lacked**: What was missing?
- **Longed For**: What do you wish we had?

### Sailboat (aka Speedboat)
Visual metaphor:
- **Wind** (in the sails): What's helping us move forward?
- **Anchors**: What's slowing us down?
- **Rocks ahead**: What risks are coming?
- **Island (destination)**: What is our goal?

### Mad / Sad / Glad
Emotional temperature check — useful when team morale is low:
- **Mad**: What frustrated you this sprint?
- **Sad**: What disappointed you?
- **Glad**: What made you proud or happy?

### Timeline Retrospective
Team maps key events of the sprint on a timeline and annotates each with a happy/neutral/sad face. Good for longer sprints or releases.

---

## 5. Scaling Scrum

### Scrum of Scrums
- Representatives from each Scrum team meet 2–3x per week
- Each representative answers: What did my team do? What will we do? What's blocking us? What might block other teams?
- Used when 2–8 Scrum teams work on the same product

### SAFe (Scaled Agile Framework)
- Program Increment (PI) Planning replaces Sprint Planning at scale (8–12 sprints planned together)
- Adds "Agile Release Trains" (ARTs) — groups of 5–12 teams
- Introduces Lean Portfolio Management, Business Owners, Release Train Engineers

### LeSS (Large-Scale Scrum)
- One Product Owner, one Product Backlog — shared across all teams
- Multiple Development Teams work on the same product
- Fewer roles and artifacts than SAFe — closer to vanilla Scrum

### When to Scale
Only scale when a single Scrum team cannot deliver fast enough for the product's needs. Premature scaling adds coordination overhead without value. Default: one team first.

---

## 6. User Story Mapping

Story mapping organises the backlog along two axes:
- **Horizontal (x)**: User activities in workflow order (the "backbone")
- **Vertical (y)**: Depth of detail — top rows are the walking skeleton; lower rows are enhancements

### How to run a story mapping session (90 min)
1. Agree on the persona and their goal — 10 min
2. Walk through the user journey left-to-right; write activity cards (nouns) — 20 min
3. Under each activity, write user tasks (verbs) — 20 min
4. Under each task, write stories (the smallest deliverable that delivers value) — 20 min
5. Draw horizontal slice lines: "Minimum Viable Product", "Full Release" — 20 min

Stories above the MVP line → Sprint 1–N. Stories below → future sprints.

### Story Map as Markdown

```markdown
## Story Map — [Feature / Product Area]

| Activity → | Register | Log In | Manage Account | Browse Catalogue | Checkout |
|---|---|---|---|---|---|
| **MVP (Sprint 1–2)** | Create account | Email + password login | Change password | View product list | Add to cart |
| **Release 1 (Sprint 3–4)** | Social sign-up | Remember me | Edit profile | Search & filter | Guest checkout |
| **Future** | SSO | Biometric login | Delete account | Recommendations | Saved addresses |
```

---

## 7. Capacity Hedging

Add a buffer to sprint capacity to account for unplanned work:

```
Adjusted Capacity = Raw Capacity × Focus Factor × (1 - Buffer)

Buffer:
  Stable team, mature codebase:    10%
  New team or new domain:          20%
  High interrupt rate:             25–30%
```

If the team consistently finishes early → reduce buffer gradually.
If the team consistently doesn't finish → increase buffer or reduce commitment until the root cause is fixed.

**Never reward velocity inflation.** Buffer should be used to absorb uncertainty, not to lower expectations permanently.
