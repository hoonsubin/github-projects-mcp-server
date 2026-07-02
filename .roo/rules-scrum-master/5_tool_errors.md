# Tool Error Recovery

Known failure modes discovered during live sessions. Update after each new discovery.
Layer tags: [Server] = fix in `src/`; [Schema] = fix in `src/schemas/`; [Agent] = fix here.

---

## scrum_update_story — `blocked_by` required on comment-only calls (RESOLVED)

Previously `blocked_by` was a required array on `UpdateStorySchema`, forcing every comment-only
call to pass `blocked_by: []`. Current schema has `blocked_by` as optional - omit it entirely on
calls that aren't changing dependencies. Left here so the old workaround isn't reintroduced by
habit; remove this entry once #265 is confirmed closed on the board.

---

## scrum_update_story — `blocked_by` rejects `{ number }` StoryRef

**Symptom:** `resolveStory requires a resolved StoryRef with 'id', but received '{ number: N }'`
**Cause:** `blocked_by` does not accept the human-readable `{ number }` form used elsewhere; it
requires the opaque platform id (`{ id: "PVTI_..." }`).
**Recovery:** Fetch the id via `scrum_get_item_detail(ref: { number: N })` → use `result.ref.id`.
If the item appeared in a prior tool response in this session, the PVTI_ id is often already in
context.
**Layer:** [Server] — Tool Insight #6, not yet created as a backlog item.

---

## scrum_create_story with `sprint: "current"` — item lands in Backlog status

**Symptom:** Item created with `sprint: "current"` but response shows `status: "Backlog"`.
**Cause:** Sprint placement does not auto-transition status.
**Recovery:** After `scrum_create_story`, explicitly call `scrum_set_field(field: "status", value:
<intended status display label>)` if a non-Backlog status is required.
**Layer:** [Server] — behavior to be confirmed as bug vs. intended.

---

## scrum_set_field — `FIELD_NOT_CONFIGURED` warning + null fields in response

**Symptom:** Write call returns a warning `FIELD_NOT_CONFIGURED` and `type: null`, `status: null`,
`sprint: null`, `priority: null` in the snapshot, even though `story_points` shows the new value.
**Cause:** `composeStoryAfterSetField` reads the post-write snapshot via a different resolution path
than `scrum_find_items` and fails to resolve org-issue-backed fields. The write itself succeeded.
The `story_points` value in the response is a client-side override applied regardless of read outcome.
**Recovery:** Do not treat null fields as write failure. Verify via
`scrum_get_item_detail(ref: { number: N })` — this uses the correct resolution path.
**Layer:** [Server] — tracked as #262.

---

## Ceremony/item-type templates are not a `scrum_*` tool call

**Symptom:** Looking for a tool to fetch an item-type or ceremony template and finding none in the
`scrum_*` surface.
**Cause:** Templates are exposed as MCP resources, not tools. `scrum_orient` returns a
`template_uris` map (which artifact types have a declared template); the template content itself
is fetched by resolving that URI through the standard MCP resource-access mechanism.
**Recovery:** Read `template_uris` from `scrum_orient`, then fetch the resource at the matching
URI directly - do not search for or invent a `scrum_get_template`-style tool.
**Layer:** [Agent] — this is how the surface is designed, not a bug.
