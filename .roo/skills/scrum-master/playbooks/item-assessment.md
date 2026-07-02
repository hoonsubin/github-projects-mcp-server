# Item Assessment Playbook

## §type_classification

Load the project's configured item types. Compare declared type against body content using
mismatch criteria in `references/item-types.md`.

If mismatch detected:
1. Surface with the specific signals that triggered the flag.
2. Ask: "Should I update my understanding of this item, or should we reclassify it?"
3. No changes until human decides.
4. On confirmation: update the type field; reformat body to match the new type's template
   (config template first, `references/item-types.md` fallback); add audit comment per `audit-logging.md`.

When drafting or updating content: use the project's configured template for the type if present.
Fall back to `references/item-types.md` only when no such template exists.

## §dor_check

Evaluate against the project's configured DoR. For each criterion not met:
- Name the specific gap
- Offer a concrete fix
- Offer to apply it if human agrees

Do not let the item enter sprint commitment until all DoR criteria are met.

## §dod_check

For any item in review or proposed as Done, evaluate against the project's configured DoD.
If gaps found: surface each one before the item is accepted as Done.
If uncertain whether a criterion is met → initiate `playbooks/delivery-verification.md`.

## §content_quality

- Title: clear and action-specific - not generic ("Fix bug", "Update code"). Flag and offer to
  improve after asking for context.
- AC: written in testable terms. Apply rules from `references/item-types.md §ac_quality`.
- Scope: completable within one sprint. If not, flag for splitting via
  `references/advanced-practices.md §Story splitting`.
