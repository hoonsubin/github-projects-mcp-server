# Sprint 3 — Remaining Items Implementation Strategy

**Sprint ends:** 2026-06-01 (1 day remaining)\
**Total SP remaining:** 4\
**Items:** 3 independent bugs, zero shared files, zero merge conflicts

---

## Execution Order

| Order | #        | Title                                   | SP | File Changes      | Risk                          |
| ----- | -------- | --------------------------------------- | -- | ----------------- | ----------------------------- |
| 1     | **#223** | `.or(z.null())` → `.nullable()`         | 1  | 1 file, 1 line    | None                          |
| 2     | **#221** | `getEpics("current")` → `getEpics()`    | 2  | 1 file, 1 line    | Low — output change expected  |
| 3     | **#215** | Backlog scope terminal-status exclusion | 1  | 2 files (+1 test) | Low — well-understood pattern |

All three can be implemented in a single code session in order. Each builds on no prior change.

---

## Item #223 — EpicRefSchema .or(z.null()) → .nullable()

### Description

`scrum_update_story` rejects `epic: { id: "..." }` because `EpicRefSchema.or(z.null())` produces a JSON Schema `anyOf` that the MCP SDK mis-serializes, coercing the object to string.

### File Change

[`src/schemas/scrum.ts:303-305`](src/schemas/scrum.ts:303)

**Before:**

```ts
epic: EpicRefSchema
  .or(z.null())
  .optional();
```

**After:**

```ts
epic: EpicRefSchema
  .nullable()
  .optional();
```

### Why This Works

Zod's `.nullable()` produces `{ type: ["object", "null"] }` in JSON Schema, which the MCP SDK preserves correctly. The `.or(z.null())` alternative produces a `ZodUnion` → JSON Schema `anyOf: [{...}, {type: "null"}]`, which triggers the SDK's coercion to string.

### Verification

```bash
deno lint                          # No regressions
deno fmt --check                   # Format check
deno task test                     # All existing tests pass, especially schemas
```

### Acceptance Criteria Checklist

- [ ] `scrum_update_story({ ref: { id: "..." }, epic: { id: "..." } })` succeeds
- [ ] `scrum_update_story({ ref: { id: "..." }, epic: null })` succeeds (detaches)
- [ ] `epic` omitted leaves existing epic unchanged
- [ ] `scrum_create_story` epic behaviour unaffected (it uses `EpicRefSchema.optional()` — no change)

---

## Item #221 — scrum_orient getEpics("current") → getEpics()

### Description

[`orient.ts:71`](src/scrum/orient.ts:71) passes `"current"` to `backend.getEpics("current")`. The adapter's [`epic-service.ts:36-63`](src/adapters/github/internal/epic-service.ts:36) treats any truthy value as a sprint filter, collecting only epic IDs from items IN the current sprint. Epics with zero sprint-assigned items are silently omitted, but `total_count` reports all milestones.

### Fix: Use-case layer ([`src/scrum/orient.ts:71`](src/scrum/orient.ts:71))

**Before:**

```ts
() => backend.getEpics("current"),
```

**After:**

```ts
() => backend.getEpics(),
```

### Why This Fix is Correct

- The port signature: `getEpics(sprintIterationId?: string | null): Promise<EpicListing[]>`
- Passing no argument → `undefined` → falsy → adapter's early-return at epic-service.ts:39 returns ALL milestones unfiltered
- Downstream at orient.ts:76-78, `activeEpics` already filters `epic.status !== "done"` — so closed milestones remain excluded
- The `total_count` will now correctly match the returned list count

### Impact on orient Response

- **Before:** 4 epics returned, `total_count: 6` (mismatch)
- **After:** 6 epics returned, `total_count: 6` (exact match) — the **Adapter Layer Assembly Pattern** epic and any other backlog-only epic become visible

### Verification

```bash
deno lint
deno fmt --check
deno task test                     # orient-related tests pass
# Manual: call scrum_orient and verify total_count matches active epics count
```

### Acceptance Criteria Checklist

- [ ] `scrum_orient` returns all open epics in `platform_state.epics.active`
- [ ] `total_count` matches actual number of listed epics
- [ ] Epics with only backlog items (no sprint-assigned items) are included
- [ ] Done/closed epics remain excluded (handled by `activeEpics` filter at orient.ts:76-78)
- [ ] No regression on orient response time

---

## Item #215 — Backlog Scope Terminal-Status Exclusion

### Description

`scrum_find_items({ scope: "backlog" })` returns Done items with no sprint assignment, contaminating grooming queries.

### Current Code

[`src/adapters/github/internal/item-filter.ts:54-56`](src/adapters/github/internal/item-filter.ts:54):

```ts
if (!hasKeys) {
  if (filter.scope === "sprint" && story.sprint === null) return false;
  if (filter.scope === "backlog" && story.sprint !== null) return false;
}
```

### Root Cause

The backlog scope predicate only checks `story.sprint !== null`. A Done item with `story.sprint === null` (completed and in backlog, or never sprint-assigned) passes through. No terminal-status check exists in any scope filter.

### Design: Terminal-Status Helper

**Location:** [`src/adapters/github/internal/item-filter.ts`](src/adapters/github/internal/item-filter.ts) (same file, as module-level function)

The `buildItemFilterFn` already receives `config: GitHubBootState` which provides:

- `config.ghConfig.status_display` — e.g. `{ "done": "Done", "in_progress": "In Progress" }`
- `config.scrumConfig.scrum.status` — e.g. `{ "done": { terminal: true, blocking: false } }`

**Add before the `return` statement (line 49):**

```ts
// Build reverse map: display name → canonical key, for terminal-status lookup
const displayToCanonical = new Map<string, string>();
for (const [canonical, display] of Object.entries(config.ghConfig.status_display ?? {})) {
  displayToCanonical.set(display, canonical);
}

// Pre-compute set of terminal status display names
const terminalStatuses = new Set<string>();
for (const [canonical, semantics] of Object.entries(config.scrumConfig.scrum.status)) {
  if (semantics.terminal && config.ghConfig.status_display[canonical]) {
    terminalStatuses.add(config.ghConfig.status_display[canonical]);
  }
}
```

### The Filter Change

**Insert after line 56** (after the existing backpack scope check, before the `sprintItemIds` check):

```ts
// When no explicit statuses filter is provided, exclude terminal-status items
// from backlog scope to avoid contamination with Done items.
if (
  filter.scope === "backlog" &&
  statusSet === null &&
  story.status !== null &&
  terminalStatuses.has(story.status)
) {
  return false;
}
```

**Important:** `statusSet === null` means `filter.statuses.length > 0` is false — i.e., the caller did NOT explicitly pass `statuses`. This satisfies AC #2: passing `statuses: ["Done"]` with `scope: "backlog"` still returns Done items.

### Test Updates

[`src/adapters/github/internal/item-filter.test.ts`](src/adapters/github/internal/item-filter.test.ts)

Add these test cases:

1. **`scope=backlog excludes Done items by default`**
   - Filter with `scope: "backlog"`
   - Assert that no items with `story.status === "Done"` are returned
   - (Even if they have `story.sprint === null`)

2. **`scope=backlog with explicit statuses includes Done items`**
   - Filter with `scope: "backlog", statuses: ["Done"]`
   - Assert Done no-sprint items ARE returned (explicit override)

3. **`scope=all is unaffected by terminal-status exclusion`**
   - Filter with `scope: "all"`
   - Assert Done items with no sprint ARE returned (scope=all has no terminal exclusion)

### Verification

```bash
deno lint
deno fmt --check
deno task test                     # item-filter tests + all others pass
```

### Acceptance Criteria Checklist

- [ ] `scrum_find_items({ scope: "backlog" })` returns no Done-status items by default
- [ ] `scrum_find_items({ scope: "backlog", statuses: ["Done"] })` returns Done no-sprint items (explicit override)
- [ ] `scope: "all"` behaviour is unchanged
- [ ] Existing backlog filter tests pass

---

## Dependency Graph

```
#223 (schemas/scrum.ts)
  │
  ├── No dependency on #221 or #215
  │
#221 (scrum/orient.ts)
  │
  ├── No dependency on #223 or #215
  │
#215 (adapters/github/internal/item-filter.ts)
  │
  ├── No dependency on #223 or #221
```

All three items are **independent** — they can be implemented in any order or even in parallel.

---

## Handoff to Code Mode

The implementation can be delegated as a single code-mode task with the todo list below, or split into three separate tasks (one per item) for parallel execution. Given the small scope of each, a single task is recommended.

```markdown
[x] Implement #223: Change .or(z.null()).optional() to .nullable().optional() in schemas/scrum.ts [x] Implement #221: Change backend.getEpics("current") to backend.getEpics() in orient.ts [x] Implement #215: Add terminal-status exclusion to backlog scope in item-filter.ts + tests [x] Verify: deno lint, deno fmt --check, deno task test all pass
```

---

## Rollback Plan

Since each fix is in a separate file with a single-line change (or a small block for #215), rollback is trivial:

- **#223**: Revert the 1-line change in `schemas/scrum.ts`
- **#221**: Revert the 1-line change in `orient.ts`
- **#215**: Revert the block addition in `item-filter.ts` and the new tests in `item-filter.test.ts`
