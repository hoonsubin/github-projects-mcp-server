# Ceremony → Backlog Transitions

The agent's role in ceremonies is to process the backlog changes they produce - not to facilitate
the ceremonies themselves. For full ceremony facilitation, redirect to `references/sm-coaching.md`
or `references/templates-ceremonies.md`.

## Sprint Planning

**Pre-planning** - prepare the backlog before Planning opens.
N = sprint capacity in items (velocity / avg-SP-per-item; minimum 1.5× velocity in SP).
If >30% of top-N fail DoR: flag as refinement debt before committing to a planning session.

Sequence:
1. Identify carry-over items from the current sprint (highest-priority candidates).
2. Load the top-N backlog candidates.
3. Check each against the project's DoR criteria - missing AC, no estimate, unclear scope.
4. Surface the gap list; offer to fill each gap on confirmation.

**Post-planning** - apply sprint selection.
- Commit the selected stories to the sprint.
- Sprint Goal: attach it to the sprint commitment. If the sprint still shows no goal recorded
  afterward, post it as a comment on the sprint's first active story instead.
- If a sprint-planning template is available for this project, use it.

## Sprint Review

**Post-review** - apply review output to the backlog.

Done items: no board action required.

Not-done (carry-over): comment noting carry-over reason and source sprint. Status unchanged; they
become highest-priority backlog candidates.

New items from demo or stakeholder feedback: create in the backlog, not the current sprint. Confirm
scope with human before creating.

Dysfunction signal: zero backlog changes from a review → the team is not inspecting and adapting.
Ask: "What should change in the backlog based on what you saw today?" Do not close without at least
one confirmed backlog action.

Sequence:
1. Load final sprint state.
2. Gather the sprint's completion summary.
3. Separate Done vs. not-done using the project's terminal status.
4. Apply carry-over comments; create new items.
5. If a sprint-review template is available for this project, use it.

## Retrospective

Every retro produces exactly one committed improvement → backlog item.
- Type: internal improvement (tech debt) or user-visible (user story), whichever fits.
- Priority: highest available tier.
- If same improvement unmet from prior sprint: note prior sprint in body; flag as recurring pattern.

Sequence:
1. Gather the current sprint's completion data.
2. For velocity context: gather completion data across the project's configured velocity lookback
   window of recent sprints, summing points for items actually completed in each.
3. Create the committed improvement as a backlog item.
4. If a retrospective template is available for this project, use it.

Recurring pattern (same improvement unmet 2+ sprints): surface to human with sprint data.
Recommend Five Whys session - `references/sm-coaching.md §Retrospective formats`.

## Backlog Refinement

Goal: top-N items (N ≥ 1.5× velocity in SP) are DoR-complete before next planning session.

Sequence:
1. Load the backlog.
2. Check each against the project's DoR criteria - missing AC, no estimate, unclear scope.
3. Add AC or estimates agreed with the human.
4. Adjust priority on confirmation.
5. Define new labels or field options if needed.
6. If a refinement template is available for this project, use it.

Staleness: no update in 60+ days, not in the active sprint, no open dependencies → surface;
candidate for icebox or close. (Same threshold used for backlog health scans generally - see
`SKILL.md`.)
Size: estimate >40% of velocity → split before marking sprint-ready.
No AC: block from sprint-ready until AC is defined.

## Daily Standup

Agent involvement is limited to:
- Surfacing blocked or stale sprint items.
- Logging newly raised impediments → see `impediment-lifecycle.md`.

No board writes during standup unless logging an impediment. No ceremony facilitation.
