# Item Creation Playbook

Applies whenever a request creates a new backlog item. No call to `scrum_create_story` is
permitted until all five phases are complete and the human has explicitly confirmed every field.
The agent proposes; the human decides. The same confirmation principle applies to field mutations
on existing items - see §field_mutation.

## Phase 1 - Duplicate scan (mandatory before drafting)

1. `scrum_find_items(scope: "backlog")` - load open backlog items.
2. If sprint active: `scrum_find_items(scope: "sprint")` - include in-progress items.
3. Compare titles and type for semantic overlap (same outcome, problem domain, component, or
   subset/superset relationship).
4. If matches found, stop and surface:
   > "Before I draft this, I found [N] item(s) that may overlap:
   > - #[ID]: [Title] ([status display label])
   > Is this a new item, a duplicate, or a related-but-distinct piece of work?"
5. Duplicate confirmed → do not create. Offer to update or link the existing item.
6. Distinct confirmed → proceed to Phase 2.
7. No matches → proceed silently.

## Phase 2 - Draft item content

1. If item type not stated, ask before drafting:
   > "What type? Options: [list vocabulary.item_types keys from orient data]"
2. Load `vocabulary.item_types[type].template`. If absent, use `references/item-types.md` fallback.
3. Draft a complete body. Mark unknown sections `[TBD - describe X]`; do not omit them.
4. Run AC quality check before presenting. Read `references/item-types.md §ac_quality` for the
   rules applicable to this type, then verify every criterion in the draft:
   - Minimum count met (user_story: ≥3 including an error path)
   - Each criterion describes observable behaviour, not internal system actions
   - No compound conditions ("and" joining two observable outcomes)
   - No vague words: "correctly", "properly", "appropriately", "as expected", "works", "handles"
   Fix any violations inline before presenting.
5. Present with AC summary:
   > "Here's a draft. AC: [N] criteria - [happy path], [error path].
   > Does this capture what you have in mind?"
6. Revise until human approves content. Re-run AC quality check after any revision touching
   criteria. Do not advance to Phase 3 while content is still under discussion.

## Phase 3 - Field confirmation

Once content is approved, present all five fields in a single block:

---
**Before I create this item, I need your input on five fields:**

**1 · Story Points**
Based on [scope/complexity summary], my suggested range is **[N]–[M] points** because [reasoning].
↑ Higher if: [factor] · ↓ Lower if: [factor]
→ What SP value? (or "skip" to leave unestimated)

**2 · Priority**
→ Options: [list vocabulary.priority display labels p0→p3]

**3 · Epic / Milestone**
→ Options: [list epic/milestone names from orient data, or "none configured"]

**4 · Sprint placement**
→ a) Backlog (default)  b) Active sprint "[sprint name]" - critical incidents only  c) Future sprint
Note: mid-sprint injection only for critical production incidents.

**5 · Labels**
→ Options: [list label options from vocabulary] (or "none")

---

Wait for explicit responses to all five. Do not infer defaults. If a field is left unanswered,
ask specifically about it before proceeding to Phase 4.

## Phase 4 - Creation gate

Read the full manifest back and wait for explicit "confirm":

> "Creating this item with:
> - Title: [title] · Type: [type] · SP: [value or "unestimated"]
> - Priority: [label] · Epic: [name or "none"] · Sprint: [name or "backlog"] · Labels: [list or "none"]
> Confirm to proceed?"

Only call `scrum_create_story` after confirmation. If human adjusts any value, update the
manifest and present again before creating.

## Phase 5 - Post-creation

1. Report created item: ID, title, placement.
2. Apply any confirmed fields not set by `scrum_create_story` via `scrum_set_field` immediately.
3. Add audit comment via `scrum_update_story` recording initial field state (per `audit-logging.md`).
4. If landed in backlog, offer DoR check:
   > "Item is now in the backlog. Want me to run a DoR check before your next refinement?"

## §field_mutation - Confirming field changes on existing items

Before calling `scrum_set_field` or `scrum_update_story` to mutate any field on an existing item:
1. State current and proposed values and reason:
   > "I'd like to update [field] on #[ID] from [current] to [new] because [reason]. Confirm?"
2. For SP and priority: never suggest without reasoning (see `playbooks/story-points.md §estimation_guidance`).
3. Wait for explicit confirmation before writing.
4. After writing: add audit comment per `playbooks/audit-logging.md` if the change type is logged there.

Batch mutations: list all proposed changes in one confirmation block; wait for one "yes".
