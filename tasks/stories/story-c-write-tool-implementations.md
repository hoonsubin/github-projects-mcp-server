# Story C: Write Tool Implementations (Phase 3)

**Epic:** [Refactoring Plan](../REFACTORING.md)\
**Priority:** P2 — Core feature delivery\
**Dependencies:** Story B (backend abstraction layer) must be complete first

---

## Title: Implement All Six `scrum_*` Write Tools on Top of `ProjectBackend`

As a **Scrum Master or team agent**,\
I want to create, update, and manage stories through the `scrum_*` tool surface,\
So that I can perform all standard Scrum activities without touching GitHub-specific APIs directly.

---

## Acceptance Criteria

1. All 6 write tools are fully implemented in [`src/tools/scrum-write.ts`](../../src/tools/scrum-write.ts)
2. All tools use the `ProjectBackend` interface — no direct GitHub API calls
3. `scrum_add_vocabulary` is idempotent (returns `{ created: false }` if entry exists)
4. `scrum_set_field` returns updated `Story` after mutation
5. `scrum_create_story` handles partial failure gracefully
6. `scrum_plan_sprint` supports `replace` mode for bulk operations
7. `scrum_log_impediment` composes `createStory` + `addComment` correctly
8. Deprecated `github_graphql` tool is registered with mutation blocking
9. `deno check src/index.ts` passes clean
10. All existing tests pass

---

## Subtasks

### C1: Implement `scrum_add_vocabulary`

**Title:** Implement `scrum_add_vocabulary` write tool

As a **Scrum Master setting up the board**,\
I want to idempotently add vocabulary entries (status options, priority options, labels) to the platform,\
So that the board schema matches our Scrum terminology without errors on repeated calls.

**Acceptance Criteria:**

1. `kind: "status_option"` → call `updateProjectV2SingleSelectField` mutation using `statusFieldId` from config
2. `kind: "priority_option"` → same pattern using `priorityFieldId`
3. `kind: "label"` → call `createLabel` mutation on repo; auto-assign color by hashing label name
4. Returns `{ created: false }` if entry already exists (idempotent)
5. Returns structured error if `statusFieldId` or `priorityFieldId` is null (field doesn't exist)
6. Return shape: `{ created: boolean, kind, value }`

**Implementation Notes:**

- This is the simplest write tool — implement first
- No resolver needed — operates on field configuration, not stories
- Color palette for labels: fixed array of hex colors, hash label name to pick color

**Files:**

- `src/tools/scrum-write.ts` — implement handler
- `src/adapters/github/backend.ts` — implement `addVocabulary` method

---

### C2: Implement `scrum_set_field`

**Title:** Implement `scrum_set_field` write tool

As a **developer or agent managing stories**,\
I want a single entry point for all board-field mutations,\
So that setting status, sprint, points, priority, or assignee is consistent and reliable.

**Acceptance Criteria:**

1. `status`: resolve name → option ID via `statusOptions`; call `updateProjectV2ItemFieldValue`
2. `sprint`: call `resolveSprint` → iteration ID or null; set or clear iteration field
3. `story_points`: set or clear number field
4. `priority`: resolve name → option ID; set or clear singleSelectOptionId
5. `assignee`: use `updateIssue` mutation (not a project field); resolve login → user node ID; `null` → empty array to clear
6. Return structured error if vocabulary value not found (hint: `scrum_add_vocabulary`)
7. After mutation: fetch current field state and return updated `Story`

**Field Mapping Table:**

| `field`        | `value`                         | Operation                                                              |
| -------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `status`       | vocabulary display name         | Resolve name → option ID; call `updateProjectV2ItemFieldValue`         |
| `sprint`       | `SprintRef`                     | Call `resolveSprint` → iteration ID or null; set/clear                 |
| `story_points` | number or null                  | Set or clear number field                                              |
| `priority`     | vocabulary display name or null | Resolve name → option ID; set or clear                                 |
| `assignee`     | GitHub login or null            | Resolve login → user node ID; call `updateIssue`; `null` → empty array |

**Files:**

- `src/tools/scrum-write.ts` — implement handler
- `src/adapters/github/backend.ts` — implement `setField` method

---

### C3: Implement `scrum_update_story`

**Title:** Implement `scrum_update_story` write tool

As a **team member editing a story**,\
I want to update story content (title, body, labels, assignees, epic) through a single tool,\
So that I don't need to know GitHub-specific mutation syntax.

**Acceptance Criteria:**

1. Call `resolveStory` to get `itemId` and `issueId`
2. Call `updateIssue` mutation for any of: `title`, `body`, `assignees`, `labels`
3. `assignees`: resolve logins → node IDs via `GetUserNodeId` lookup
4. `labels`: resolve label names → node IDs via repo labels query
5. `epic`: resolve Milestone title → milestone node ID; call `updateIssue` with `milestoneId`
6. `epic: null` → detach (set `milestoneId: null`)
7. Create Milestone if title is provided but not found
8. Return the updated `Story` (re-fetch fields after mutation)

**Files:**

- `src/tools/scrum-write.ts` — implement handler
- `src/adapters/github/backend.ts` — implement `updateStory` method

---

### C4: Implement `scrum_create_story`

**Title:** Implement `scrum_create_story` write tool

As a **team member adding work**,\
I want to create a story and optionally place it on the board in one call,\
So that I can quickly add tasks without multiple round-trips.

**Acceptance Criteria:**

1. Resolve type label → label node ID; create label if not found (reuse `scrum_add_vocabulary` label logic internally)
2. Call `createIssue` mutation with `title`, `body`, `labelIds`, `assigneeIds`
3. Call `addProjectV2ItemById` to add to project board
4. For each optional field (`priority`, `story_points`, `sprint`): call `backend.setField(ref, field, value)` — do **not** call the registered `scrum_set_field` tool to avoid double resolver overhead
5. Partial failure: if issue creation succeeds but field-set fails, return structured error with partial `StoryRef`
6. Return the newly created `Story`

**Partial Failure Handling:**

- If issue creation succeeds but a subsequent field-set fails, return:
  ```json
  {
    "error": "Field set failed after story creation",
    "story": { "number": 42, "id": "GHI_..." },
    "failed_field": "sprint"
  }
  ```
- Agent can retry the failing field-sets without duplicating the story

**Files:**

- `src/tools/scrum-write.ts` — implement handler
- `src/adapters/github/backend.ts` — implement `createStory` method

---

### C5: Implement `scrum_plan_sprint`

**Title:** Implement `scrum_plan_sprint` write tool

As a **Scrum Master planning a sprint**,\
I want to bulk-assign stories to a sprint with optional replace mode,\
So that I can quickly set up sprint boards and clear previous assignments.

**Acceptance Criteria:**

1. If `replace: true`: fetch all items currently in target sprint, clear sprint assignment on each
2. Collect failures without aborting on replace
3. For each `StoryRef` in `stories`: call `resolveStory`, then apply sprint field-set logic
4. Collect `assigned: StoryRef[]` (succeeded) and `skipped: Array<{ ref, reason }>` (failed)
5. Return partial-success report: `{ sprint, assigned, skipped }`

**Return Shape:**

```json
{
  "sprint": "Sprint 12",
  "assigned": [{ "number": 42, "id": "GHI_..." }],
  "skipped": [{ "ref": { "number": 43 }, "reason": "Story not found" }]
}
```

**Files:**

- `src/tools/scrum-write.ts` — implement handler
- `src/adapters/github/backend.ts` — implement `setField` (for sprint clearing)

---

### C6: Implement `scrum_log_impediment`

**Title:** Implement `scrum_log_impediment` write tool

As a **team member blocking on an issue**,\
I want to log an impediment that auto-creates a spike story and cross-links it to the affected story,\
So that blockers are visible and traceable without manual setup.

**Acceptance Criteria:**

1. Call `backend.createStory(...)` with:
   - `type: "spike"` (there is no `"impediment"` StoryType)
   - `labels: ["impediment"]` (create label if missing via `backend.addVocabulary` label path)
   - `status: "Blocked"` (from vocabulary)
   - `priority`: the `priority` parameter from the tool input (a vocabulary display name such as `"high"`), falling back to the highest-priority tier declared in `config.yml` when not provided
2. Call `backend.addComment(affectedRef, "Impediment #N opened against this story.")`
3. Call `backend.addComment(impedimentRef, "This impediment affects story #M.")`
4. Return: `{ impediment: Story, linked_to: StoryRef }`

> **Parameter note:** The tool accepts a `priority` input (a vocabulary display name, e.g. `"high"`).
> If omitted, the use case reads the first entry in `yml.priority` (the highest configured tier) as
> the default. There is no `raised_by` parameter — who logged the impediment is captured in the
> story body, not as a priority signal.

**Implementation Notes:**

- This tool composes earlier primitives — implement last
- `backend.addComment` is the correct call site; it is a method on `ProjectBackend`, not an agent-callable tool
- The impediment story is created with `type: "spike"` and `labels: ["impediment"]`

**Files:**

- `src/tools/scrum-write.ts` — implement handler
- `src/adapters/github/backend.ts` — implement `addComment` method

---

### C7: Register Deprecated `github_graphql` Tool

**Title:** Register deprecated `github_graphql` tool with mutation blocking

As a **developer needing diagnostics**,\
I want the `github_graphql` tool available for ad-hoc GraphQL lookups but with mutations blocked,\
So that I can debug issues without risking accidental mutations through the deprecated tool.

**Acceptance Criteria:**

1. Schema: `GraphQLQuerySchema` from `src/schemas/inputs.ts`
2. Block any query string containing the word "mutation" (case-insensitive) — return error
3. Forward queries to GitHub GraphQL API and return raw response
4. Tool description includes deprecation notice:
   > **DEPRECATED.** Preserved for ad-hoc diagnostic GraphQL lookups only. Will be removed in a future version. Prefer the `scrum_*` tools for all agent workflows. Mutations are blocked.

**Files:**

- `src/tools/scrum-write.ts` — register tool

---

## Verification Checklist

- [ ] C1: `scrum_add_vocabulary` implemented; at least one unit test with a stubbed `ProjectBackend`
- [ ] C2: `scrum_set_field` implemented; at least one unit test per field type (status, sprint, story_points, priority, assignee)
- [ ] C3: `scrum_update_story` implemented; at least one unit test covering title/body update and epic detach
- [ ] C4: `scrum_create_story` implemented; at least one unit test covering partial-failure path
- [ ] C5: `scrum_plan_sprint` implemented; at least one unit test covering `replace: true` and a skipped story
- [ ] C6: `scrum_log_impediment` implemented; at least one unit test verifying both `backend.addComment` calls are made
- [ ] C7: `github_graphql` registered with deprecation marker; mutation-blocking verified with a test query containing "mutation"
- [ ] `deno check src/index.ts` passes clean
- [ ] All existing tests pass
- [ ] All tools use `ProjectBackend` interface (no direct GitHub API calls in handlers or use cases)
