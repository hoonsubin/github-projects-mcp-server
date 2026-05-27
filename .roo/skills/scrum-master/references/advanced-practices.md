# Advanced Scrum Practices

*Retrospective formats → `sm-coaching.md`. Game-specific scaling → `game-development.md` §6.*

---

## Estimation

| Method | When | How |
|---|---|---|
| **Planning Poker** | Sprint-ready items | Each member secretly picks (Fibonacci); reveal simultaneously; outliers explain; re-vote to consensus. **Never average.** |
| **T-shirt sizing** | Epics / roadmap | XS, S, M, L, XL — relative, no points; for rough roadmap before items are sprint-ready |
| **Three-point** | High-risk items | O=optimistic, P=pessimistic, M=most likely → Expected = (O + 4M + P) / 6 |
| **Spikes** | Can't estimate until investigated | Time-boxed research story; output is *knowledge*, not increment |

**Three Amigos** — before estimating: convene PO (what) + Developer (how) + Tester (what could go wrong). Surfaces hidden AC. Game variant: add discipline-specific reps (artist, designer, audio).

---

## Velocity & capacity

```
Capacity = Available Days × Focus Factor × Team Size
Focus Factor: 0.6–0.7 (meetings, email, context-switching)

Adjusted Capacity = Raw Capacity × Focus Factor × (1 - Buffer)
Buffer: stable team 10% / new team or domain 20% / high interrupt rate 25–30%
```

- Track SP **completed** (not started) per sprint, last 3–5 sprints
- Use the **average** as planning velocity, never the highest
- Erratic velocity → investigate root cause (scope creep, refinement quality, churn)
- **Velocity is not a performance metric.** Rewarding higher velocity creates SP inflation. Compare velocity to itself over time, never between teams.
- Consistently finishing early → reduce buffer. Consistently not finishing → increase buffer *or* reduce commitment until root cause is fixed.

---

## Backlog refinement

### INVEST — well-formed story checklist

Use this to evaluate a story before sprint commitment or as a drafting quality gate during
`playbooks/item-creation.md` Phase 2. A story that fails any criterion should be flagged and
fixed before creation, not after.

| Letter | Signal | Failure pattern to flag |
|---|---|---|
| **I**ndependent | Can be developed, tested, and delivered without another incomplete story. | "This can't be built until story X is done." → split or resequence. |
| **N**egotiable | Describes the outcome and value; the implementation is left to the team. | Body specifies exact technical approach ("use Redis for caching") → rewrite to describe the desired outcome instead. |
| **V**aluable | The "so that" clause names a tangible user or business outcome. | "So that the code is cleaner" or "so that tests are easier" → not a user-value statement; rewrite or reclassify as `tech_debt`. |
| **E**stimable | The team has enough information to size the story. | "We can't estimate this without more research" → create a spike first. |
| **S**mall | Completable within one sprint at the team's current velocity. | Estimated SP exceeds ~40% of typical sprint velocity → split before creating. |
| **T**estable | Acceptance criteria are specific enough for a clear pass/fail verdict. | Any AC containing "correctly", "properly", "as expected", or "works" → fails testability; rewrite. |

When a story fails I, N, or V: surface the finding and ask the human how to resolve it before proceeding.
When a story fails E or S: offer to create a spike (E) or split the story (S) before creation.
When a story fails T: apply the AC quality rules from `references/item-types.md §ac_quality`.

### Priority horizons

| Horizon | Detail | Sprint distance |
|---|---|---|
| Now | Fully refined, DoR met | Sprint 1 |
| Next | Basic AC, rough estimate | Sprint 2–3 |
| Later | Described, coarse estimate | Sprint 4–6 |
| Future | Idea-level | 6+ sprints |

### WSJF (Weighted Shortest Job First) — for scaled environments

```
WSJF = Cost of Delay / Job Duration
Cost of Delay = User-Business Value + Time Criticality + Risk Reduction/Opportunity Enablement
```
Higher WSJF = higher priority.

---

## Story splitting & mapping

### Splitting patterns

| Pattern | Example |
|---|---|
| Workflow step | Checkout → Address / Payment / Confirm |
| User type | Manage users → Admin / Self-service |
| Data variation | Export → CSV / PDF |
| Happy path first | Core flow → edge cases later |

*Game variant: split by mechanic (jump, attack, defend) and by stand-in vs. final asset — get the mechanic playable with placeholders, polish in later sprints.*

### Story mapping (90-min session)

Two axes: **horizontal** = user activities in workflow order (backbone); **vertical** = depth (top = walking skeleton, lower rows = enhancements).

1. Persona + goal (10 min)
2. Walk the journey L→R; activity cards (nouns) (20 min)
3. Under each activity, user tasks (verbs) (20 min)
4. Under each task, smallest-value stories (20 min)
5. Slice lines: MVP / Full Release / Future (20 min)

---

## Scaling Scrum

| Framework | When | Key mechanism |
|---|---|---|
| **Scrum of Scrums** | 2–8 teams sharing a product | Reps meet 2–3×/week; 4th question: "what is my team about to throw in others' way?" |
| **SAFe** | 5–12 teams (Agile Release Trains) | PI Planning replaces Sprint Planning at scale; adds Lean Portfolio Management |
| **LeSS** | Multiple teams, one product backlog | One PO, one Product Backlog; closer to vanilla Scrum than SAFe |

**When to scale:** only when one team can't deliver fast enough. Premature scaling adds coordination overhead without value. Default: one team first.
