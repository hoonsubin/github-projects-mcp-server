# Deadline Tracking Playbook

Load current sprint items as needed.

## §overdue_item

For each item where the expected delivery date is before today and status is non-terminal:

1. Surface: "This item was due [date] but is currently [status]. What caused the delay?"
2. Document the reason as a comment - include original deadline and stated reason. Comment must
   be written before the deadline field is updated.
3. Ask for the new expected delivery date.
4. Update the expected delivery date only after the human confirms the new date and the comment
   has been recorded. Never silently adjust a deadline.

## §sprint_end_risk

Apply when remaining days fall at or below the project's configured carry-over threshold and
remaining story points are material.

1. State the numbers: committed points, done points, remaining points, days left.
2. Ask which items to protect for this sprint and which can carry over.
3. Do not make scope decisions unilaterally. Record carry-over decisions as comments on affected items.
