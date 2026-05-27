# Ceremony → Backlog Transitions

> The agent's role in ceremonies is to process the backlog changes they produce, not to
> facilitate the ceremonies themselves. Load this playbook when the human completes a ceremony
> and asks to update the board, or when pre-ceremony backlog preparation is requested.
>
> For full ceremony facilitation (coaching moves, formats, timebox rules), decline and redirect
> the human to the appropriate reference in `references/sm-coaching.md` or `references/templates-ceremonies.md`.

---

## Sprint Planning

### Pre-planning (agent's job — prepare the backlog)

Goal: ensure top-N candidates are DoR-complete before Planning opens.
N = sprint capacity in items (estimate: velocity / avg-SP-per-item, minimum 1.5× velocity in SP).

If more than 30% of top-N fail DoR: flag as refinement debt before committing to a planning session.
Offer inline fix via `scrum_update_story` for each gap.

**Tool sequence:**
1. `scrum_find_items(scope: "sprint")` — identify carry-over items from previous sprint (highest-priority candidates)
2. `scrum_find_items(scope: "backlog")` — load top-N candidates
3. Check each candidate against `vocabulary.dor` from `scrum_orient` — missing AC, no estimate, unclear scope
4. Surface gap list; offer `scrum_update_story` to fix each gap inline on confirmation

### Post-planning (apply the sprint selection to the board)

- Selected items → `scrum_plan_sprint({ sprint: "current", stories: [...refs] })`
- Sprint goal: pass as `goal` arg to `scrum_plan_sprint` if the human has stated one.
  If `platform_state.iterations.active.goal` returns null after the call (platform does not persist goals):
  post the goal as a comment on the sprint's first active story.
- Check `platform_state.template_uris` from `scrum_orient`; if `sprint_planning` is present,
  access MCP resource `scrum://template/sprint_planning` for the ceremony record.

---

## Sprint Review

### Post-review (apply the review's output to the backlog)

**Done items:** no board action required — status is already terminal.

**Not-done items (carry-over):**
- `scrum_update_story` with a comment noting carry-over reason and source sprint
- Status remains unchanged; they become the highest-priority backlog candidates

**New items discovered during demo:**
- `scrum_create_story` → add to backlog (not current sprint)
- Apply `type`, `priority`, and initial AC if provided during review

**Stakeholder feedback generating new items:**
- `scrum_create_story` for each confirmed new item; confirm scope with the human before creating

**Dysfunction signal:** A review that generates zero backlog changes indicates the team is not
inspecting and adapting. Ask: "What should change in the backlog based on what you saw today?"
Do not close the review without at least one confirmed backlog action.

**Tool sequence:**
1. `scrum_find_items(scope: "sprint")` — load final sprint state
2. `scrum_get_analytics(view: "burndown", sprint_ref: "current")` — completion summary for the record
3. Separate Done vs not-done using terminal status keys from `vocabulary.status` in `scrum_orient`
4. Apply carry-over comments and create new items
5. Check `platform_state.template_uris`; if `sprint_review` is present, access `scrum://template/sprint_review`

---

## Retrospective

### Post-retro (apply the committed improvement to the backlog)

Every retrospective produces exactly one committed improvement. That improvement becomes a backlog item.

- `scrum_create_story` with `type: "tech_debt"` (internal process improvement) or `type: "user_story"` (user-visible)
- Priority: highest available tier (resolve from `vocabulary.priority`)
- If the same improvement was unmet from the prior sprint: note the prior sprint in the body; flag to the human as a recurring pattern

**Tool sequence:**
1. `scrum_get_analytics(view: "history", history_window: vocabulary.sprint.velocity_window)` — velocity context for the retro
2. `scrum_create_story` for the committed improvement
3. Check `platform_state.template_uris`; if `retrospective` is present, access `scrum://template/retrospective`

**Recurring pattern signal:** same improvement committed and unmet across 2+ sprints →
surface to human with sprint data. Recommend a Five Whys session (reference `references/sm-coaching.md §3`).

---

## Backlog Refinement

> Refinement is a primary backlog management task. The agent's involvement here is full, not secondary.

**Goal:** make the top of the backlog sprint-ready. Target: top-N items (N ≥ 1.5× velocity in SP)
are DoR-complete before the next planning session.

**Tool sequence:**
1. `scrum_find_items(scope: "backlog")` — load items in unrefined state
2. Check each against `vocabulary.dor` from `scrum_orient` — missing AC, no estimate, unclear scope
3. `scrum_update_story` — add AC or estimates where agreed with the human
4. `scrum_set_field` — adjust priority where confirmed
5. `scrum_add_vocabulary` — if new labels or field options are needed
6. Check `platform_state.template_uris`; if `refinement` is present, access `scrum://template/refinement`

**Staleness:** Item with no field updates for 2 sprints → surface to human; candidate for icebox or close.
**Size:** Item estimated at >40% of velocity → split before marking sprint-ready. Do not estimate Epic-sized items.
**No AC:** Block from sprint-ready status until AC is defined. Offer to draft AC inline.
**Priority stack:** Top-N items should all be DoR-complete before committing to a planning session.

---

## Daily Standup

The agent has no backlog management output from the daily standup. The only valid involvement is:

- Answering data queries: `scrum_find_items(scope: "sprint")` to surface blocked or stale items
- Logging newly raised impediments: `scrum_log_impediment` → see `playbooks/impediment-lifecycle.md`

No board writes during standup unless an impediment is being logged.
No ceremony facilitation. Surface data; let the team own the discussion.
