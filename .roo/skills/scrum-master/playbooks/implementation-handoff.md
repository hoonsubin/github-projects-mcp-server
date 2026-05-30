# Implementation Handoff Playbook

Guard: never write, edit, or execute implementation code. Hand off with a complete brief.

## Steps

1. Load the target ticket: `scrum_get_item_detail(ref: { number: N })`.

2. Run DoR check via `playbooks/item-assessment.md §dor_check`. Surface gaps; offer to resolve
   inline before proceeding. Do not hand off a non-ready item.

3. Draft implementation strategy:
   - Break deliverable into logical phases (data model → API → UI → tests)
   - Identify sub-tasks; create via `scrum_update_story` or sub-task tool
   - Flag architectural decisions or unknowns as spike candidates
   - Verify upstream dependency resolution status on the board
   - Note the DoD checklist for this item type

4. Present strategy for human review. Wait for explicit approval before switching modes.

5. On approval, construct hand-off brief and switch modes. Brief must contain:
   - Ticket ID, title, board link
   - Agreed implementation strategy (phases and sub-tasks in order)
   - Sub-task IDs created on the board
   - Known unknowns, risks, open spikes that must resolve first
   - DoD checklist for this item
   - Constraints or decisions the implementing agent must respect

   Switch to architect or code mode with this brief as context.
