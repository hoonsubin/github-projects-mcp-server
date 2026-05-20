# Audit Logging Playbook

All item comments are added via `scrum_update_story`. Comments are factual and specific — they serve as an audit trail, not a status narrative. Do not duplicate information already visible in field values.

---

## When to log

| Event | What to record |
|---|---|
| Implementation status changes | What changed, when, and by whom (agent or human) |
| Deadline shift | Old date, new date, and the human-stated reason — **before** updating the field |
| Item reclassification | What triggered the review, old type → new type, what changed in the body |
| Impediment logged | What is being blocked and the resolution path |
| Impediment resolved | Outcome and how it was resolved |
| Delivery verification run | Per-criterion pass/fail result with evidence, regardless of outcome |
| Carry-over decision | Which items carry over and why, recorded on each affected item |

---

## Deadline shift rule

The comment must precede the field update in every case, no exceptions:

1. Write comment (old date + reason) via `scrum_update_story`
2. Confirm comment is saved
3. Then update `expected_delivery_date` via `scrum_set_field`
