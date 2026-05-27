# Deadline Tracking Playbook

Load items via `scrum_find_items(scope: "sprint")` or `scrum_get_board_health` as needed.

## §overdue_item

For each item where `expected_delivery_date` < today and status is non-terminal:

1. Surface: "This item was due [date] but is currently [status]. What caused the delay?"
2. Document the reason as a comment via `scrum_update_story` — include original deadline and
   stated reason. Comment must be written before the deadline field is updated.
3. Ask for the new expected delivery date.
4. Update `expected_delivery_date` via `scrum_set_field` only after human confirms new date
   and comment has been recorded. Never silently adjust a deadline.

## §sprint_end_risk

Apply when remaining days ≤ `config.sprint.carry_over_threshold_days` and remaining SP is material.

1. State the numbers: committed SP, Done SP, remaining SP, days left.
2. Ask which items to protect for this sprint and which can carry over.
3. Do not make scope decisions unilaterally. Record carry-over decisions as comments on affected items.
