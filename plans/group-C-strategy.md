# Group C — Orient Enhancements: Implementation Strategy

**Date:** 2026-05-25\
**Target:** `tasks/TODO.md` Group C (C1, C2, C3)\
**Execution order:** C1 → C2 → C3 (C1 feeds data that C2 and C3 need)

---

## Overview

Three enhancements to [`orientUseCase()`](src/scrum/orient.ts:42) that transform `scrum_orient` from a setup validator into an executive summary.

| #  | What changes                    | Why                                                                                        |
| -- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| C1 | Epics filtered to sprint scope  | orient currently returns ALL open epics — 14 files worth of irrelevant context             |
| C2 | Sprint goal field wired through | `goal: null` is hardcoded — infrastructure exists but goal is never surfaced               |
| C3 | Actual work completion %        | `workPct: 0` is hardcoded — `riskStance` always computed against 0% regardless of progress |

### Design decisions

- **C1**: When no active sprint exists, fall back to all open epics (no regression).
- **C2**: `goal` will always be `null` on GitHub (the `ProjectV2IterationFieldIteration` GraphQL type has no `description` field). The plumbing must still be built so future adapters can populate it and the domain types are semantically complete.
- **C3**: When no items have story points, `workPct` stays 0 (no regression).

---

## C1 — Sprint-scoped epic filtering

### Problem

[`orientUseCase()`](src/scrum/orient.ts:58) calls `backend.getEpics()` and filters only by `status !== "done"`. Epics with no items in the active sprint are included, bloating the orient response.

### Solution

Pass the active sprint iteration ID through the port so the adapter can filter epics to only those that have ≥1 item in the sprint.

### Steps

#### Step 1.1 — [`src/scrum/ports.ts`](src/scrum/ports.ts:263) — Add optional parameter to `EpicPort.getEpics()`

Change the signature to accept an optional sprint iteration ID:

```typescript
export interface EpicPort {
  getEpics(sprintIterationId?: string | null): Promise<EpicListing[]>;
}
```

#### Step 1.2 — [`src/adapters/github/internal/epic-service.ts`](src/adapters/github/internal/epic-service.ts:38) — Add sprint-filtering logic

**Constructor change:** Inject `StoryQueryService` as a 4th parameter.

```typescript
constructor(
  private readonly gh: GitHubClient,
  private readonly owner: string,
  private readonly repos: string[],
  private readonly storyQueryService: StoryQueryService,
) {}
```

**`getEpics()` method change:** Accept optional `sprintIterationId`. When provided and non-null:

1. Call `storyQueryService.findItems()` with a filter scoped to that sprint iteration.
2. Collect the set of unique `epic.ref.id` values from returned items.
3. Filter milestone results: keep only those whose `id` is in the sprint-epic set.

When `sprintIterationId` is null/undefined: return all milestones (existing behavior).

The `findItems` call should use the `sprint_ref` filter. Pass the iteration ID string directly — it matches the `resolveSprint` string overload path.

```typescript
async getEpics(sprintIterationId?: string | null): Promise<EpicListing[]> {
  const allMilestones = await this._fetchMilestones();

  if (!sprintIterationId) return allMilestones;

  // Fetch items in the active sprint and collect their epic IDs
  const sprintItems = await this.storyQueryService.findItems({
    scope: "sprint",
    keys: [],
    search: "",
    types: [],
    statuses: [],
    priority: "",
    epic_id: "",
    labels: [],
    assignee: "",
    estimated: undefined,
    sprint_ref: sprintIterationId,
    include_dependencies: false,
    limit: 100,
  });

  const epicIdsInSprint = new Set<string>();
  for (const item of sprintItems.items) {
    if (item.epic?.ref.id) epicIdsInSprint.add(item.epic.ref.id);
  }

  return allMilestones.filter((m) => epicIdsInSprint.has(m.ref.id));
}
```

**Extract helper** — move the milestone-fetching logic (currently inline in `getEpics`) into a private method `_fetchMilestones()` so the public method can compose it with filtering cleanly.

#### Step 1.3 — [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts:214) — Wire `sprintIterationId` through

```typescript
getEpics(sprintIterationId?: string | null): Promise<EpicListing[]> {
  return this.deps.epicService.getEpics(sprintIterationId);
}
```

#### Step 1.4 — [`src/adapters/github/factory.ts`](src/adapters/github/factory.ts:95) — Inject `StoryQueryService` into `EpicService`

Move `epicService` construction AFTER `storyQueryService` and pass it:

```typescript
const storyQueryService = new StoryQueryService(config, ghClient, owner, primaryRepo);

const epicService = new EpicService(ghClient, owner, gh.tracked_repos, storyQueryService);
```

#### Step 1.5 — [`src/scrum/orient.ts`](src/scrum/orient.ts:58) — Pass active sprint ID

```typescript
const sprintIterationId = state.iterations.active?.id ?? null;
const allEpics: EpicListing[] = await backend.getEpics(sprintIterationId);
```

#### Edge cases

- **No active sprint:** `sprintIterationId` is `null` → EpicService falls back to all open epics.
- **Empty sprint:** `findItems` returns 0 items → filtered epics list is empty (correct: no epics have items in the sprint).
- **Draft items in sprint:** Draft issues have no epic → they contribute no epic refs and are silently skipped.

---

## C2 — Sprint goal population

### Problem

[`buildSprintContext()`](src/scrum/orient.ts:84) hardcodes `goal: null`. The `SprintInfo` type at [`src/scrum/ports.ts:92`](src/scrum/ports.ts:92) has no `goal` field.

### Solution

Add a `description` field to the domain `IterationEntry` type (the base iteration shape), propagate it through the adapter as the `goal` field on `SprintInfo`, and wire it into `orient.ts`.

**GitHub constraint:** The GitHub GraphQL `ProjectV2IterationFieldIteration` type has no `description` field — `goal` will always be `null` on GitHub. The plumbing is built for future adapters.

### Steps

#### Step 2.1 — [`src/domain/types.ts`](src/domain/types.ts:407) — Add `description` to `IterationEntry`

```typescript
export interface IterationEntry {
  id: string;
  title: string;
  description: string | null; // NEW: null for GitHub (API doesn't expose it)
  startDate: string;
  duration: number;
}
```

#### Step 2.2 — [`src/adapters/github/config-loader.ts`](src/adapters/github/config-loader.ts:100) — Update `IterationFieldNode` interface

Add `description` (optional, nullable) to both iteration arrays:

```typescript
interface IterationFieldNode {
  id: string;
  name: string;
  dataType: string;
  configuration: {
    iterations: Array<{
      id: string;
      title: string;
      description?: string | null; // NEW
      startDate: string;
      duration: number;
    }>;
    completedIterations: Array<{
      id: string;
      title: string;
      description?: string | null; // NEW
      startDate: string;
      duration: number;
    }>;
  };
}
```

In the iteration mapping (lines 513-517), propagate `description`:

```typescript
activeIterations = node.configuration.iterations.map((i) => ({
  id: i.id,
  title: i.title,
  description: i.description ?? null, // NEW
  startDate: i.startDate,
  duration: i.duration,
}));
```

Same change for `completedIterations` mapping.

#### Step 2.3 — [`src/adapters/github/operations.graphql`](src/adapters/github/operations.graphql:72) — Add `description` to iteration fragments

Add `description` to all 5 occurrences of `ProjectV2IterationField` fragments (lines ~72, ~219, ~243):

```graphql
... on ProjectV2IterationField {
  id name dataType
  configuration {
    iterations { id title description startDate duration }
    completedIterations { id title description startDate duration }
  }
}
```

`description` will always be `null` from GitHub's API, but requesting it is forwards-compatible should GitHub add it.

#### Step 2.4 — [`src/scrum/ports.ts`](src/scrum/ports.ts:92) — Add `goal` to `SprintInfo`

```typescript
export interface SprintInfo {
  readonly id: string;
  readonly name: string;
  readonly goal: string | null; // NEW
  readonly startDate: string;
  readonly durationDays: number;
  readonly endDate: string;
}
```

#### Step 2.5 — [`src/adapters/github/mappers.ts`](src/adapters/github/mappers.ts:297) — Map `description` → `goal`

In `toSprintInfo()`:

```typescript
export const toSprintInfo = (iter: IterationEntry | null): SprintInfo | null => {
  if (!iter) return null;
  const endDate = new Date(iter.startDate);
  endDate.setDate(endDate.getDate() + iter.duration);
  return {
    id: iter.id,
    name: iter.title,
    goal: iter.description, // NEW: null for GitHub, non-null for future adapters
    startDate: iter.startDate,
    durationDays: iter.duration,
    endDate: endDate.toISOString().slice(0, 10),
  };
};
```

#### Step 2.6 — [`src/scrum/orient.ts`](src/scrum/orient.ts:82) — Use `info.goal`

In `buildSprintContext()`, replace the hardcoded `null`:

```typescript
const buildSprintContext = (
  info: typeof state.iterations.active,
) => {
  if (!info) return null;
  return sprintContextFromSprintInfo(
    {
      id: info.id,
      name: info.name,
      goal: info.goal, // was: null
      start_date: info.startDate,
      end_date: info.endDate,
      duration_days: info.durationDays,
    },
    daysSince(info.startDate),
    0, // C3 replaces this
  );
};
```

#### Step 2.7 — Implementation note for orient.ts return

When `goal` remains `null` on GitHub, the MCP response must include an enriched error message alongside the normal response stating: `Sprint goal is not implemented or unavailable for ${backendName}`. This instructs the agent that the lack of contextual information is an implementation gap, not a missing goal setting.

---

## C3 — workPct computation

### Problem

[`buildSprintContext()`](src/scrum/orient.ts:90) passes hardcoded `0` as `workPct`. The `riskStance` in `SprintContext` is always computed against 0% completion, making the time-progress signal unreliable.

### Solution

Add a port method that computes completion percentage from sprint items, implement it in the adapter, then call it in orient before building sprint context.

### Steps

#### Step 3.1 — [`src/adapters/github/internal/story-query-service.ts`](src/adapters/github/internal/story-query-service.ts:337) — Add `computeSprintCompletion()`

New public method on `StoryQueryService`:

```typescript
/**
 * Compute work completion percentage for a sprint.
 * Returns completed points and total committed points.
 * When no items have story points, returns { completed: 0, total: 0 }
 * (workPct = 0 — no regression from current behavior).
 */
async computeSprintCompletion(iterationId: string): Promise<{ completed: number; total: number }> {
  const allItems = await this.fetchAllItems();

  // Filter items assigned to this iteration
  const sprintItems = allItems.filter((item) => {
    const fv = item.fieldValues.nodes.find(
      (v) => v.field?.id === this.config.fields.sprintFieldId,
    );
    return fv?.iterationId === iterationId;
  });

  const stories = sprintItems
    .map((item) => buildStoryFromRaw(item, this.config))
    .filter((s): s is Story => s !== null);

  // Build reverse map: display name → canonical status key
  // Needed because story.status holds the display name (e.g. "Done"),
  // but terminal semantics are keyed by canonical key (e.g. "done").
  const statusReverseMap = new Map<string, string>();
  const scrumConfig = this.config.scrumConfig;
  const ghConfig = scrumConfig.backends.github as Record<string, unknown>;
  const statusDisplay = (ghConfig?.status_display ?? {}) as Record<string, string>;
  for (const [canonical, display] of Object.entries(statusDisplay)) {
    statusReverseMap.set(display, canonical);
  }

  let completed = 0;
  let total = 0;

  for (const story of stories) {
    const points = story.story_points ?? 0;
    total += points;
    if (story.status) {
      const canonicalKey = statusReverseMap.get(story.status);
      if (canonicalKey && scrumConfig.scrum.status[canonicalKey]?.terminal) {
        completed += points;
      }
    }
  }

  return { completed, total };
}
```

**Design note:** The cast `scrumConfig.backends.github as Record<string, unknown>` is necessary because the domain layer type-erases backend configs. This cast is safe here because we are in the adapter layer, where the runtime type is guaranteed to be `GitHubBackendConfig`.

#### Step 3.2 — [`src/scrum/ports.ts`](src/scrum/ports.ts:326) — Add `getSprintCompletion` to `ProjectReader`

```typescript
export interface ProjectReader
  extends StoryPort, EpicPort, FindItemsPort, AnalyticsPort, BoardHealthPort, ImpedimentPort {
  // ... existing ...

  /**
   * Compute work completion for a sprint.
   * Returns completed points and total committed points.
   * { completed: 0, total: 0 } when no items have story points.
   */
  getSprintCompletion(iterationId: string): Promise<{ completed: number; total: number }>;
}
```

#### Step 3.3 — [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts) — Wire `getSprintCompletion`

Add delegation after the existing `getEpics()` method:

```typescript
getSprintCompletion(iterationId: string): Promise<{ completed: number; total: number }> {
  return this.deps.storyQueryService.computeSprintCompletion(iterationId);
}
```

#### Step 3.4 — [`src/scrum/orient.ts`](src/scrum/orient.ts:42) — Compute and use `workPct`

Hoist `workPct` computation before `buildSprintContext` so it's captured by closure:

```typescript
// Compute work completion percentage for the active sprint
let workPct = 0;
if (state.iterations.active) {
  const { completed, total } = await backend.getSprintCompletion(
    state.iterations.active.id,
  );
  workPct = total > 0 ? Math.round((completed / total) * 100) : 0;
}

const buildSprintContext = (
  info: typeof state.iterations.active,
) => {
  if (!info) return null;
  return sprintContextFromSprintInfo(
    {
      id: info.id,
      name: info.name,
      goal: info.goal,
      start_date: info.startDate,
      end_date: info.endDate,
      duration_days: info.durationDays,
    },
    daysSince(info.startDate),
    workPct, // was: 0
  );
};
```

#### Edge cases

- **No story-points field on the board:** All stories have `story_points: null` → `total: 0` → `workPct: 0` (no regression).
- **No active sprint:** `state.iterations.active` is null → `workPct` stays 0 → `buildSprintContext` returns null (existing behavior).
- **All items done:** `completed === total` → `workPct: 100` → `riskStance: "normal"` (ratio = time/100, likely < 1.1).
- **No items done:** `completed: 0` → `workPct: 0` → existing `computeRiskStance` logic handles this (timeElapsedPct > 0 → "elevated").

---

## Execution order

```
C1 ─────────────────────────────────────────────────────────────────
│
│  1. ports.ts: EpicPort.getEpics(sprintIterationId?)
│  2. epic-service.ts: +storyQueryService dep, sprint filter logic
│  3. factory.ts: reorder construction, inject storyQueryService
│  4. backend.ts: pass sprintIterationId through
│  5. orient.ts: pass state.iterations.active?.id
│
├── C2 ─────────────────────────────────────────────────────────────
│   │
│   │  1. types.ts: IterationEntry.description
│   │  2. config-loader.ts: update IterationFieldNode interface + mapping
│   │  3. operations.graphql: add description to 5 iteration fragments
│   │  4. ports.ts: SprintInfo.goal
│   │  5. mappers.ts: map iter.description → goal
│   │  6. orient.ts: goal: info.goal
│   │  7. orient.ts: add enriched error note for GitHub null goal
│   │
│   └── C3 ─────────────────────────────────────────────────────────
│       │
│       │  1. story-query-service.ts: computeSprintCompletion()
│       │  2. ports.ts: ProjectReader.getSprintCompletion()
│       │  3. backend.ts: wire getSprintCompletion
│       │  4. orient.ts: hoist workPct computation, pass to sprintContextFromSprintInfo
│
└───────────────────────────────────────────────────────────────────
```

---

## Verification checklist

| # | Item                      | How to verify                                                                                                                     |
| - | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1 | C1 baseline               | `scrum_orient` with active sprint → `platform_state.epics.active` count ≤ total epic count; epics without sprint items are absent |
| 2 | C1 edge: no active sprint | `scrum_orient` with no active sprint → all open epics returned (existing behavior preserved)                                      |
| 3 | C2 baseline               | `SprintInfo` type has `goal: string \| null` field; `toSprintInfo()` maps `IterationEntry.description` → `goal`                   |
| 4 | C2 GitHub                 | `goal` is `null` for all GitHub-backed sprints (API doesn't expose iteration descriptions)                                        |
| 5 | C3 baseline               | Orient mid-sprint with 5/10 SP done → `riskStance` reflects ~50% completion, not 0%                                               |
| 6 | C3 edge: no SP field      | `workPct: 0` → `riskStance` based on time elapsed vs 0% (same as current behavior)                                                |
| 7 | C3 edge: all done         | `workPct: 100` → `riskStance: "normal"` regardless of time elapsed                                                                |
| 8 | lint                      | `deno lint` passes with no errors                                                                                                 |
