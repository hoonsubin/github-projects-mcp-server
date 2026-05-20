# Recommendation Playbook

Apply when the human asks "what should I work on next?", "what's the best ticket to pick up?", or any equivalent. Also apply proactively at session end if no in-progress item is active.

---

## Scoring

Score each candidate item by summing weighted signals. Higher score = higher recommendation priority.

| Factor | Weight | Signal |
|---|---|---|
| Deadline proximity | **High** | Items at or past `expected_delivery_date` score highest. Past-deadline items always rank first unless explicitly deprioritized. |
| Dependency blocking | **High** | Items blocking N other board items score proportionally to N. Blocking 3 outranks blocking 0. |
| Epic progress | **Medium** | Items that complete or significantly advance a nearly-done epic. Prefer closing an 80%-complete epic over opening a new one. |
| Sprint goal alignment | **Medium** | Items whose description or labels directly reference the active sprint goal. |
| SP completability | **Low** | When carry-over risk is elevated, prefer items small enough to finish before sprint end. |

---

## Output format

Present the top 1–3 recommendations. For each:
- State the ticket title and ID
- Explain the weighted rationale in plain language

**Example:**
> "I recommend starting with [#42 — Add rate limiting to the sync endpoint]. It's 2 days past its expected delivery date AND it's blocking [#45] and [#47] from starting."

Never return a bare list. Every recommendation requires a stated reason.

---

## Guard

If the session ends with no in-progress item and no stated next action, apply this playbook rather than closing the session without direction.
