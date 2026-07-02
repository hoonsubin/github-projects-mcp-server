# Item Creation Playbook

Applies whenever a request creates a new backlog item. No item may be created until all five
phases are complete and the human has explicitly confirmed every field.
The agent proposes; the human decides. The same confirmation principle applies to field mutations
on existing items - see §field_mutation.

## Phase 1 - Duplicate scan (mandatory before drafting)

1. Load open backlog items.
2. If a sprint is active: include in-progress sprint items too.
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
   > "What type? Options: [list the project's configured item types]"
2. Load the project's configured template for this type. If absent, use `references/item-types.md` fallback.
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
→ Options: [list the project's priority tiers, highest to lowest]

**3 · Epic / Milestone**
→ Options: [list active epics/milestones, or "none configured"]

**4 · Sprint placement**
→ a) Backlog (default)  b) Active sprint "[sprint name]" - critical incidents only  c) Future sprint
Note: mid-sprint injection only for critical production incidents.

**5 · Labels**
→ Options: [list the project's available labels] (or "none")

---

Wait for explicit responses to all five. Do not infer defaults. If a field is left unanswered,
ask specifically about it before proceeding to Phase 4.

## Phase 4 - Creation gate

Read the full manifest back and wait for explicit "confirm":

> "Creating this item with:
> - Title: [title] · Type: [type] · SP: [value or "unestimated"]
> - Priority: [label] · Epic: [name or "none"] · Sprint: [name or "backlog"] · Labels: [list or "none"]
> Confirm to proceed?"

Only create the item after confirmation. If human adjusts any value, update the manifest and
present again before creating.

## Phase 5 - Post-creation

1. Report created item: ID, title, placement.
2. Apply any confirmed fields that weren't set at creation time, immediately.
3. Add an audit comment recording initial field state (per `audit-logging.md`).
4. If landed in backlog, offer DoR check:
   > "Item is now in the backlog. Want me to run a DoR check before your next refinement?"

## §quick_capture - Lightweight backlog draft (not DoR-bound)

Use when the human signals speed or volume over rigor - phrasing like "quickly draft", "just capture
this", "get these on the board", or a batch of rough ideas from a brainstorm/exploration session. This
gate exists because DoR governs Planning entry, not backlog admission (see SKILL.md's Quality gates
section) - forcing full ItemCreation rigor onto a rough capture wastes turns and tokens on fields the
human isn't ready to commit to yet.

1. **Duplicate scan (mandatory, unchanged)** - same as Phase 1. This is the one check that actually
   prevents waste; never skip it regardless of gate.
2. **Minimal content** - type + title + a short intent (1-3 sentences: what and why). No AC-quality
   gate, no template enforcement, no five-field negotiation.
3. Create the item with title, body, and type only. Leave story points, priority, epic, sprint,
   and labels unset - this is the correct default outcome for this gate, not a violation of
   `no_autonomous_field_assignment`. Do not ask the human to explicitly "skip" each field.
4. Post-creation: add one audit comment noting the item was quick-captured and is not yet DoR-complete.
5. Point to `playbooks/backlog-grooming.md`'s DoR completeness check sequence as the follow-up pass -
   do not run that check inline unless the human asks for it in the same turn.

Switch to the full ItemCreation gate (Phases 1-5) instead when: the item is going straight into an
active or near-term sprint, or the human explicitly asks for full drafting/estimation.

## §finding_disposition - Before drafting from a finding

Before entering Phase 1, confirm the finding is actionable by this team in this codebase:

- **Platform limitation** with no workaround path → add a comment to the most relevant existing item; do not create a new one.
- **Symptom of an architectural decision** already tracked at epic level → note the finding in the epic description or a comment on the epic's first child story.
- **Requires a breaking API change** with no current migration path → create a `spike` scoped to "determine migration path" rather than the fix itself.

If none of these apply, proceed to Phase 1.

## §amend_vs_create - Overlapping finding on an existing item

After Phase 1 duplicate scan, if a finding touches the **same file or function** as an in-progress item, apply this decision rule before drafting a new item:

**Amend the existing item when all three hold:**
1. Same file/function scope — fixing both touches the same code
2. The existing item is In Progress or Backlog (not Done/closed)
3. Adding the finding narrows or clarifies the existing item's scope (not additive)

→ Update the existing item's body and add an audit comment noting the addition. Do not create.

**Create a new item when any of these hold:**
- The finding adds distinct new behavior (additive, not corrective within the same change)
- The existing item is already Done
- The finding's fix could ship independently without waiting for the existing item

→ Proceed to Phase 2. If a sequencing dependency exists, record it as a blocking relationship in Phase 3.

## §batch_mode - Sessions producing 3 or more items

When a grooming or analysis session yields multiple findings before any item is created:

1. **Collect all findings first** — do not enter Phase 1 for any individual finding until the full set is known.
2. **Run duplicate scan once across all findings** — compare the full set against the backlog in a single pass.
3. **Apply §finding_disposition and §amend_vs_create** to each finding; set aside amendments and non-actionable findings.
4. **Draft all remaining items** and present as a numbered manifest with type, title, and one-line rationale per item.
5. **Single Phase 3 block per item** — present all five fields for each item sequentially in one message block. Human may respond to all at once.
6. **Single Phase 4 confirmation** for the full manifest. Adjust and re-present if any field changes.
7. **Create in sequence** — create each item individually; apply confirmed fields and add audit comment before moving to the next.

Do not exceed the project's configured batch-confirmation threshold without explicit approval.

## §field_mutation - Confirming field changes on existing items

Before mutating any field on an existing item:
1. State current and proposed values and reason:
   > "I'd like to update [field] on #[ID] from [current] to [new] because [reason]. Confirm?"
2. For SP and priority: never suggest without reasoning (see `playbooks/story-points.md §estimation_guidance`).
3. Wait for explicit confirmation before writing.
4. After writing: add audit comment per `playbooks/audit-logging.md` if the change type is logged there.

Batch mutations: list all proposed changes in one confirmation block; wait for one "yes".
