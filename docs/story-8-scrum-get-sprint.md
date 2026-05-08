# Story 8: Implement scrum_get_sprint Read Tool

**Issue:** [#10](https://github.com/hoonsubin/github-projects-mcp-server/issues/10)  
**Priority:** Should  
**Size:** M  
**Story Points:** 5  
**Sprint:** Sprint 2  
**Status:** In Progress

---

## Goal

Implement the `scrum_get_sprint` read tool that returns the sprint board: all stories for a given sprint, grouped by status with point totals. This is the agent's primary orient call for any in-sprint ceremony.

---

## Acceptance Criteria

1. **Tool registration** — `scrum_get_sprint` is registered in `src/tools/scrum-read.ts` with proper MCP tool metadata (title, description, inputSchema, annotations).

2. **Sprint targeting** — Accepts optional `sprint` argument of type `SprintRef` (`"current"`, `"next"`, `null`, or explicit sprint name). Defaults to `"current"`.

3. **Sprint metadata** — Returns sprint header with `name`, `start_date`, `end_date`, `duration_days`, and `days_remaining`.

4. **Grouped stories** — Returns `groups` array where each entry contains `status`, `stories[]` (Story objects), and `points_sum` (sum of story points for that group).

5. **Totals** — Returns `totals` object with `committed_points`, `completed_points`, `in_flight_points`, and `blocked_points`.

6. **Status vocabulary order** — Groups are ordered according to the team's declared status vocabulary order from `config.yml`.

7. **Error handling** — Returns structured error when sprint is not found, no active sprint exists, or GraphQL calls fail.

8. **Config-driven status display names** — Done/In Progress/Blocked status display names are inferred from `yml.status` vocabulary (not hardcoded).

9. **No hardcoded GitHub IDs** — All field IDs and option IDs are resolved at runtime via `loadConfig`.

10. **Handler reads as an orchestration** — The registered tool handler delegates to named helper functions and contains no inline business logic. Each helper function is independently testable without a GitHub client mock.

11. **Test coverage** — Unit tests in `src/tools/scrum-read.test.ts` verify grouping logic, totals calculation, vocabulary ordering, and edge cases (empty sprint, missing fields).

---

## Implementation Plan

### Phase 1: Schema and Type Setup (Already Complete)

| Task                                          | Status  | Notes                                                       |
| --------------------------------------------- | ------- | ----------------------------------------------------------- | ------ | ---- | ------- |
| `GetSprintSchema` in `src/schemas/scrum.ts`   | ✅ Done | `z.object({ sprint: SprintRefSchema.optional() }).strict()` |
| `Story` type in `src/types.ts`                | ✅ Done | Canonical story shape with all required fields              |
| `SprintRef` type in `src/types.ts`            | ✅ Done | `"current"                                                  | "next" | null | string` |
| `RuntimeConfig` in `src/services/config.ts`   | ✅ Done | Provides `iterations`, `fields`, `statusOptions`            |
| `resolveSprint` in `src/services/resolver.ts` | ✅ Done | Sync function resolving `SprintRef` → iteration ID          |

### Phase 2a: Refactor Existing Handler (Do This Before Gap Fixes)

The `scrum_get_sprint` tool is already implemented in [`src/tools/scrum-read.ts:906-1049`](src/tools/scrum-read.ts:906), but the handler body does too many things inline. Before fixing the gaps, extract the business logic into named helper functions so that each piece is independently testable.

**Why first:** Gap 1 and Gap 4 both require that the grouping and totals logic be addressable in isolation. That's only possible once the logic lives in named functions outside the handler closure.

#### Refactor 1: Extract `sumPointsWhere`

The reduce expression `stories.reduce((acc, s) => acc + (s.story_points ?? 0), 0)` appears three times across the handler (committed_points inline, points_sum in groups, and would appear again in the Gap 1 fix). Extract it once:

```typescript
// In the "── Vocabulary helpers ──" section of scrum-read.ts, alongside findStatusDisplayName

/**
 * Sum story points across stories matching the given predicate.
 * Treats null story_points as 0.
 */
const sumPointsWhere = (
  stories: Story[],
  predicate: (s: Story) => boolean,
): number =>
  stories.filter(predicate).reduce((acc, s) => acc + (s.story_points ?? 0), 0);
```

Then update the handler to use it consistently:

```typescript
// groups computation (line ~998) — before Gap 1 fix:
points_sum: sumPointsWhere(groupStories, () => true),

// totals computation (lines ~1009-1014):
const totals = {
  committed_points: sumPointsWhere(stories, () => true),
  completed_points: sumPointsWhere(stories, (s) => s.status === doneDisplay),
  in_flight_points: sumPointsWhere(stories, (s) => s.status === inProgressDisplay),
  blocked_points:   sumPointsWhere(stories, (s) => s.status === blockedDisplay),
};
```

This also removes the inline `sum` closure that was defined inside the handler.

#### Refactor 2: Extract `buildSprintMeta`

The `let sprintMeta` / `if (iterEntry)` block (lines ~1017-1034) mutates a variable and is typed as `Record<string, unknown>`, hiding the actual shape. Extract it as a pure function with a declared return type:

```typescript
// Declared type for the sprint header returned to the agent.
interface SprintMeta {
  name: string;
  start_date?: string;
  end_date?: string;
  duration_days?: number;
  days_remaining?: number;
}

/**
 * Build the sprint metadata header for the response.
 * When iterEntry is available, returns full date/duration fields.
 * Falls back to { name: "(sprint not found)" } so the agent receives a
 * descriptive label rather than the internal SprintRef address ("current").
 */
const buildSprintMeta = (iterEntry: IterationEntry | undefined): SprintMeta => {
  if (!iterEntry) return { name: "(sprint not found)" };

  const endDate = new Date(iterEntry.startDate);
  endDate.setDate(endDate.getDate() + iterEntry.duration);
  endDate.setHours(0, 0, 0, 0); // normalize to avoid timezone edge cases (Gap 2 fix)

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
  );

  return {
    name: iterEntry.title,
    start_date: iterEntry.startDate,
    end_date: endDate.toISOString().slice(0, 10),
    duration_days: iterEntry.duration,
    days_remaining: daysRemaining,
  };
};
```

This extraction also absorbs Gap 2 (`endDate.setHours(0, 0, 0, 0)` — see below).

#### Refactor 3: Extract `groupStoriesByStatus`

The grouping loop (lines ~988-999) and the vocabulary ordering (Gap 1 fix) together form a single named concept: grouping stories by status in vocabulary order. Extract them as one function so the handler doesn't contain grouping logic:

```typescript
/**
 * Group stories by their status display name, ordered by the team's declared
 * status vocabulary. Statuses not present in the vocabulary are appended at the end.
 */
const groupStoriesByStatus = (
  stories: Story[],
  config: RuntimeConfig,
): Array<{ status: string; stories: Story[]; points_sum: number }> => {
  // Build the raw group map first
  const groupMap = new Map<string, Story[]>();
  for (const story of stories) {
    const key = story.status ?? "(No Status)";
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(story);
  }

  // Order by declared vocabulary
  const statusOrder = Object.values(
    (config.yml.status as Record<string, string>) ?? {},
  );
  const orderedGroups = statusOrder
    .filter((statusName) => groupMap.has(statusName))
    .map((statusName) => ({
      status: statusName,
      stories: groupMap.get(statusName)!,
      points_sum: sumPointsWhere(groupMap.get(statusName)!, () => true),
    }));

  // Append any statuses not in the vocabulary (e.g., options added after config was written)
  const knownStatuses = new Set(statusOrder);
  for (const [status, groupStories] of groupMap) {
    if (!knownStatuses.has(status)) {
      orderedGroups.push({
        status,
        stories: groupStories,
        points_sum: sumPointsWhere(groupStories, () => true),
      });
    }
  }

  return orderedGroups;
};
```

#### After all three refactors — the handler reads as orchestration only

```typescript
async (params: z.infer<typeof GetSprintSchema>) => {
  try {
    const { owner, ownerType, projectNumber } = getBootstrapConfig();
    const config = await loadConfig({ github: gh, owner, ownerType, projectNumber, repo: getRepo() });

    const sprintRef = params.sprint ?? "current";
    const iterationId = resolveSprint(sprintRef, config);

    if (iterationId === null) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        message: "Backlog view is not supported by scrum_get_sprint. Use scrum_get_backlog instead.",
      }, null, 2) }] };
    }

    const iterEntry = config.iterations.all.find((i) => i.id === iterationId);
    const allItems = await fetchAllItems(config, owner, ownerType);
    const sprintItems = allItems.filter((item) => {
      const fv = item.fieldValues.nodes.find((v) => v.field?.id === config.fields.sprintFieldId);
      return fv?.iterationId === iterationId;
    });

    const stories = sprintItems
      .map((item) => buildStoryFromRaw(item, config))
      .filter((s): s is Story => s !== null);

    const groups  = groupStoriesByStatus(stories, config);
    const totals  = computeSprintTotals(stories, config);
    const sprint  = buildSprintMeta(iterEntry);

    return { content: [{ type: "text" as const, text: JSON.stringify({ sprint, groups, totals }, null, 2) }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
  }
},
```

Note the `computeSprintTotals` function is the remaining extraction:

```typescript
/**
 * Compute sprint point totals using vocabulary-based status identification.
 * The "done", "in progress", and "blocked" buckets are matched by keyword
 * against the team's declared status vocabulary — not hardcoded strings.
 */
const computeSprintTotals = (
  stories: Story[],
  config: RuntimeConfig,
): {
  committed_points: number;
  completed_points: number;
  in_flight_points: number;
  blocked_points: number;
} => {
  const doneDisplay = findStatusDisplayName(config, "done", "Done");
  const inProgressDisplay = findStatusDisplayName(
    config,
    "progress",
    "In Progress",
  );
  const blockedDisplay = findStatusDisplayName(config, "block", "Blocked");

  return {
    committed_points: sumPointsWhere(stories, () => true),
    completed_points: sumPointsWhere(stories, (s) => s.status === doneDisplay),
    in_flight_points: sumPointsWhere(
      stories,
      (s) => s.status === inProgressDisplay,
    ),
    blocked_points: sumPointsWhere(stories, (s) => s.status === blockedDisplay),
  };
};
```

### Phase 2b: Gap Fixes (After Refactor)

#### Gap 1: Status vocabulary order — RESOLVED by Refactor 3

`groupStoriesByStatus` (extracted above) enforces vocabulary order. No separate fix needed once Refactor 3 is applied. The original Gap 1 snippet in the previous version of this story had two bugs that are avoided by the refactored version:

- **Bug 1:** `.filter((group): group is Story[] => group !== null)` — `Map.get()` returns `T | undefined`, not `T | null`, so `!== null` does not filter `undefined`. The refactored version uses `groupMap.has(statusName)` instead, which is unambiguous.
- **Bug 2:** `status: stories[0].status!` reads the status back from the first story rather than using the known `statusName` from the outer map iteration. Fragile if `story.status` is null. The refactored version uses `statusName` directly.

#### Gap 2: `days_remaining` timezone normalization — RESOLVED by Refactor 2

`buildSprintMeta` (extracted above) applies `endDate.setHours(0, 0, 0, 0)` before the diff, matching the existing `today.setHours(0, 0, 0, 0)` call. No separate fix needed.

#### ~~Gap 3: Missing `scrum_get_template` tool~~ — OUT OF SCOPE

`scrum_get_template` is a separate tool with its own schema, config lookup path, and acceptance criteria. Including it in this story gives this story two reasons to change. It belongs in its own story (file a follow-up: "Implement scrum_get_template read tool").

#### Gap 4: No test coverage

Create `src/tools/scrum-read.test.ts`. Tests go in a dedicated file, not inline in the implementation — `scrum-read.ts` already has one reason to change (the tools it implements). A test file has exactly one reason to change: the behaviour of those tools.

Because the business logic is now in named module-level helpers (`groupStoriesByStatus`, `computeSprintTotals`, `buildSprintMeta`, `sumPointsWhere`), these can be unit-tested directly without registering an MCP server or mocking a GitHub client.

### Phase 3: Testing

All tests in `src/tools/scrum-read.test.ts`. Import the extracted helper functions directly.

| Test Case                   | Description                                                              | Priority |
| --------------------------- | ------------------------------------------------------------------------ | -------- |
| Happy path — current sprint | Verify grouping, totals, and metadata for a sprint with multiple stories | High     |
| Happy path — named sprint   | Verify resolving by explicit sprint name                                 | High     |
| Happy path — next sprint    | Verify resolving `"next"` to the next scheduled sprint                   | Medium   |
| Empty sprint                | `groups` is `[]`; all totals are `0`; sprint metadata is present         | Medium   |
| Sprint not found            | Verify structured error when sprint name doesn't match                   | High     |
| No active sprint            | Verify error when `"current"` is passed but no sprint is active          | High     |
| Mixed field values          | Items with null story_points and null priority are handled as 0/null     | Medium   |
| Status vocabulary ordering  | Groups returned in `yml.status` key order; unknown statuses appended     | Medium   |
| `sumPointsWhere` unit       | Direct test: null points count as 0; predicate filters correctly         | Medium   |
| `buildSprintMeta` unit      | `undefined` iterEntry → `{ name: "(sprint not found)" }` fallback        | Medium   |
| `buildSprintMeta` timezone  | `days_remaining` is 0 when end date is in the past                       | Medium   |
| `groupStoriesByStatus` unit | Vocabulary order is respected; stories with unknown status are appended  | Medium   |

### Phase 4: Documentation

| Task                  | Description                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Update README         | Ensure `scrum_get_sprint` section matches the actual return shape                           |
| Update REFACTORING.md | Mark Story 8 as complete in the implementation order table                                  |
| Add inline docs       | JSDoc on `groupStoriesByStatus`, `computeSprintTotals`, `buildSprintMeta`, `sumPointsWhere` |

---

## Dependencies

| Dependency                     | Status  | Notes                                                             |
| ------------------------------ | ------- | ----------------------------------------------------------------- |
| `loadConfig` service           | ✅ Done | Provides RuntimeConfig with field IDs, status options, iterations |
| `resolveSprint` service        | ✅ Done | Resolves SprintRef → iteration ID                                 |
| `PaginatedProjectItemFetcher`  | ✅ Done | Efficient pagination for project items                            |
| `buildStoryFromRaw` helper     | ✅ Done | Converts raw GraphQL items to Story shape                         |
| `findStatusDisplayName` helper | ✅ Done | Vocabulary-based status lookup                                    |

---

## Risk Assessment

| Risk                                  | Impact                                  | Mitigation                                               |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Large sprint (100+ items)             | Performance degradation from full fetch | Already handled by pagination; consider adding a warning |
| Timezone issues in `days_remaining`   | Incorrect day count                     | Normalize `endDate` to midnight in `buildSprintMeta`     |
| Status vocabulary mismatch            | Groups ordered incorrectly              | `groupStoriesByStatus` enforces vocabulary order         |
| Missing sprint field ID               | Silent failure                          | `loadConfig` already validates required fields           |
| Unit tests tightly coupled to handler | Tests break on unrelated changes        | Extract helpers to module scope; test them directly      |

---

## Implementation Order

1. **Refactor 1** — Extract `sumPointsWhere` helper; update `groups` and `totals` to use it (10 min)
2. **Refactor 2** — Extract `buildSprintMeta`; replaces Gap 2 fix and the `let`/mutation pattern (15 min)
3. **Refactor 3** — Extract `groupStoriesByStatus`; replaces Gap 1 fix (15 min)
4. **Refactor 4** — Extract `computeSprintTotals`; handler becomes orchestration-only (10 min)
5. **Verify handler** — Confirm `scrum_get_sprint` handler reads as a clean orchestration sequence (5 min)
6. **Write unit tests** — `src/tools/scrum-read.test.ts` covering all Phase 3 cases (1 hour)
7. **Update documentation** — README, REFACTORING.md, inline JSDoc (30 min)
8. **Cross-check against spec** — Verify return shape matches README tool surface (10 min)

**Estimated total effort:** ~2.5 hours

---

## Notes

- `fetchAllItems` takes `owner` and `ownerType` as separate arguments. This is consistent with the existing pattern across all handlers in `scrum-read.ts`. Consolidating these into a `ProjectIdentity` object is a codebase-wide concern tracked in `REFACTORING.md` — do not change the signature here.
- The existing implementation already follows the correct design principles: no hardcoded GitHub IDs, vocabulary-driven status names, stateless config resolution. The refactoring in Phase 2a improves internal structure without changing any observable behavior.
- `scrum_get_template` has been removed from this story's scope. File a separate story before Sprint 3.
