# Backlog Grooming Playbook

Apply when: human requests a backlog health check, DoR audit, pre-refinement scan, or "what's the
state of the backlog?". Also apply proactively before Sprint Planning if board health has not been
loaded this session.

## Phase 1 - Scope selection

Ask if not specified: full backlog, a specific epic, or top-N by priority?
Default: all open backlog items excluding Done.

`scrum_find_items(scope: "backlog")` — if sprint active, also `scrum_find_items(scope: "sprint")`
to include in-progress items.

## Phase 2 - Item health check

For each item, run checks in sequence. Collect all gaps before surfacing — do not interrupt per item.

| Check | Signal | Flag |
|---|---|---|
| Type vs. content | Body does not match declared type | type_mismatch |
| DoR completeness | Any DoR criterion unmet | dor_gap |
| Staleness | No update in 60+ days, not in sprint, no open deps | stale |
| Size | Estimate >40% of velocity, or multiple independent deliverables | oversized |
| Premise validity | AC describes a gap that may already be resolved | premise_unverified |

Present findings as a table before taking any action:

> | #ID | Title | Gaps |
> | #42 | Add rate limiting | No AC, unestimated |
> | #67 | Fix login timeout | Stale (84 days), premise unverified |

## Phase 3 - Triage per flagged item

Offer only the options relevant to the item's flags. One confirmation per item or batched if human
prefers. Confirm before any write.

**type_mismatch:** "Reclassify and reformat body?" → on confirm: `scrum_set_field` type +
`scrum_update_story` body to match type template + audit comment.

**dor_gap:** "Refine inline?" → fill the specific missing element → `scrum_update_story` → re-check.

**stale:** Three options only — (a) re-confirm intent and update premise; (b) icebox with label;
(c) close as won't-do. Never silently archive or delete.

**oversized:** Offer split or Epic placeholder conversion. Read
`references/advanced-practices.md §Story splitting` before proposing a split structure.

**premise_unverified:** Flag before Planning. "This item's premise should be verified before the
next sprint commitment." Offer to add a verification note to the body.

## Phase 4 - Readiness report

After all items reviewed, produce a summary:

> **Backlog readiness — [date]**
> DoR-complete: [N] items · [X] SP
> Gaps found: [N] items — [list #IDs]
> Stale: [N] items — disposition offered above
> Sprint-ready (top by priority): #[A], #[B], #[C]

If `sprints_to_clear > planning_horizon` (from SKILL.md throughput formula), surface it here.
