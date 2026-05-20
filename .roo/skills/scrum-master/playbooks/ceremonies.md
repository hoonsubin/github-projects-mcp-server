# Ceremonies Playbook

> Ceremonies are secondary. Use this playbook only when explicitly requested by the human.

---

## Sprint Planning

**Tool sequence:**
1. `scrum_get_backlog` — load unrefined and ready items
2. Check each candidate against DoR from `scrum_orient`; flag every gap
3. `scrum_get_sprint` — load current sprint capacity and active iteration context
4. Confirm Sprint Goal with the human — no item selection proceeds without an agreed goal
5. `scrum_plan_sprint` — with selected story IDs and the agreed goal
6. `scrum_get_template` for the `sprint_planning` artifact
7. Fill blanks with session data. Post to GitHub Discussions under `ceremony_records.discussion_category` from config:
   `gh discussion create --title "..." --body "..." --category "..."`

**SM moves:**
- *No Sprint Goal drafted:* Stop item selection. Ask for a one-sentence outcome-based goal first.
- *Candidate item below DoR:* Name the gap. Offer to defer to refinement or fix inline via `scrum_update_story`. Block sprint entry until resolved.
- *Selected SP exceeds capacity:* State numbers plainly. Ask which items to remove. Never allow over-commitment.
- *Batch write exceeds autonomy threshold:* Summarise planned assignments and wait for explicit approval before calling `scrum_plan_sprint`.

---

## Daily Standup

**Tool sequence:**
1. `scrum_get_sprint` — load current items and statuses
2. Surface all items in a blocking status (`blocking: true` from orient vocabulary)
3. For each blocker with no logged impediment → `scrum_log_impediment`
4. Compute progress: (Done SP + In-Review SP) / committed SP
5. Flag carry-over risk if days remaining ≤ `config.sprint.carry_over_threshold_days`
6. `scrum_get_template` for the `daily_standup` artifact
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
1. `scrum_get_backlog` — load unrefined items
2. Check each against DoR — missing AC, missing estimate, unclear scope
3. `scrum_update_story` — add AC or estimates where agreed
4. `scrum_add_vocabulary` — if new labels or field options are needed
5. `scrum_set_field` — adjust priority where confirmed by the human
6. `scrum_get_template` for the `backlog_refinement` artifact
7. Fill and post to GitHub Discussions

**SM moves:**
- *Item unchanged for 2 sprints:* Surface to the human. Candidate for pruning if no clear near-term intent.
- *Item too large for one sprint:* Coach through splitting. Reference `references/advanced-practices.md` §Story splitting. Do not estimate until it fits.
- *No AC on candidate:* Block from refinement completion. Offer to draft AC inline.

---

## Sprint Review

**Tool sequence:**
1. `scrum_get_sprint` — load final sprint state
2. `scrum_get_burndown` — completion data
3. Separate items into Done vs. not-Done using `terminal: true` status key from orient vocabulary
4. `scrum_get_template` for the `sprint_review` artifact
5. Draft: Goal achieved?, Done items, carry-over items, stakeholder feedback, backlog changes
6. Fill and post to GitHub Discussions

**SM moves:**
- *Not-Done item about to be presented:* Stop. Apply DoD. Mark as carry-over. Only Done items are presented.
- *No stakeholders present:* Note the gap in the review record. Flag to the human.
- *Review generates no backlog changes:* Ask explicitly: "What should change in the backlog based on what you saw today?" A Review with no backlog output is a dysfunction.

---

## Retrospective

**Tool sequence:**
1. `scrum_get_history` — velocity trend across `velocity_window` from config
2. Surface the previous sprint's retro commitment and whether it was followed through
3. `scrum_get_template` for the `retrospective` artifact
4. Draft: gathered observations, insights, exactly one committed improvement
5. Fill and post to GitHub Discussions

**SM moves:**
- *Multiple improvement actions proposed:* Reduce to one. "Pick the one you will actually do. The rest go in the backlog."
- *Previous commitment not followed through:* Start here before gathering new data. Name what happened and why.
- *Same improvement proposed for the second sprint in a row:* This is a pattern. Surface as a dysfunction signal per `3_sm_stance.xml`.
