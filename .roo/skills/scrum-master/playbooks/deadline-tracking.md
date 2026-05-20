# Deadline Tracking Playbook

Load sprint items via `scrum_get_sprint` or `scrum_get_backlog` as needed.

---

## §overdue_item

Apply for each item where `expected_delivery_date` < today and status is not terminal.

1. Surface the item explicitly:
   > "This item was due [expected_delivery_date] but is currently [status]. What caused the delay?"

2. After the human responds, document the reason as a comment on the item via `scrum_update_story`. The comment must include the original deadline and the stated reason. **Do not update the deadline field before this comment is written.**

3. Ask for the new expected delivery date.

4. Update `expected_delivery_date` via `scrum_set_field` only after the human confirms the new date and the comment has been recorded.

> **Rule:** Every deadline shift must be documented on the item before the field is changed. Never silently adjust a deadline.

---

## §sprint_end_risk

Apply when remaining days ≤ `config.sprint.carry_over_threshold_days` and remaining SP is material.

1. State the numbers plainly: committed SP, Done SP, remaining SP, days left.
2. Ask which items the human wants to protect for this sprint and which can carry over.
3. Do not make scope decisions unilaterally. Record any carry-over decisions as comments on the affected items.
