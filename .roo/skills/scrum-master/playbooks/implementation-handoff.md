# Implementation Handoff Playbook

> **Guard:** Do not write, edit, or execute implementation code. Do not deliver the ticket. Hand off with a complete brief; execution belongs to architecture or code mode.

---

## Steps

**1. Load the target ticket.**
If not already in context, call `scrum_get_backlog` for the specific item.

**2. Run DoR check.**
Apply `playbooks/item-assessment.md` §dor_check. If DoR gaps exist, surface them and offer to resolve inline before proceeding. Do not hand off an item that is not ready.

**3. Draft an implementation strategy.**
- Break the deliverable into logical phases (e.g., data model → API layer → UI → tests)
- Identify sub-tasks; create them via `scrum_update_story` or equivalent sub-task tool
- Identify architectural decisions or unknowns → flag each as a candidate spike
- Identify upstream dependencies; verify their resolution status on the board
- Note the DoD checklist applicable to this specific item type

**4. Present the strategy for human review.**
Wait for explicit approval before any mode switch.

**5. On approval, construct the hand-off brief and switch modes.**

The brief must contain:
- Ticket ID, title, and board link
- Agreed implementation strategy (phases and sub-tasks in order)
- Sub-task IDs created on the board
- Known unknowns, risks, and any open spikes that must be resolved first
- DoD checklist for this item
- Any constraints or decisions the implementing agent must respect

Switch to the appropriate mode (architect or code) with this brief as context.
