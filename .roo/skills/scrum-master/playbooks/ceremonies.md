# Ceremonies Playbook

> Ceremonies are secondary. Use this playbook only when explicitly requested by the human.

---

## Sprint Planning

**Tool sequence:**
1. `scrum_get_board_health` — board overview; `scrum_find_items` — load unrefined and ready items
2. Check each candidate against DoR from `scrum_orient`; flag every gap
3. `scrum_find_items(scope: "sprint")` — load current sprint capacity and active iteration context
4. **Sprint Goal capture** (before any item selection):
   - Ask: "What outcome does this sprint need to achieve? One sentence, user-visible result."
   - Record the agreed goal — it will be passed to `scrum_plan_sprint` as the `goal` argument.
   - Goal persistence: pass `goal` in the `scrum_plan_sprint` call. Note that the platform may
     not yet persist sprint goals server-side (check `platform_state.iterations.active.goal`
     after the call — if null, the server does not support goal storage). In that case, post
     the goal as a comment on the sprint's first story so it is visible on the board.
   - If the human declines to state a goal: document the absence in the ceremony record.
     Do not block planning, but flag it as a `no_sprint_goal` risk per `3_sm_stance.xml`.
5. `scrum_plan_sprint({ sprint: "current", stories: [...refs], goal: "<agreed goal>" })` — always
   pass `goal` even when the platform may not persist it; the return value will confirm whether it was stored.
6. Check `platform_state.template_uris` from `scrum_orient`; if `sprint_planning` is present,
   access MCP resource `scrum://template/sprint_planning`
7. Fill blanks with session data. Post to GitHub Discussions under `ceremony_records.discussion_category` from config:
   `gh discussion create --title "..." --body "..." --category "..."`

**SM moves:**
- *No Sprint Goal drafted:* Stop item selection. Ask for a one-sentence outcome-based goal first.
  Exception: platform does not support goal persistence (goal always null) — proceed but note it.
- *Candidate item below DoR:* Name the gap. Offer to defer to refinement or fix inline via `scrum_update_story`. Block sprint entry until resolved.
- *Selected SP exceeds capacity:* State numbers plainly. Ask which items to remove. Never allow over-commitment.
- *Batch write exceeds autonomy threshold:* Summarise planned assignments and wait for explicit approval before calling `scrum_plan_sprint`.

---

## Daily Standup

**Tool sequence:**
1. `scrum_find_items(scope: "sprint")` — load current items and statuses
2. Surface all items in a blocking status (`blocking: true` from orient vocabulary)
3. For each blocker with no logged impediment → `scrum_log_impediment`
4. Compute progress: (Done SP + In-Review SP) / committed SP
5. Flag carry-over risk if days remaining ≤ `config.sprint.carry_over_threshold_days`
6. Check `platform_state.template_uris` from `scrum_orient`; if `daily_standup` is present,
   access MCP resource `scrum://template/daily_standup`
7. Fill and post to GitHub Discussions

**Three questions:**
1. What did I complete that moved the Sprint Goal?
2. What will I do today?
3. What is blocking me?

**SM moves:**
- *Deep technical discussion starts:* Park it. "Take this offline — connect after standup."
- *Updates directed at SM rather than team:* Redirect: "Tell the Goal, not me."
- *Blocker raised but not logged:* `scrum_log_impediment` immediately.
- *In-progress item stale 3+ days:* Surface. Ask the owner what is actually happening.

---

## Backlog Refinement

**Tool sequence:**
1. `scrum_find_items` — load unrefined items (filter by status "Backlog" or "Ready" as needed)
2. Check each against DoR — missing AC, missing estimate, unclear scope
3. `scrum_update_story` — add AC or estimates where agreed
4. `scrum_add_vocabulary` — if new labels or field options are needed
5. `scrum_set_field` — adjust priority where confirmed by the human
6. Check `platform_state.template_uris` from `scrum_orient`; if `backlog_refinement` is present,
   access MCP resource `scrum://template/backlog_refinement`
7. Fill and post to GitHub Discussions

**SM moves:**
- *Item unchanged for 2 sprints:* Surface to the human. Candidate for pruning if no clear near-term intent.
- *Item too large for one sprint:* Coach through splitting. Reference `references/advanced-practices.md` §Story splitting. Do not estimate until it fits.
- *No AC on candidate:* Block from refinement completion. Offer to draft AC inline.

---

## Sprint Review

**Tool sequence:**
1. `scrum_find_items(scope: "sprint")` — load final sprint state
2. `scrum_get_analytics` — burndown and completion data
3. Separate items into Done vs. not-Done using `terminal: true` status key from orient vocabulary
4. Check `platform_state.template_uris` from `scrum_orient`; if `sprint_review` is present,
   access MCP resource `scrum://template/sprint_review`
5. Draft: Goal achieved?, Done items, carry-over items, stakeholder feedback, backlog changes
6. Fill and post to GitHub Discussions

**SM moves:**
- *Not-Done item about to be presented:* Stop. Apply DoD. Mark as carry-over. Only Done items are presented.
- *No stakeholders present:* Note the gap in the review record. Flag to the human.
- *Review generates no backlog changes:* Ask explicitly: "What should change in the backlog based on what you saw today?" A Review with no backlog output is a dysfunction.

---

## Retrospective

**Tool sequence:**
1. `scrum_get_analytics` — velocity trend across `velocity_window` from config
2. Surface the previous sprint's retro commitment and whether it was followed through
3. Check `platform_state.template_uris` from `scrum_orient`; if `retrospective` is present,
   access MCP resource `scrum://template/retrospective`
4. Draft: gathered observations, insights, exactly one committed improvement
5. Fill and post to GitHub Discussions

**SM moves:**
- *Multiple improvement actions proposed:* Reduce to one. "Pick the one you will actually do. The rest go in the backlog."
- *Previous commitment not followed through:* Start here before gathering new data. Name what happened and why.
- *Same improvement proposed for the second sprint in a row:* This is a pattern. Surface as a dysfunction signal per `3_sm_stance.xml`.
