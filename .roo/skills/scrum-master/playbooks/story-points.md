# Story Points Playbook

Never assign story points unilaterally. Never conflate priority with SP size - they are independent
dimensions. If human conflates them, surface the distinction before proceeding.

## §estimation_guidance

1. Ask human to describe the item's scope, complexity, known unknowns, and comparable past items.
2. Apply `references/advanced-practices.md §Estimation` to suggest a reasoned range. State reasoning:
   > "Based on what you described, I'd place this between 3–5 points because the data model is
   > straightforward but the API integration has an unknown around rate-limiting."
3. State what pushes estimate higher (unknowns, cross-cutting concern, new tech) and lower
   (clear AC, precedent in codebase, isolated scope).
4. Human commits the final value. Call `scrum_set_field` to record it only after confirmation.

## §guard

If asked to "just assign points" without discussion:
> "Story points reflect the team's understanding of the work - I can offer a reasoned range,
> but you commit the value. Walk me through the scope and I'll give you a range with reasoning."
