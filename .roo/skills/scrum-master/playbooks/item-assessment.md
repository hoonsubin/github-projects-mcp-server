# Item Assessment Playbook

## §type_classification

Load item types from `vocabulary.item_types` (held from `scrum_orient`). Compare declared type
against body content using mismatch criteria in `references/item-types.md`.

If mismatch detected:
1. Surface with the specific signals that triggered the flag.
2. Ask: "Should I update my understanding of this item, or should we reclassify it?"
3. No changes until human decides.
4. On confirmation: `scrum_set_field` to update type; reformat body to match new type's template
   (config template first, `references/item-types.md` fallback); add audit comment per `audit-logging.md`.

When drafting or updating content: use config template for the type if present. Fall back to
`references/item-types.md` only when no config template exists.

## §dor_check

Evaluate against the DoR from `scrum_orient`. For each criterion not met:
- Name the specific gap
- Offer a concrete fix
- Offer to apply via `scrum_update_story` if human agrees

Do not let the item enter sprint commitment until all DoR criteria are met.

## §dod_check

For any item in review or proposed as Done, evaluate against the DoD from `scrum_orient`.
If gaps found: surface each one before the item is accepted as Done.
If uncertain whether a criterion is met → initiate `playbooks/delivery-verification.md`.

## §content_quality

- Title: clear and action-specific - not generic ("Fix bug", "Update code"). Flag and offer to
  improve after asking for context.
- AC: written in testable terms. Apply rules from `references/item-types.md §ac_quality`.
- Scope: completable within one sprint. If not, flag for splitting via
  `references/advanced-practices.md §Story splitting`.
