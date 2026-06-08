# Recommendation Playbook

Apply when human asks "what should I work on next?" or equivalent. Also apply proactively at
session end if no in-progress item is active.

## Scoring

| Factor | Weight | Signal |
|---|---|---|
| Deadline proximity | High | At or past `expected_delivery_date` → always ranks first unless explicitly deprioritized |
| Dependency blocking | High | Items blocking N others score proportionally to N |
| Epic progress | Medium | Items that complete or significantly advance a nearly-done epic |
| Sprint goal alignment | Medium | Items whose description or labels reference the active sprint goal |
| SP completability | Low | When carry-over risk elevated, prefer items finishable before sprint end |

## Output

Present top 1–3 recommendations. Per item: state ticket title, ID, and weighted rationale.
Never return a bare list - every recommendation requires a stated reason.
> "I recommend [#42 - Add rate limiting]. It's 2 days past its delivery date AND blocking #45 and #47."

If session ends with no in-progress item and no stated next action, apply this playbook.

## Edge cases

### All top candidates are blocked

Scoring will surface blocked items naturally (Blocked status, open impediment). When the top-N
candidates are all blocked, do not force a recommendation from a broken pool. Instead:

1. Surface the pattern explicitly: "Your top [N] prioritised items are all blocked. Resolving any
   one of them unlocks the sprint."
2. Shift the recommendation to **impediment removal**: identify which impediment has the clearest
   owner or the shortest resolution path and recommend that as the next action.
3. If impediment removal is outside the team's authority, recommend the **highest-scoring
   unblocked item** from the backlog, even if it's lower priority than the blocked items — idle
   time compounds cost. State the trade-off explicitly.
4. If all sprint items are blocked and no unblocked backlog item is DoR-complete, move to the
   Zero DoR-complete path below.

### Sprint is over-committed

Signal: `committed_SP > capacity_SP` (from SKILL.md capacity formula) or `riskStance` is
`"elevated"` from `scrum_orient`.

Do not recommend adding work. Instead:

1. State the numbers: "The sprint has [X] SP committed against [Y] SP capacity. Carry-over is
   likely unless scope is cut."
2. Apply the `SP completability` scoring factor exclusively — recommend only items that can
   realistically finish before sprint end.
3. Offer a scope-cut conversation: present the lowest-priority committed items and ask which
   can move to the backlog without breaking the sprint goal.
4. Do not recommend new items from the backlog until carry-over risk is addressed.

### No DoR-complete items

Signal: backlog scan finds every item missing at least one DoR criterion.

Starting blocked work compounds technical debt and demoralises the team (Scrum Guide: teams
commit only to items they understand). The right action is refinement, not commitment.

1. Recommend a **refinement session** as the next action: "No items are sprint-ready. Running a
   refinement session now will unblock planning."
2. Identify the **shortest path to DoR-complete**: pick the 1–2 items closest to ready (fewest
   gaps) and list exactly what each is missing. These are the refinement targets.
3. If the human must pick something now (e.g. emergency context): recommend the item with the
   fewest DoR gaps and the most clearly understood scope, and explicitly flag the risks.
4. After refinement closes the gaps, re-run this playbook.
