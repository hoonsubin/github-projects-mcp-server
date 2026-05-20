# Implementation Strategy: Phase 5 — Dependencies: GitHub Adapter

**Tickets:** [#82](https://github.com/hoonsubin/github-projects-mcp-server/issues/82), [#81](https://github.com/hoonsubin/github-projects-mcp-server/issues/81), [#98](https://github.com/hoonsubin/github-projects-mcp-server/issues/98), [#104](https://github.com/hoonsubin/github-projects-mcp-server/issues/104) **Branch:** `feature/epics-type` **Prerequisite:** Phase 4 complete — `blocked_by` and `blocks` are required fields on `Story`; `has_dependencies` is required on `StoryListing`; `UpdateStorySchema` and `StoryUpdates` expose both write fields. **Goal:** Parse and write the `## Dependencies` body section throughout the GitHub adapter. Populate `blocked_by`, `blocks`, and `has_dependencies` in every story-building path. Resolve all Phase 4 TypeScript compile errors. Build must be green at the end of this phase.

---

## Acceptance Criteria

All criteria must pass before this phase is considered complete.

1. `scrum_get_story` returns `blocked_by: DependencyEntry[]` and `blocks: DependencyEntry[]` for stories that have a `## Dependencies` section.
2. `scrum_get_story` returns `blocked_by: []` and `blocks: []` for stories without a `## Dependencies` section.
3. `scrum_get_sprint` returns `has_dependencies: true` for items with a non-empty `## Dependencies` section; `false` otherwise.
4. `scrum_get_backlog` returns `has_dependencies: true` for items with a non-empty `## Dependencies` section; `false` otherwise.
5. In backlog and sprint contexts, `DependencyEntry.ref.id` is resolved from in-memory project items (no extra network calls).
6. In `scrum_get_story` context, `DependencyEntry.ref.id` is `null` — resolution is deferred to a future phase.
7. Draft Issues always return `blocked_by: []` and `blocks: []`.
8. `scrum_update_story` with `blocked_by: [{ id: "..." }]` rewrites only the `Blocked by:` lines; existing `Blocks:` lines are preserved untouched.
9. `scrum_update_story` with `blocks: [{ id: "..." }]` rewrites only the `Blocks:` lines; existing `Blocked by:` lines are preserved untouched.
10. `scrum_update_story` with `blocked_by: null` clears upstream dependency lines while preserving downstream lines.
11. `scrum_update_story` with `blocked_by: null, blocks: null` removes the entire `## Dependencies` section from the body without corrupting surrounding content.
12. `scrum_update_story` with both `blocked_by` and `blocks` as arrays rewrites both directions atomically.
13. `deno lint` passes with no warnings.
14. `deno test` passes — all 55 existing tests.
15. `deno check` produces zero TypeScript errors across all adapter and use-case files.

---

## Dependency Body Convention

The GitHub adapter uses a markdown section as the dependency store. This is the canonical format:

```markdown
## Dependencies

- Blocked by: #17
- Blocked by: #42
- Blocks: #55
```

**Parsing rules:**

- Lines matching `- Blocked by: #N` (case-insensitive) → `blocked_by` entries where `key = "N"`.
- Lines matching `- Blocks: #N` (case-insensitive) → `blocks` entries where `key = "N"`.
- Any other line in the section is ignored.
- Absent section → both arrays are `[]`.

**Write rules (atomic per-direction replacement):**

- `undefined` for a direction → preserve all existing lines for that direction unchanged.
- `null` for a direction → clear all lines for that direction.
- `StoryRef[]` for a direction → resolve each `StoryRef` to an issue number and replace all lines for that direction.
- Both directions `null` → remove the entire `## Dependencies` section including the heading.

---

## Field Mapping: `DependencyEntry`

| Source (body parse)         | `DependencyEntry` field | Notes                                                                             |
| --------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| matched issue number string | `key`                   | Always present; e.g. `"17"`                                                       |
| _(not resolved)_            | `ref.id`                | `null` for `getStoryDetail`; filled from in-memory context for backlog and sprint |
| _(not resolved)_            | `title`                 | Always `null` in Phase 5                                                          |

---

## Execution Order

Apply and verify steps in sequence. Steps marked **[done]** have been implemented — verify the current file matches the expected state before proceeding. Steps marked **[todo]** require implementation. Do not run the final verification until all steps are confirmed.

---

## Step 1 — `src/adapters/github/mappers.ts`: `parseDependencies` helper [done]

A module-private (not exported) function parses the `## Dependencies` section from a story body. Verify the following implementation exists at the top of the mapper module, after imports:

```typescript
const parseDependencies = (
  body: string,
): { blocked_by: DependencyEntry[]; blocks: DependencyEntry[] } => {
  const sectionMatch = body.match(/^##\s+dependencies\b.*$([\s\S]*?)(?=^##\s|\z)/im);
  if (!sectionMatch) return { blocked_by: [], blocks: [] };

  const section = sectionMatch[1];
  const blocked_by: DependencyEntry[] = [];
  const blocks: DependencyEntry[] = [];

  for (const line of section.split("\n")) {
    const blockedMatch = line.match(/^-\s+blocked\s+by:\s+#(\d+)\s*$/i);
    if (blockedMatch) {
      blocked_by.push({ key: blockedMatch[1], title: null, ref: { id: null } });
      continue;
    }
    const blocksMatch = line.match(/^-\s+blocks:\s+#(\d+)\s*$/i);
    if (blocksMatch) {
      blocks.push({ key: blocksMatch[1], title: null, ref: { id: null } });
    }
  }

  return { blocked_by, blocks };
};
```

`DependencyEntry` must be imported from `../../domain/types.ts`.

---

## Step 2 — `src/adapters/github/mappers.ts`: `buildStoryFromRaw` [done]

Both branches of `buildStoryFromRaw` must populate `blocked_by` and `blocks`.

**DraftIssue branch** — both fields are always empty arrays (Draft Issues have no tracked dependencies):

```typescript
blocked_by: [],
blocks: [],
```

**Issue / PullRequest branch** — call `parseDependencies` and spread the result:

```typescript
const deps = parseDependencies(content.body);
// ... other fields ...
blocked_by: deps.blocked_by,
blocks: deps.blocks,
```

`content.body` is a non-null `string` in this branch (the `ProjectItemIssueContent` type requires it). Pass it directly — no `?? ""` needed.

---

## Step 3 — `src/adapters/github/mappers.ts`: `buildEnrichedStory` [done]

Call `parseDependencies` on the issue body and spread the result. The body may be `null | undefined` from the details query response, so use `?? ""`:

```typescript
const deps = parseDependencies(issueNode.body ?? "");
// ... other fields ...
blocked_by: deps.blocked_by,
blocks: deps.blocks,
```

---

## Step 4 — `src/adapters/github/mappers.ts`: `resolveDependencyRefs` export [done]

An exported pure function does a second pass over an already-built `Story[]` to fill in `ref.id` for dependency entries by matching issue numbers against the in-memory project item list. Verify this implementation exists and is exported:

```typescript
export const resolveDependencyRefs = (
  stories: Story[],
  allItems: ProjectItem[],
): Story[] => {
  const keyToId = new Map<string, string>();
  for (const item of allItems) {
    const content = item.content;
    if (!content || content.__typename === "DraftIssue") continue;
    const issueKey = String(content.number);
    if (issueKey && item.id) keyToId.set(issueKey, item.id);
  }

  const resolve = (entries: DependencyEntry[]): DependencyEntry[] =>
    entries.map((e) =>
      e.ref.id === null && keyToId.has(e.key) ? { ...e, ref: { id: keyToId.get(e.key)! } } : e
    );

  return stories.map((s) => ({
    ...s,
    blocked_by: resolve(s.blocked_by),
    blocks: resolve(s.blocks),
  }));
};
```

This function is O(n) with no network calls. It only fills in `ref.id` for entries that were `null` — entries already resolved are left unchanged.

---

## Step 5 — `src/adapters/github/internal/story-query-service.ts`: Call `resolveDependencyRefs` [done]

`resolveDependencyRefs` must be called at the end of both collection paths.

**`getSprintStories`** — after building `Story[]` from `sprintItems`, wrap with the resolver:

```typescript
const stories = resolveDependencyRefs(
  sprintItems
    .map((item) => buildStoryFromRaw(item, this.config))
    .filter((s): s is Story => s !== null),
  allItems, // full item list already in memory from fetchAllItems()
);
```

**`getBacklogStories`** — after building `Story[]` from `backlogItems`, wrap with the resolver:

```typescript
return resolveDependencyRefs(
  backlogItems
    .map((item) => buildStoryFromRaw(item, this.config))
    .filter((s): s is Story => s !== null),
  backlogItems,
);
```

Do **not** call `resolveDependencyRefs` in `getStoryDetail` — `ref.id` stays `null` in that context.

---

## Step 6 — `src/adapters/github/internal/story-mutation-service.ts`: Write support [done]

`updateStory` must rewrite the `## Dependencies` section when `blocked_by` or `blocks` is provided in `StoryUpdates`. Verify the following implementation exists in the service.

**`rewriteDependencySection`** — a module-private (not exported) function that applies the write rules:

```typescript
const rewriteDependencySection = (
  currentBody: string,
  blockedBy: StoryRef[] | null | undefined,
  blocks: StoryRef[] | null | undefined,
  resolveIssueNumber: (ref: StoryRef) => string,
): string => { ... }
```

Rules (for each direction):

- `undefined` → preserve existing lines
- `null` → clear all lines
- `StoryRef[]` → replace lines using `resolveIssueNumber(ref)` for each entry

If both directions end up empty after applying rules, remove the entire section (heading and content). Otherwise upsert the section — replace if present, append if absent.

**`_buildDependencyBody` (private method)** — fetches the current body if not already known (when `updates.body` is absent), then resolves all `StoryRef` arrays in one parallel pass before calling `rewriteDependencySection`:

```typescript
private async _buildDependencyBody(
  updates: StoryUpdates,
  issueId: string,
): Promise<string> { ... }
```

**`_resolveRefToIssueNumber` (private method)** — resolves a `StoryRef` to an issue number string via `resolveStory`. Throws a `GitHubApiError` with `code: "RESOLUTION_FAILED"` if the ref points to a Draft Issue (Draft Issues have no issue number and cannot be referenced in dependency lists).

**`_fetchCurrentBody` (private method)** — fetches the current body for an issue by its node ID using an inline `GetIssueBody` query.

**`updateStory` integration** — early in `updateStory`, before building the mutation fields array:

```typescript
if (updates.blocked_by !== undefined || updates.blocks !== undefined) {
  const updatedBody = await this._buildDependencyBody(updates, issueId);
  updates = { ...updates, body: updatedBody };
}
```

This ensures the dependency section rewrite is merged into the body update, so only one `updateIssue` mutation is sent.

---

## Step 7 — `src/adapters/github/internal/pagination.ts`: Fix milestone type and GraphQL fragments [todo]

This is the **only remaining compile error**. TypeScript reports a type mismatch at line 352 of `pagination.ts` because `RawFieldValue.milestone` does not include `id`, but `ItemFieldValue.milestone` (in `types.ts`) requires `{ id: string; title: string; dueOn: string | null }`.

Three co-located changes are required. All in `src/adapters/github/internal/pagination.ts`.

### 7a — Add `id` to `RawFieldValue.milestone` (line ~113)

Current:

```typescript
// Milestone
milestone?: { title: string; dueOn: string | null };
```

Replace with:

```typescript
// Milestone
milestone?: { id: string; title: string; dueOn: string | null };
```

### 7b — Add `id` to the `ProjectV2ItemFieldMilestoneValue` GraphQL fragment (line ~201)

In the full `fieldValuesFragment` branch (the `else` branch of the `if (sprintFieldIds...)` block):

Current:

```
... on ProjectV2ItemFieldMilestoneValue { milestone { title dueOn } field { ... on ProjectV2FieldCommon { id name } } }
```

Replace with:

```
... on ProjectV2ItemFieldMilestoneValue { milestone { id title dueOn } field { ... on ProjectV2FieldCommon { id name } } }
```

### 7c — Add `id` to the Issue content `milestone` fragment (line ~142)

In the Issue content fragment inside `buildItemsQuery`:

Current:

```
milestone { title dueOn }
```

Replace with:

```
milestone { id title dueOn }
```

This ensures runtime correctness: `buildStoryFromRaw` reads `content.milestone.id` to build the `EpicRef`. Without `id` in the GraphQL response, the field is `undefined` at runtime even though the type says `string`.

---

## Verification Checklist

Run in this exact order after confirming all steps are complete.

```sh
deno lint
```

Expected: no warnings.

```sh
deno test
```

Expected: 55 tests pass, 0 fail.

```sh
deno check \
  src/domain/types.ts \
  src/scrum/ports.ts \
  src/scrum/get-backlog.ts \
  src/scrum/get-sprint.ts \
  src/scrum/get-story.ts \
  src/schemas/scrum.ts \
  src/tools/scrum-write.ts \
  src/adapters/github/backend.ts \
  src/adapters/github/mappers.ts \
  src/adapters/github/internal/story-mutation-service.ts \
  src/adapters/github/internal/story-query-service.ts \
  src/adapters/github/internal/pagination.ts
```

Expected: zero errors.

| Check                                   | Expected result                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `deno lint`                             | Passes with no warnings                                                                                                      |
| `deno test`                             | All existing tests pass                                                                                                      |
| `deno check` — `mappers.ts`             | `parseDependencies` and `resolveDependencyRefs` are present; both story builders populate `blocked_by` and `blocks`          |
| `deno check` — `pagination.ts`          | `RawFieldValue.milestone` includes `id: string`; both GraphQL fragments request `milestone.id`; no type mismatch at line 352 |
| `deno check` — `story-mutation-service` | `rewriteDependencySection` and `_buildDependencyBody` are present; `updateStory` merges dependency rewrites into body        |
| `deno check` — `story-query-service`    | `resolveDependencyRefs` is called after building stories in both `getSprintStories` and `getBacklogStories`                  |
| `deno check` — `backend.ts`             | No compile errors; all `Story` constructions include `blocked_by` and `blocks`                                               |
| Manual smoke — `scrum_get_story`        | Returns `blocked_by: []` and `blocks: []` for a story without a `## Dependencies` section                                    |
| Manual smoke — `scrum_get_story`        | Returns populated arrays for a story with a `## Dependencies` section                                                        |
| Manual smoke — `scrum_get_sprint`       | Items with a `## Dependencies` section show `has_dependencies: true`; others show `false`                                    |
| Manual smoke — `scrum_get_backlog`      | Same as sprint check above                                                                                                   |
| Manual smoke — `scrum_update_story`     | `blocked_by: [{ id: "..." }]` rewrites only `Blocked by:` lines; existing `Blocks:` lines are preserved                      |
| Manual smoke — `scrum_update_story`     | `blocked_by: null, blocks: null` removes the entire `## Dependencies` section cleanly                                        |
