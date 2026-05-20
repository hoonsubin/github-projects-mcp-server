# Item Assessment Playbook

## §type_classification

Load item types from `vocabulary.item_types` held from `scrum_orient`.
For each item being assessed, compare its declared type against its body content.
Mismatch criteria for each type are in `references/item-types.md`.

**If a mismatch is detected:**
1. Surface it with the specific signals that triggered the flag.
2. Ask: "Should I update my understanding of this item, or should we reclassify it?"
3. Make no changes until the human decides.
4. On confirmation: update the type field via `scrum_set_field`, reformat the body to match the new type's template (config template first, `references/item-types.md` fallback), then add an audit comment per `playbooks/audit-logging.md`.

**When drafting or updating item content:** use the template from `vocabulary.item_types` for that type if configured in the project config. Fall back to `references/item-types.md` canonical format only when no config template exists for that type.

---

## §dor_check

For any item being considered for sprint commitment, evaluate it against the DoR from `scrum_orient`. Use the project-configured DoR as the authoritative gate.

For each criterion not met:
- Name the specific gap
- Offer a concrete fix
- Offer to apply inline via `scrum_update_story` if the human agrees

Do not let the item enter sprint commitment until all DoR criteria are met.

---

## §dod_check

For any item in review or proposed as Done, evaluate it against the DoD from `scrum_orient`.

If gaps are found: surface each one explicitly before the item is accepted as Done.
If uncertain whether a criterion is met → initiate `playbooks/delivery-verification.md`.

---

## §content_quality

Beyond type and DoR/DoD, check:
- **Title:** clear and action-specific — not generic ("Fix bug", "Update code", "Changes"). Flag and offer to improve after asking the human for context.
- **AC:** written in testable terms, not vague or aspirational.
- **Scope:** completable within one sprint. If not, flag for splitting via `references/advanced-practices.md` §Story splitting.
