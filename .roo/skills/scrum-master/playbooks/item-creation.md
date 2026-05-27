# Item Creation Playbook

Applies whenever the agent receives a request to create a new backlog item — including
requests phrased as "add a story", "log a bug", "capture this as a ticket", or any
equivalent. This playbook defines a strict five-phase gate protocol. No call to
`scrum_create_story` is permitted until all phases are complete and the human has explicitly
confirmed every field value. The agent proposes; the human decides.

The same confirmation principle applies to field mutations on existing items — see
§field_mutation at the end of this playbook.

---

## Phase 1 — Duplicate scan (mandatory before drafting anything)

Before writing a single word of item content, scan the board for semantically similar
existing items.

1. Call `scrum_get_backlog` to load open backlog items.
2. If a sprint is active, also call `scrum_get_sprint` to include in-progress items.
3. Compare titles and type against the requested item for semantic overlap — same outcome,
   same problem domain, same component, or a subset/superset relationship.
4. If one or more matches are found, surface them and stop:

   > "Before I draft this, I found [N] item(s) that may overlap:
   > — #[ID]: [Title] ([status display label])
   > — #[ID]: [Title] ([status display label])
   >
   > Is this a new item, a duplicate of one of these, or a related-but-distinct piece of work?"

5. **Duplicate confirmed** → do not create. Offer to update or link the existing item instead.
6. **Distinct confirmed** → note the human's confirmation and continue to Phase 2.
7. **No matches found** → continue to Phase 2 silently (no need to report the clean scan).

---

## Phase 2 — Draft item content

1. If the item type was not stated, ask before drafting:

   > "What type is this item? Options: [list vocabulary.item_types keys from orient data]"

2. Load `vocabulary.item_types[type].template` from the orient data held in session.
   If no config template exists for this type, fall back to `references/item-types.md`
   canonical format for that type.

3. Draft a complete item body using the template. Fill every section. Where information
   is genuinely unknown, write `[TBD — describe X]` rather than omitting the section.

4. **Run AC quality check before presenting the draft.** Read `references/item-types.md §ac_quality`
   for the rules that apply to this item type, then evaluate every acceptance criterion in the draft
   against them. Fix any violations inline — do not surface a draft that already fails the quality
   rules. Specifically verify:
   - Minimum criterion count is met (type-specific; user_story requires ≥ 3 including an error path)
   - Each criterion describes observable behaviour, not internal system actions
   - No criterion contains compound conditions ("and" joining two observable outcomes)
   - No vague words: "correctly", "properly", "appropriately", "as expected", "works", "handles"

5. Present the draft to the human, including a brief AC quality summary:

   > "Here's a draft. AC: [N] criteria — [happy path summary], [error path summary].
   > Does this capture what you have in mind, or should we adjust
   > the title, body, or acceptance criteria?"

6. Revise iteratively until the human approves the content. Re-run the AC quality check
   after any revision that touches the criteria. Do not advance to Phase 3
   while the content is still under discussion — field assignment on a moving target
   creates rework.

---

## Phase 3 — Field confirmation

Once the content is approved, present **all four field questions in a single structured
block**. Do not split them across separate messages — one round trip is efficient and
respectful of the human's time.

Use this format exactly, substituting live values from the orient data:

---

**Before I create this item, I need your input on four fields:**

**1 · Story Points**
Based on [one-sentence scope/complexity summary], my suggested range is **[N]–[M] points**
because [brief reasoning].
↑ Higher if: [factor that increases uncertainty or scope]
↓ Lower if: [factor that reduces uncertainty or scope]
→ What SP value do you want? (or "skip" to leave unestimated for now)

**2 · Priority**
→ Which priority? Options: [list vocabulary.priority display labels in order p0→p3]

**3 · Epic / Milestone**
→ Should this be linked to an epic? Available: [list epic/milestone names from orient data,
   or "none configured" if the platform has no milestones]
   (or "none" to leave unlinked)

**4 · Sprint placement**
→ Where should this go?
   a) Backlog (default for new work)
   b) Active sprint: "[sprint name]" — only for critical production incidents
   c) A future sprint — specify which one
   Note: mid-sprint scope injection should only happen for critical production incidents.
   Everything else goes to the backlog, regardless of priority.

**5 · Labels**
→ Which labels should be applied? Available: [list label options from vocabulary]
   (or "none")

---

Wait for the human's explicit response to all five dimensions. Do not infer, assume, or
apply a default for any field the human does not address — ask again specifically for
any field left unanswered before proceeding to Phase 4.

---

## Phase 4 — Creation gate (final confirmation)

Before calling `scrum_create_story`, read the complete field manifest back to the human
and wait for an explicit "yes" or "confirm":

> "Creating this item with:
> — Title: [title]
> — Type: [type display label]
> — SP: [value] (or "unestimated")
> — Priority: [display label]
> — Epic: [name] (or "none")
> — Sprint: [sprint name] (or "backlog")
> — Labels: [list] (or "none")
>
> Confirm to proceed?"

Only call `scrum_create_story` after receiving explicit confirmation. If the human adjusts
any value at this stage, update the manifest and present it again before creating.

---

## Phase 5 — Post-creation

After `scrum_create_story` returns successfully:

1. Report the created item: ID, title, and where it was placed.
2. If `scrum_create_story` did not set all confirmed fields directly, apply the remaining
   ones via `scrum_set_field` immediately — do not leave fields in a partially-set state.
3. Add an audit comment via `scrum_update_story` recording the item's initial field state
   (SP, priority, epic, sprint, labels) and that it was created this session.
   Format per `playbooks/audit-logging.md`.
4. If the item landed in the backlog, offer a DoR check:

   > "This item is now in the backlog. Want me to run a DoR check before your next
   > refinement session?"

---

## §field_mutation — Confirming field changes on existing items

When the human requests a field change on an existing item — or when the agent proposes
one proactively — the same confirmation principle applies: **propose, then wait for
explicit approval before writing**.

For every proposed field mutation:

1. State the current value and the proposed new value:
   > "I'd like to update [field] on #[ID] from [current value] to [new value]
   > because [one-sentence reason]. Confirm?"

2. For SP and priority specifically: never suggest a value without reasoning (see
   `playbooks/story-points.md §estimation_guidance`).

3. Wait for explicit confirmation. Do not apply the change speculatively.

4. After writing: add an audit comment per `playbooks/audit-logging.md` if the change
   type appears in that playbook's "When to log" table.

**Batch mutations:** If multiple fields need to change at once, list them all in a single
confirmation block (same pattern as Phase 4 above) rather than asking one field at a time.
