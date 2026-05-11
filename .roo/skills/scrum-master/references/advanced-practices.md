# Advanced Scrum Practices

1. [Estimation](#1-estimation)
2. [Velocity & capacity](#2-velocity--capacity)
3. [Backlog refinement](#3-backlog-refinement)
4. [Story splitting & mapping](#4-story-splitting--mapping)
5. [Scaling Scrum](#5-scaling-scrum)
6. [Capacity hedging](#6-capacity-hedging)

Retrospective formats live in `references/sm-coaching.md`.
Game-specific scaling (PO hierarchy, communities of practice, hardening sprints) lives in `references/game-development.md`.

---

## 1. Estimation

### Planning Poker

1. PO reads item, answers clarifying questions
2. Each member secretly picks (Fibonacci: 1, 2, 3, 5, 8, 13, 21, ?)
3. Reveal simultaneously
4. Outliers explain; discuss; re-vote if needed
5. Consensus = estimate

**Never average.** Find consensus through discussion.

### T-shirt sizing (epics / roadmap)

XS, S, M, L, XL — relative without points; for rough roadmap before items are sprint-ready.

### Three-point (high-risk items)

Optimistic (O), Pessimistic (P), Most Likely (M). **Expected = (O + 4M + P) / 6.**

### Three Amigos

Before estimating, convene PO (what) + Developer (how) + Tester (what could go wrong). Surfaces hidden AC and unknowns. Game-team variant: add discipline-specific reps (artist, designer, audio) for cross-disciplinary stories.

### Spikes

Time-boxed research stories. Output is _knowledge_, not increment. Use when an item can't be estimated until something is investigated. Common in concept stage and emergent tech work.

---

## 2. Velocity & capacity

### Calculating velocity

- Track SP **completed** (not started) per sprint, last 3–5 sprints
- Use the **average** as planning velocity, never the highest
- Erratic velocity → investigate root cause (scope creep, refinement quality, churn)

### Capacity formula

```
Capacity = (Available Days × Focus Factor) × Team Size
Focus Factor: 0.6–0.7 (meetings, email, context-switching)
```

### Velocity is NOT a performance metric

Rewarding higher velocity creates SP inflation and destroys signal. Compare velocity to itself over time, never between teams.

---

## 3. Backlog refinement

### INVEST

- **I**ndependent — develops/deploys alone
- **N**egotiable — scope adjusts in conversation
- **V**aluable — value to user/stakeholder
- **E**stimable — team can size it
- **S**mall — fits in one sprint
- **T**estable — AC verifiable

### Priority horizons (Now / Next / Later / Future)

| Horizon | Detail                     | Sprint distance |
| ------- | -------------------------- | --------------- |
| Now     | Fully refined, DoR met     | Sprint 1        |
| Next    | Basic AC, rough estimate   | Sprint 2–3      |
| Later   | Described, coarse estimate | Sprint 4–6      |
| Future  | Idea-level                 | 6+ sprints      |

### WSJF (Weighted Shortest Job First)

For SAFe / scaled environments.

```
WSJF = Cost of Delay / Job Duration
Cost of Delay = User-Business Value + Time Criticality + Risk Reduction/Opportunity Enablement
```

Higher WSJF = higher priority.

---

## 4. Story splitting & mapping

### Splitting patterns

| Pattern          | Example                                |
| ---------------- | -------------------------------------- |
| Workflow step    | Checkout → Address / Payment / Confirm |
| User type        | Manage users → Admin / Self-service    |
| Data variation   | Export → CSV / PDF                     |
| Happy path first | Core flow → edge cases later           |

Game variant: split **by mechanic** (jump, attack, defend) and by **stand-in vs final asset** — get the mechanic playable with placeholders, polish in later sprints.

### Story mapping (90-min session)

Two axes: **horizontal** = user activities in workflow order (the backbone); **vertical** = depth — top is walking skeleton, lower rows are enhancements.

1. Persona + goal (10 min)
2. Walk the journey L→R; activity cards (nouns) (20 min)
3. Under each activity, user tasks (verbs) (20 min)
4. Under each task, smallest-value stories (20 min)
5. Slice lines: MVP, Full Release, Future (20 min)

```markdown
## Story Map — [Feature]

| Activity →     | Register    | Log In      | Manage       | Browse          | Checkout       |
| -------------- | ----------- | ----------- | ------------ | --------------- | -------------- |
| **MVP (S1–2)** | Create acct | Email/pw    | Change pw    | Product list    | Add to cart    |
| **R1 (S3–4)**  | Social SSO  | Remember me | Edit profile | Search/filter   | Guest checkout |
| **Future**     | SSO         | Biometric   | Delete acct  | Recommendations | Saved addrs    |
```

---

## 5. Scaling Scrum

### Scrum of Scrums

- Reps from each team meet 2–3×/week
- Each rep: what did my team do? what next? what's blocking us? **what is my team about to throw in others' way?**
- Used when 2–8 teams share a product

### SAFe (Scaled Agile Framework)

- PI Planning replaces Sprint Planning at scale (8–12 sprints planned together)
- Agile Release Trains (ARTs) = 5–12 teams
- Adds Lean Portfolio Management, Business Owners, Release Train Engineers

### LeSS (Large-Scale Scrum)

- One PO, one Product Backlog shared across all teams
- Multiple dev teams on the same product
- Closer to vanilla Scrum than SAFe

### When to scale

Only when one team can't deliver fast enough. Premature scaling adds coordination overhead without value. Default: one team first.

For game studios specifically, scaling brings **PO hierarchies** (lead PO + feature POs), **communities of practice**, **aligned sprints**, and **lookahead planning** — see `references/game-development.md` §6.

---

## 6. Capacity hedging

```
Adjusted Capacity = Raw Capacity × Focus Factor × (1 - Buffer)

Buffer:
  Stable team, mature codebase:    10%
  New team or new domain:          20%
  High interrupt rate:             25–30%
```

Consistently finishing early → reduce buffer. Consistently not finishing → increase buffer **or** reduce commitment until root cause is fixed. Never reward velocity inflation; buffer absorbs uncertainty, not lowers expectations permanently.
