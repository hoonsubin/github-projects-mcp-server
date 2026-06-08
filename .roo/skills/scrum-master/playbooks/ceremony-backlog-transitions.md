# Ceremony → Backlog Transitions

> **Deprecation notice:** `scrum_get_analytics` and `scrum_get_board_health` will be deprecated — prefer `scrum_get_sprint_data`.

The agent's role in ceremonies is to process the backlog changes they produce - not to facilitate
the ceremonies themselves. For full ceremony facilitation, redirect to `references/sm-coaching.md`
or `references/templates-ceremonies.md`.

## Sprint Planning

**Pre-planning** - prepare the backlog before Planning opens.
N = sprint capacity in items (velocity / avg-SP-per-item; minimum 1.5× velocity in SP).
If >30% of top-N fail DoR: flag as refinement debt before committing to a planning session.

Tool sequence:
1. `scrum_find_items(scope: "sprint")` - identify carry-over items (highest-priority candidates)
2. `scrum_find_items(scope: "backlog")` - load top-N candidates
3. Check each against `vocabulary.dor` from `scrum_orient` - missing AC, no estimate, unclear scope
4. Surface gap list; offer `scrum_update_story` per gap on confirmation

**Post-planning** - apply sprint selection.
- `scrum_plan_sprint({ sprint: "current", stories: [...refs] })`
- Sprint goal: pass as `goal` arg. If `platform_state.iterations.active.goal` returns null after
  the call: post goal as comment on the sprint's first active story.
- Check `platform_state.template_uris`; if `sprint_planning` present, access `scrum://template/sprint_planning`.

## Sprint Review

**Post-review** - apply review output to the backlog.

Done items: no board action required.

Not-done (carry-over): `scrum_update_story` with comment noting carry-over reason and source sprint.
Status unchanged; they become highest-priority backlog candidates.

New items from demo or stakeholder feedback: `scrum_create_story` → backlog (not current sprint).
Confirm scope with human before creating.

Dysfunction signal: zero backlog changes from a review → the team is not inspecting and adapting.
Ask: "What should change in the backlog based on what you saw today?" Do not close without at least
one confirmed backlog action.

Tool sequence:
1. `scrum_find_items(scope: "sprint")` - load final sprint state
2. `scrum_get_sprint_data(sprint_ref: "current")` - completion summary
3. Separate Done vs not-done using terminal status keys from `vocabulary.status`
4. Apply carry-over comments; create new items
5. Check `platform_state.template_uris` for `sprint_review` template

## Retrospective

Every retro produces exactly one committed improvement → backlog item.
- `scrum_create_story` with `type: "tech_debt"` (internal) or `type: "user_story"` (user-visible)
- Priority: highest available tier (from `vocabulary.priority`)
- If same improvement unmet from prior sprint: note prior sprint in body; flag as recurring pattern

Tool sequence:
1. `scrum_get_sprint_data(sprint_ref: "current")` — current sprint completion data
2. For velocity context: call `scrum_get_sprint_data` once per sprint name in `iterations.completed` (up to `vocabulary.sprint.velocity_window` sprints), sum `storyPoints` where `completedAt != null` per sprint
3. `scrum_create_story` for the committed improvement
4. Check `platform_state.template_uris` for `retrospective` template

Recurring pattern (same improvement unmet 2+ sprints): surface to human with sprint data.
Recommend Five Whys session - `references/sm-coaching.md §Retrospective formats`.

## Backlog Refinement

Goal: top-N items (N ≥ 1.5× velocity in SP) are DoR-complete before next planning session.

Tool sequence:
1. `scrum_find_items(scope: "backlog")`
2. Check each against `vocabulary.dor` - missing AC, no estimate, unclear scope
3. `scrum_update_story` - add AC or estimates agreed with human
4. `scrum_set_field` - adjust priority on confirmation
5. `scrum_add_vocabulary` - if new labels or field options needed
6. Check `platform_state.template_uris` for `refinement` template

Staleness: no field update in 2 sprints → surface; candidate for icebox or close.
Size: estimate >40% of velocity → split before marking sprint-ready.
No AC: block from sprint-ready until AC is defined.

## Daily Standup

Agent involvement is limited to:
- Data queries: `scrum_find_items(scope: "sprint")` to surface blocked or stale items
- Logging newly raised impediments: `scrum_log_impediment` → see `impediment-lifecycle.md`

No board writes during standup unless logging an impediment. No ceremony facilitation.
