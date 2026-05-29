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
