# Phase 7 Implementation Plan: Redesign scrum_get_backlog

## Phase 7 Overview

**Objective:** Transform `scrum_get_backlog` to return lightweight `StoryListing[]` instead of full `Story[]`, add active-item filtering (exclude Done stories with no sprint), and introduce `orphan_impediments` field for unresolved impediments without story/sprint context.

**Scope:** Framework-layer changes only (schemas, use-case, port interface). Adapter implementation of `getOrphanImpediments()` is tracked separately but requires a stub implementation to prevent runtime errors.

**Dependencies:**

- Phase 3: `error-formatter.ts` must exist for error handling in handler
- Phase 4: New types (`StoryListing`, `ImpedimentListing`) must be defined in ports.ts
- Phase 5, 6: Independent parallel work on sprint/history tools

---

## Detailed Steps

### Step 7a — Add `getOrphanImpediments()` to `ProjectBackend` interface

**Action:** Extend the Read section of `ProjectBackend` in [`src/scrum/ports.ts`](src/scrum/ports.ts) with new method declaration.

**File:** `src/scrum/ports.ts`

**Current State:**

- `ImpedimentRef` already exists in [`src/domain/types.ts`](src/domain/types.ts:26)
- `ImpedimentListing` already exists in [`src/scrum/ports.ts`](src/scrum/ports.ts:147-154)
- Method is missing from interface

**Change:** Add method to Read section (after line 241):

```typescript
/**
 * Return all impediments (issues tagged "impediment") that have no
 * cross-reference to a story or sprint — i.e., logged as project-level orphans.
 *
 * Only unresolved impediments (status "open" or "in_progress") are returned.
 * Resolved orphans are excluded.
 *
 * NOTE: This is a port interface declaration only. Adapter implementation details
 * (e.g., querying for issues with label "impediment" whose comment bodies contain
 * no PVTI_ item ID) belong in the adapter layer, not here.
 */
getOrphanImpediments(): Promise<ImpedimentListing[]>;
```

**Preconditions:** `ImpedimentListing` type exists in ports.ts (confirmed).

**Expected Outcome:** Port interface declares new method signature.

**Adapter Stub Required:** The adapter implementation (`GitHubProjectBackend`) must include a stub to prevent runtime errors:

```typescript
// In src/adapters/github/backend.ts
getOrphanImpediments(): Promise<ImpedimentListing[]> {
  // TODO: Implement orphan impediment detection logic
  // Query for issues with label "impediment" whose comment bodies contain no PVTI_ item ID
  return Promise.resolve([]);
}
```

---

### Step 7b — Update `GetBacklogSchema` in [`src/schemas/scrum.ts`](src/schemas/scrum.ts)

**Action:** Modify schema to reflect that return shape changes from `Story[]` to `StoryListing[]`. Schema input remains unchanged; only documentation needs updating.

**File:** `src/schemas/scrum.ts`

**Current State:**

- Line 98-127: `GetBacklogSchema` exists with correct input fields
- No mention of `orphan_impediments` in description
- `search` field lacks filtering order documentation
- `limit` field lacks note about active-item filter precedence

**Change:** Update the `.describe()` strings on lines 104 and 125:

```typescript
// Line 104 - search field:
search: z
  .string()
  .optional()
  .describe(
    "Case-insensitive substring matched against story title and body. " +
      "Results are filtered before applying limit.",
  ),

// Line 125 - limit field:
limit: z
  .number()
  .int()
  .positive()
  .default(50)
  .describe(
    "Maximum number of stories to return. Defaults to 50. " +
      "Applied after active-item filter and user-supplied filters.",
  ),
```

**Preconditions:** None (schema input unchanged).

**Expected Outcome:** Schema documentation reflects filtering order and return shape change.

---

### Step 7c — Rewrite `src/scrum/get-backlog.ts`

**Action:** Replace entire use-case file with new implementation that:

1. Projects full `Story[]` to lightweight `StoryListing[]`
2. Applies active-item filter (exclude Done + no sprint)
3. Fetches orphan impediments in parallel
4. Returns updated shape with `orphan_impediments` field

**File:** `src/scrum/get-backlog.ts`

**Current State:**

- Line 21: Return type is `stories: unknown[]` (should be `StoryListing[]`)
- No active-item filtering
- No orphan impediments support

**Change:** Replace entire file content with:

```typescript
// =============================================================================
// src/scrum/get-backlog.ts — getBacklogUseCase
//
// Returns lightweight StoryListing entries and orphan impediments.
// Active-item filter excludes Done stories with no sprint assigned.
// =============================================================================

import type { ImpedimentListing, ProjectBackend, StoryListing } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { Story } from "../domain/types.ts";
import { computeReadinessSummary } from "../domain/rules/readiness.ts";

interface GetBacklogParams {
  search?: string;
  labels?: string[];
  priority?: string;
  epic?: string;
  limit?: number;
}

interface GetBacklogResult {
  stories: StoryListing[];
  total_count: number;
  readiness: { ready: number; partially_ready: number; not_ready: number };
  orphan_impediments: ImpedimentListing[];
}

/** Project a full Story down to its lightweight StoryListing entry. */
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true, // Active backlog items are writable; see Step 7c.2 for future enhancement
});

/**
 * Active-item definition: exclude items where status is "done" (case-insensitive)
 * AND sprint is null (no sprint assigned). Stories that are Done inside an open
 * sprint remain visible. Stories that are Done with no sprint assigned are stale
 * and are excluded.
 *
 * TODO: Consider making this config-driven via ScrumConfig.doneStatuses[] for
 * teams using alternative status names like "Completed", "Closed", etc.
 */
const isActiveItem = (story: Story): boolean => {
  const isDoneStatus = story.status?.toLowerCase() === "done";
  const hasNoSprint = story.sprint === null;
  return !(isDoneStatus && hasNoSprint);
};

export const getBacklogUseCase = async (
  backend: ProjectBackend,
  _scrumConfig: ScrumConfig,
  params: GetBacklogParams,
): Promise<GetBacklogResult> => {
  // Fetch stories and orphan impediments in parallel
  const [allStories, orphanImpediments] = await Promise.all([
    backend.getBacklogStories(),
    backend.getOrphanImpediments(),
  ]);

  // Apply active-item filter before any user-supplied filters to prevent stale data exposure
  let stories = allStories.filter(isActiveItem);

  // Apply optional query filters
  if (params.search) {
    const needle = params.search.toLowerCase();
    stories = stories.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        s.body.toLowerCase().includes(needle),
    );
  }
  if (params.labels?.length) {
    stories = stories.filter((s) => params.labels!.every((l) => s.labels.includes(l)));
  }
  if (params.priority) {
    stories = stories.filter((s) => s.priority === params.priority);
  }
  if (params.epic) {
    stories = stories.filter((s) => s.epic === params.epic);
  }

  const totalCount = stories.length;
  const limitedStories = stories.slice(0, params.limit ?? 50);

  // Compute readiness from full Story objects (limitedStories is still Story[] at this point)
  const readinessSummary = computeReadinessSummary(
    limitedStories.map((s) => ({ body: s.body, story_points: s.story_points })),
  );

  return {
    stories: limitedStories.map(storyToListing),
    total_count: totalCount,
    readiness: readinessSummary,
    orphan_impediments: orphanImpediments,
  };
};
```

**Preconditions:**

- `StoryListing` and `ImpedimentListing` types exist in ports.ts (confirmed)
- `getOrphanImpediments()` method exists in ProjectBackend interface (Step 7a)
- Adapter stub for `getOrphanImpediments()` is implemented (see Step 7a notes)

**Expected Outcome:** Use-case returns correct shape with active-item filtering.

---

### Step 7c.1 — Add Unit Tests for New Functions

**Action:** Create unit tests for the new pure functions and use-case logic.

**File:** `tests/scrum/get-backlog.test.ts` (or existing test file)

**Test Coverage Required:**

1. `storyToListing()` - verify correct projection from Story to StoryListing
2. `isActiveItem()` - verify filter logic for various status/sprint combinations:
   - Done + no sprint → false (excluded)
   - Done + active sprint → true (included)
   - In Progress + no sprint → true (included)
   - Any status + completed sprint → true (included)
3. `getBacklogUseCase()` - verify parallel execution and result shape

**Preconditions:** Test framework configured (e.g., Deno test, Jest).

**Expected Outcome:** All unit tests pass with 100% coverage of new logic paths.

---

### Step 7c.2 — Future Enhancement: Dynamic `writable` Computation

**Action:** Document the enhancement for computing `writable` based on sprint status.

**Implementation Note:** Currently `writable: true` is hardcoded for all backlog items. Future enhancement should compute this as:

- `true` if story is in an active sprint (sprint === "current")
- `false` if story is in a completed sprint or has no sprint

This follows the Open/Closed Principle by not modifying existing code but planning for a future extension point.

---

### Step 7d — Update `scrum_get_backlog` handler description in [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts)

**Action:** Update the tool registration's `description` string to reflect new return shape and active-item filter behavior.

**File:** `src/tools/scrum-read.ts`

**Current State:**

- Handler body unchanged (still uses async params block)
- Description needs updating for:
  - Active-item filter explanation
  - `orphan_impediments` field documentation
  - Return shape change from `Story[]` to `StoryListing[]`

**Change:** Locate the `server.registerTool("scrum_get_backlog", ...)` call and update its `description` property (lines 135-148):

```typescript
description: `Return all active stories not yet assigned to any sprint (the product backlog).

Active items: excludes archived stories and Done stories with no sprint assigned.
All filter arguments are optional and combinable. Results are sorted by priority
descending, then story number ascending.

Args:
  search    string — case-insensitive substring match on title + body
  labels    string[] — include only stories carrying ALL of these labels
  priority  string — vocabulary display name, e.g. "Must" (from scrum_orient)
  epic      string — Milestone title (exact match)
  limit     integer > 0, default 50

Returns: {
  stories: StoryListing[],         — lightweight entries (no body or comments)
  total_count: number,
  readiness: { ready, partially_ready, not_ready },
  orphan_impediments: ImpedimentListing[]  — unresolved impediments with no story/sprint context
}
Each story has ref.id for use in subsequent write calls.`,
```

**Preconditions:** None (handler body unchanged).

**Expected Outcome:** Tool description accurately reflects new behavior.

---

### Step 7e — Add Migration Documentation

**Action:** Create a migration guide section explaining the breaking change.

**File:** `docs/migrations/phase7-backlog-redesign.md`

**Content:**

````markdown
# Phase 7 Backlog Redesign Migration Guide

## Breaking Change: Return Shape

The `scrum_get_backlog` tool now returns a structured object instead of a plain array:

### Before (Phase 6 and earlier):

```json
{
  "content": [
    {
      "type": "text",
      "text": "[{\"stories\": [{\"ref\": {...}, \"title\": \"...\", ...}], \"total_count\": 10, \"readiness\": {...}, \"orphan_impediments\": []}]"
    }
  ]
}
```
````

### After (Phase 7+):

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"stories\": [{\"ref\": {...}, \"title\": \"...\", ...}], \"total_count\": 10, \"readiness\": {...}, \"orphan_impediments\": []}"
    }
  ]
}
```

## Key Changes

1. **Return Shape:** Now returns `{ stories, total_count, readiness, orphan_impediments }` instead of just `stories[]`
2. **Story Listing:** Each story is now a `StoryListing` (lightweight) instead of full `Story` object
3. **Active-Item Filter:** Done stories with no sprint are automatically excluded
4. **Orphan Impediments:** New field for impediments without story/sprint context

## Migration Steps

1. Update code that consumes `scrum_get_backlog` results to handle the new shape
2. Access stories via `result.content[0].text.stories` (same path, different structure)
3. Handle `orphan_impediments` field if needed for your workflow
4. Note: `StoryListing` does not include `body`, `type`, `assignees`, `labels`, `epic`, `created_at`, or `updated_at` fields

## Backward Compatibility

This is a **breaking change**. Code that directly accesses the returned array will need to be updated to access `result.content[0].text.stories` instead.

````
**Preconditions:** None.

**Expected Outcome:** Users understand the breaking change and how to migrate.

---

## Dependencies & Constraints

### Project-Level Dependencies

| Dependency                       | Phase   | Status   | Notes                                                     |
| -------------------------------- | ------- | -------- | --------------------------------------------------------- |
| `error-formatter.ts`             | Phase 3 | Required | Handler uses `enrichError` for error formatting           |
| `StoryListing` type              | Phase 4 | Required | Defined in ports.ts (already exists)                      |
| `ImpedimentListing` type         | Phase 4 | Required | Defined in ports.ts (already exists)                      |
| `getOrphanImpediments()` adapter | TBD     | Required | **Must include stub** to prevent runtime errors           |

### Timeline Constraints

- **No hard deadline** — Phase 7 is independent of Phases 5, 6, 8, 9
- Can execute in parallel with any phase except Phase 3 (must wait for error-formatter)
- Adapter implementation (`getOrphanImpediments()` in `GitHubProjectBackend`) is out of scope but requires a stub

### Compliance Rules

1. **Dependency Rule:** Use-case imports only `ProjectBackend` interface, never adapter implementations
2. **Interface Segregation:** `StoryListing` is narrow (no body/comments) — appropriate for listing operations
3. **Fail Early:** Active-item filter runs before user filters to prevent stale data exposure
4. **Stub Requirement:** Adapter must include stub implementation to prevent runtime errors

---

## Risk Assessment

| Risk                                                            | Impact                                                   | Likelihood | Mitigation                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `getOrphanImpediments()` adapter not implemented                | Tool throws TypeError at runtime                         | High       | Add stub implementation: `return Promise.resolve([])`                                     |
| `"done"` case-insensitive match misses custom status names      | Some Done stories may appear in backlog                  | Medium     | TODO: Make config-driven via `ScrumConfig.doneStatuses[]`                                 |
| Active-item filter excludes valid Done stories in active sprint | User cannot see completed work in current sprint         | Low        | Filter explicitly checks `sprint === null`; Done stories in active sprint remain visible |
| `writable: true` always set for backlog items                   | No distinction between writable/read-only within backlog | Medium     | Future enhancement: compute based on sprint status (active vs. completed)                 |
| Breaking change from `Story[]` to `{ stories, ... }` shape      | Consumer code must be updated                            | High       | Document migration path in Step 7e                                                        |

---

## Success Criteria

Phase 7 is complete when all criteria are met:

1. **Schema:** `GetBacklogSchema` input unchanged; documentation updated
2. **Port:** `ProjectBackend.getOrphanImpediments()` method declared
3. **Use-case:** Returns `{ stories: StoryListing[], total_count, readiness, orphan_impediments }`
4. **Filtering:** Active-item filter excludes Done + no sprint before user filters
5. **Handler:** Description updated to reflect new return shape and behavior
6. **Stub:** Adapter includes stub implementation for `getOrphanImpediments()`
7. **Tests:** Unit tests cover new pure functions and use-case logic
8. **Documentation:** Migration guide explains breaking change

---

## Verification Steps

After implementation, verify:

```bash
# 1. Type checking passes
deno check src/scrum/get-backlog.ts src/schemas/scrum.ts src/scrum/ports.ts

# 2. Unit tests pass
deno test tests/scrum/get-backlog.test.ts

# 3. Tool call returns correct shape
curl -X POST http://localhost:8080/tools/scrum_get_backlog \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

# Expected output structure:
# {
#   "content": [
#     {
#       "type": "text",
#       "text": "{\"stories\": [{\"ref\": {...}, \"title\": \"...\", ...}], \"total_count\": 10, \"readiness\": {...}, \"orphan_impediments\": []}"
#     }
#   ]
# }

# Parse the JSON string inside text field:
curl -X POST http://localhost:8080/tools/scrum_get_backlog \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -c "import sys, json; data = json.load(sys.stdin); print(json.dumps(json.loads(data['content'][0]['text']), indent=2))"
````

---

## Architecture Diagram

```mermaid
flowchart TD
    Handler[scrum_get_backlog handler] -->|calls| UseCase[getBacklogUseCase]
    UseCase -->|depends on| Port[ProjectBackend interface]
    Port -->|declares| Method1[getBacklogStories]
    Port -->|declares| Method2[getOrphanImpediments]
    UseCase -->|imports| Types[StoryListing, ImpedimentListing]
    UseCase -->|delegates to| Readiness[computeReadinessSummary]

    subgraph Framework Layer
        UseCase
        Port
        Types
        Readiness
    end

    subgraph Domain Layer
        Readiness
    end

    Handler -.->|registers| UseCase

    %% Data flow
    UseCase -->|projects| Listing[StoryListing[]]
    UseCase -->|filters| Active[Active Items Only]
    UseCase -->|returns| Result{stories, total_count,\nreadiness,\norphan_impediments}
```

---

## Related Files Summary

| File                       | Lines Changed       | Purpose                          |
| -------------------------- | ------------------- | -------------------------------- |
| `src/scrum/ports.ts`       | +1 method           | Declare `getOrphanImpediments()` |
| `src/schemas/scrum.ts`     | Update descriptions | Document new return shape        |
| `src/scrum/get-backlog.ts` | Full rewrite        | New use-case implementation      |
| `src/tools/scrum-read.ts`  | Update description  | Tool registration documentation  |
| `tests/scrum/`             | New test file       | Unit tests for new logic         |
| `docs/migrations/`         | New migration guide | Explain breaking change          |

---

## Next Steps After Phase 7

1. **Phase 8:** Redesign `scrum_log_impediment` (make `affects` optional)
2. **Phase 9:** Create `scrum_update_impediment` tool
3. **Phase 10:** Update all tool descriptions to reflect Phases 5-9 changes
