# Phase 6: Redesign scrum_get_history — Implementation Plan

## Overview

Phase 6 redesigns `scrum_get_history` to align its return shape with the canonical `SprintSnapshot` type from `ports.ts` and adds velocity statistics (`average_completed_points`). The schema (`GetHistorySchema`) is **unchanged** — `window` (1–10) already serves as the item count limit.

---

## Current State Analysis

### What Exists Today

| File                                                               | Current State                                                                                                                                                                                                                                                                                                                                                           | Gap vs. Phase 6 Target                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/scrum/get-history.ts`](src/scrum/get-history.ts)             | Defines **local** `SprintSnapshot` (lines 15–29) and `GetHistoryResult` (lines 31–35). Uses `s.status === "Done"` (case-sensitive) for done detection. Returns `{ window, sprints, message? }` with `summary` per sprint (committed/completed/carried/completion_rate/story_count/completed_count).                                                                     | **Must be fully replaced.** Local `SprintSnapshot` shadows canonical one from `ports.ts`. Return shape differs (has `summary` instead of `items`/`totals`/`impediments`). Missing `average_completed_points` at top level. |
| [`src/scrum/ports.ts`](src/scrum/ports.ts)                         | Canonical `SprintSnapshot` (lines 180–192) with `sprint`, `items`, `total_count`, `totals`, `impediments`. `SprintTotalsHistory` (lines 169–172) extends `SprintTotalsActive` with `committed_points` and `completed_points`. `StoryListing` (lines 134–142) with `writable` field. `SprintHistoryEntry` (lines 73–76) with `info` and `stories: BurndownStoryInput[]`. | **Already correct.** No changes needed to `ports.ts` for Phase 6.                                                                                                                                                          |
| [`src/domain/types.ts`](src/domain/types.ts)                       | `ImpedimentRef` (lines 26–28) already defined. `Story` (lines 44–60) with `key: string \| null`.                                                                                                                                                                                                                                                                        | **Already correct.** No changes needed.                                                                                                                                                                                    |
| [`src/schemas/scrum.ts`](src/schemas/scrum.ts)                     | `GetHistorySchema` (lines 140–150) with `window: 1–10, default 5`.                                                                                                                                                                                                                                                                                                      | **Already correct.** No changes needed per Step 6a.                                                                                                                                                                        |
| [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts)               | Handler at lines 72–104 calls `getHistoryUseCase(backend, scrumConfig, params.window)`. Description at lines 78–84 says "Returns: array of sprint snapshots" — vague.                                                                                                                                                                                                   | **Handler body unchanged.** Only description needs updating per Step 6c.                                                                                                                                                   |
| [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts) | `getCompletedSprintHistory()` (lines 195–247) returns `SprintHistoryEntry[]` with `BurndownStoryInput[]` stories. Uses `statusName === doneDisplay` (case-sensitive string match). Does **not** populate `id` on `BurndownStoryInput`.                                                                                                                                  | **No changes needed for Phase 6.** The adapter already returns the right shape. The `id` field is out of scope (Phase 4b/5).                                                                                               |

### Dependency Verification

Phase 6 depends on:

- **Phase 2** (finished): `GitHubApiError` in `adapters/github/errors.ts`
- **Phase 3** (finished): `enrichError` in `tools/error-formatter.ts` — but current code still imports from `services/error-enrichment.ts`
- **Phase 4** (partially done): Canonical `SprintSnapshot`, `StoryListing`, `SprintTotalsHistory` exist in `ports.ts`. **However**, the local `SprintSnapshot` in `get-history.ts` has **not** been removed yet (Phase 4d not completed).

---

## Clean Code Review Findings

The following issues were identified during structural diagnosis of the plan against the actual codebase.

### Issue F1: `days_remaining` Inconsistency Between History and Active Snapshots

**Problem:** In [`get-sprint.ts` line 159](src/scrum/get-sprint.ts:159), the "all" branch sets `days_remaining: 0` for completed history sprints. The Phase 6 plan uses `null`. This creates an inconsistency: the same completed sprint will have different `days_remaining` values depending on whether it's fetched via `scrum_get_history` (null) or `scrum_get_sprint` with `sprint: "all"` (0).

**Resolution:** Phase 6 uses `days_remaining: null` which is semantically more accurate (no remaining days to compute). The `get-sprint.ts` "all" branch should also use `null` — but that is a Phase 5 follow-up, not Phase 6 scope. Documented as a known inconsistency in the Risk Assessment table.

### Issue F2: `entryToSnapshot` Does Too Much — SRP Violation

**Problem:** The original plan had `entryToSnapshot` at ~40 lines performing three distinct operations: (1) project `BurndownStoryInput[]` to `StoryListing[]`, (2) compute `by_status` counts, (3) compute `committed_points` and `completed_points`. This violates SRP.

**Resolution:** Split into three functions:

- `projectStoriesToListings(stories, sprintName)` — handles the mapping (< 15 lines)
- `computeTotals(stories)` — handles the aggregation (< 15 lines)
- `entryToSnapshot(entry)` — orchestrates the two above (< 15 lines)

Each function is independently testable.

### Issue F3: Handler Description Uses TypeScript Type Names — Agents Cannot Read Them

**Problem:** MCP tool descriptions are read by LLM agents, not TypeScript compilers. Agents cannot resolve `SprintSnapshot` to the `ports.ts` type definition.

**Resolution:** Replace type name references with actual JSON shapes in the handler description.

### Issue F4: `by_status` Computation Is Duplicated Between `get-sprint.ts` and `get-history.ts`

**Problem:** The `by_status` computation pattern is duplicated across `get-sprint.ts` (lines 67–71) and `get-history.ts`.

**Resolution:** Documented as a follow-up item. Extract `computeByStatus` to a shared utility in a future phase. For Phase 6, keep the duplication with a TODO comment.

### Issue F5: `ref.id = ""` for History Items — Write Tool Safety Gap

**Problem:** The adapter does not populate `id` on `BurndownStoryInput`. An agent passing `{ ref: { id: "" } }` to a write tool will fail with an unclear error from `resolver.ts`.

**Resolution:** Document explicitly in the handler description that history items have empty `ref.id` and cannot be used with write tools.

---

## Implementation Tasks

### Task 6.1: Remove Local Types from `get-history.ts` and Import Canonical Types

**File:** [`src/scrum/get-history.ts`](src/scrum/get-history.ts)

**Changes:**

1. Delete local `interface SprintSnapshot` (lines 15–29)
2. Delete local `interface GetHistoryResult` (lines 31–35)
3. Delete the stale comment block (lines 11–13)
4. Update imports to include canonical types from `ports.ts`:

```typescript
// Replace current imports (lines 1–9):
// (entire file header and imports)

// With:
// src/scrum/get-history.ts — getHistoryUseCase
//
// Aligned with SprintSnapshot from ports.ts.
// Adds velocity statistics (average_completed_points).

import type { ProjectBackend, SprintHistoryEntry, SprintSnapshot, StoryListing } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
```

---

### Task 6.2: Rewrite `get-history.ts` Use Case Logic

**File:** [`src/scrum/get-history.ts`](src/scrum/get-history.ts)

**Replace the entire file content** with the Phase 6 target implementation:

```typescript
// src/scrum/get-history.ts — getHistoryUseCase
//
// Aligned with SprintSnapshot from ports.ts.
// Adds velocity statistics (average_completed_points).

import type { ProjectBackend, SprintHistoryEntry, SprintSnapshot, StoryListing } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";

// ── Return type ────────────────────────────────────────────────────────────────

interface GetHistoryResult {
  sprints: SprintSnapshot[];
  window: number;
  average_completed_points: number;
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Project BurndownStoryInput[] to StoryListing[] for history items.
 * All history items are marked writable: false (read-only).
 */
const projectStoriesToListings = (
  stories: SprintHistoryEntry["stories"],
  sprintName: string,
): StoryListing[] =>
  stories.map((s) => ({
    ref: { id: s.id ?? "", key: String(s.number) },
    title: s.title,
    status: s.status,
    story_points: s.points,
    priority: null, // BurndownStoryInput does not carry priority
    sprint: sprintName,
    writable: false, // history item — not safe to mutate
  }));

/**
 * Compute totals for a sprint's stories.
 * "Done" detection uses case-insensitive match on the status display name.
 * This is a pragmatic approximation until canonical status keys are available
 * via scrumConfig. Follow-up: replace with config-driven terminal status lookup.
 */
const computeTotals = (
  stories: SprintHistoryEntry["stories"],
): {
  by_status: Record<string, number>;
  committed_points: number;
  completed_points: number;
} => {
  const by_status: Record<string, number> = {};
  for (const s of stories) {
    const key = s.status ?? "(none)";
    by_status[key] = (by_status[key] ?? 0) + 1;
  }
  const committed_points = stories.reduce((sum, s) => sum + s.points, 0);
  const completed_points = stories
    .filter((s) => s.status?.toLowerCase() === "done")
    .reduce((sum, s) => sum + s.points, 0);
  return { by_status, committed_points, completed_points };
};

/**
 * Convert a completed SprintHistoryEntry to the canonical SprintSnapshot shape.
 */
const entryToSnapshot = (entry: SprintHistoryEntry): SprintSnapshot => {
  const items = projectStoriesToListings(entry.stories, entry.info.name);
  const { by_status, committed_points, completed_points } = computeTotals(
    entry.stories,
  );

  return {
    sprint: {
      name: entry.info.name,
      start_date: entry.info.startDate,
      end_date: entry.info.endDate,
      duration_days: entry.info.durationDays,
      days_remaining: null, // completed sprint — null is more accurate than 0
    },
    items,
    total_count: items.length,
    totals: {
      by_status,
      story_points: committed_points,
      committed_points,
      completed_points,
    },
    impediments: [], // enriched in Phase 7
  };
};

// ── Public use case ────────────────────────────────────────────────────────────

export const getHistoryUseCase = async (
  backend: ProjectBackend,
  _scrumConfig: ScrumConfig,
  window: number,
): Promise<GetHistoryResult> => {
  const entries = await backend.getCompletedSprintHistory(window);

  if (entries.length === 0) {
    return { sprints: [], window, average_completed_points: 0 };
  }

  const sprints = entries.map(entryToSnapshot);

  const totalCompleted = sprints.reduce(
    (sum, s) => sum + (s.totals.completed_points ?? 0),
    0,
  );
  const average_completed_points = Math.round((totalCompleted / sprints.length) * 100) / 100;

  return { sprints, window, average_completed_points };
};
```

**Key design decisions:**

| Decision                                        | Rationale                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Split `entryToSnapshot` into 3 functions        | Each function < 15 lines, SRP compliant, independently testable                                  |
| `projectStoriesToListings` is niladic in config | History items never carry priority; no config needed                                             |
| `computeTotals` returns a tuple-like object     | Avoids creating a named interface for a single-use return type                                   |
| `days_remaining: null` for completed sprints    | Semantically correct — no remaining days to compute. Aligns with `SprintSnapshot` type contract  |
| `ref.id = ""` for history items                 | Adapter does not populate `id` on `BurndownStoryInput` (Phase 4b). Documented as intentional gap |

---

### Task 6.3: Update `scrum_get_history` Handler Description

**File:** [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts)

**Change:** Update the `description` string in the `scrum_get_history` tool registration (lines 78–84).

**Current description:**

```
Return raw sprint snapshots for the last N completed sprints.

Use for velocity calculations, retrospective prep, and trend analysis. Each
snapshot includes sprint dates, committed vs. completed story points, and
per-story outcomes.

Args:
  window  integer 1-10, default 5 — how many completed sprints to look back

Returns: array of sprint snapshots ordered newest-first.
```

**New description (with JSON shapes, not TypeScript type names):**

```
Return sprint snapshots for the last N completed sprints, aligned with the
SprintSnapshot shape used by scrum_get_sprint.

Use for velocity calculations, retrospective prep, and trend analysis. Each
snapshot includes lightweight item listing (no body/comments), totals by
status, committed vs. completed story points, and velocity metrics.

Args:
  window  integer 1-10, default 5 — how many completed sprints to look back

Returns: {
  "sprints": [
    {
      "sprint": { "name": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "duration_days": number, "days_remaining": null },
      "items": [
        { "ref": { "id": string, "key": string|null }, "title": string, "status": string|null, "story_points": number|null, "priority": null, "sprint": string|null, "writable": false }
      ],
      "total_count": number,
      "totals": { "by_status": {string: number}, "story_points": number, "committed_points": number, "completed_points": number },
      "impediments": []
    }
  ],
  "window": number,
  "average_completed_points": number
}
Each sprint snapshot has totals.committed_points and totals.completed_points.
Items have ref.id for use in subsequent write calls (may be empty for history items).
Note: history items have empty ref.id and cannot be used with write tools.
```

**No changes needed to the handler body** (lines 93–103) — the call signature `getHistoryUseCase(backend, scrumConfig, params.window)` is unchanged.

---

## Verification Plan

| Test Case             | Input                                           | Expected Output                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty history         | `{ window: 5 }` with no completed sprints       | `{ sprints: [], window: 5, average_completed_points: 0 }`                                                                                                                                                                                                                            |
| Normal history        | `{ window: 3 }` with 3 completed sprints        | `{ sprints: [SprintSnapshot, SprintSnapshot, SprintSnapshot], window: 3, average_completed_points: <number> }`                                                                                                                                                                       |
| Each snapshot shape   | Inspect first sprint in response                | Has `sprint.name`, `sprint.start_date`, `sprint.end_date`, `sprint.duration_days`, `sprint.days_remaining: null`, `items: StoryListing[]`, `total_count: number`, `totals.by_status`, `totals.story_points`, `totals.committed_points`, `totals.completed_points`, `impediments: []` |
| Velocity accuracy     | Known sprints with 10 + 12 + 8 completed points | `average_completed_points: 10`                                                                                                                                                                                                                                                       |
| Window boundary       | `{ window: 1 }`                                 | Only 1 sprint returned                                                                                                                                                                                                                                                               |
| Window boundary       | `{ window: 10 }`                                | Up to 10 sprints returned                                                                                                                                                                                                                                                            |
| History item ref.id   | Inspect `items[0].ref.id`                       | Empty string `""` — documented gap, not a bug                                                                                                                                                                                                                                        |
| History item writable | Inspect `items[0].writable`                     | `false` — history items are read-only                                                                                                                                                                                                                                                |

---

## Risk Assessment

| Risk                                                                         | Mitigation                                                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `s.status?.toLowerCase() === "done"` may not match all terminal status names | Documented as pragmatic approximation. `_scrumConfig` is threaded for a future config-driven fix.                                                  |
| `ref.id = ""` for history items                                              | Documented as intentional. Handler description warns agents. Write tools receiving empty ID will fail at adapter with clear error.                 |
| `writable: false` on history items breaks consumers expecting `writable`     | All consumers should check `writable` before attempting mutations. History items are read-only by design.                                          |
| `impediments: []` is always empty                                            | Documented as out of scope for Phase 6. Will be populated by Phase 7 adapter work.                                                                 |
| `days_remaining: null` differs from `get-sprint.ts` "all" branch (`0`)       | Known inconsistency. `null` is semantically more correct for completed sprints. `get-sprint.ts` "all" branch should be fixed in Phase 5 follow-up. |

---

## Clean Code Verification

| Principle      | Verification                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| **SRP**        | Each helper function has one responsibility; no function exceeds 15 lines                                     |
| **DIP**        | Use case imports only `ProjectBackend` — no adapter imports                                                   |
| **ISP**        | `entryToSnapshot` calls only `backend.getCompletedSprintHistory()` (1 method)                                 |
| **DRY**        | `projectStoriesToListings` and `computeTotals` extracted; `by_status` duplication noted as TODO for Phase 5/6 |
| **Fail Early** | Empty history returns gracefully — no errors thrown                                                           |
| **Naming**     | `projectStoriesToListings`, `computeTotals`, `entryToSnapshot` — each describes intent clearly                |
| **Size**       | No function exceeds 15 lines; each helper is independently testable                                           |

---

## Files Modified

| File                                                   | Action                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [`src/scrum/get-history.ts`](src/scrum/get-history.ts) | **Rewrite** — remove local types, import canonical types, replace use case logic |
| [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts)   | **Edit** — update `scrum_get_history` description only (lines 78–84)             |

**No changes needed to:** `ports.ts`, `types.ts`, `schemas/scrum.ts`, `backend.ts`, or any other file.

---

## Follow-Up Items (Out of Phase 6 Scope)

| Item | Phase     | Description                                                                                                    |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------- |
| F1   | Phase 5   | Fix `get-sprint.ts` "all" branch `days_remaining: 0` → `null` for completed sprints                            |
| F2   | Phase 5/6 | Extract `computeByStatus` shared utility to eliminate duplication between `get-sprint.ts` and `get-history.ts` |
| F3   | Phase 7   | Adapter populates `BurndownStoryInput.id` so history items have valid `ref.id` for write tool safety           |
| F4   | Future    | Config-driven terminal status lookup (replace `"done"` string with `scrumConfig` lookup)                       |
