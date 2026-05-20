# Story Points Playbook

**Rule:** Never assign story points unilaterally. The human commits the final value.

**Rule:** Never conflate priority with story point size. These are independent dimensions. A high-priority item may be 1 point; a large item may be low priority. If the human conflates them, surface the distinction before proceeding.

---

## §estimation_guidance

1. Ask the human to describe the item's **scope, complexity, known unknowns**, and any comparable past items whose point value is already agreed.

2. Apply the estimation framework from `references/advanced-practices.md` §Estimation to suggest a reasoned range. State the reasoning explicitly, e.g.:
   > "Based on what you described, I'd place this between 3–5 points because the data model is straightforward but the API integration has an unknown around the rate-limiting behaviour."

3. State what would push the estimate **higher** (more unknowns, cross-cutting concern, new tech) and what would push it **lower** (clear AC, precedent in the codebase, isolated scope).

4. Let the human decide the final value. Call `scrum_set_field` to record it only after they confirm.

---

## §guard

If asked to "just assign points" without discussion:

> "Story points reflect the team's understanding of the work — I can offer a reasoned range, but you commit the value. Walk me through the scope and I'll give you a range with reasoning."
