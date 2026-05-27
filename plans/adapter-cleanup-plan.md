# Tech Debt #176 — Implementation Plan: Remove Dead Code and Stale Comments in GitHub Adapter Layer After EpicRef Migration

## Summary

Seven cleanup items across five files, all in the adapter layer. No domain/port boundary changes — purely dead code removal verified by compile-time checks (`deno lint`, `deno test`).

## Pre-Implementation Verification

Before touching any file, confirm:

- `deno lint` passes on clean `main`
- `deno task test` passes on clean `main`

## Implementation Steps

### Step 1: Remove dead method + internal types from `user-milestone-resolver.ts`

**File:** [`src/adapters/github/internal/user-milestone-resolver.ts`](src/adapters/github/internal/user-milestone-resolver.ts)

Remove the following:

| Lines  | What                                                  | Why                                               |
| ------ | ----------------------------------------------------- | ------------------------------------------------- |
| 99–122 | `resolveOrCreateMilestoneNodeId` method body          | Dead — Epic refs now pass `MI_` node IDs directly |
| 99–100 | `// TODO: dead after EpicRef migration` comment block | No longer relevant                                |
| 27     | `interface MilestoneNode extends MilestoneRef {}`     | Only used by the dead method                      |
| 29–35  | `interface ListMilestonesResponse`                    | Only used by the dead method                      |
| 38–42  | `interface CreateMilestoneResponse`                   | Only used by the dead method                      |
| 45     | `type AuthorRef = UserLogin`                          | Never referenced anywhere                         |

**Imports to change:**

| Current                                                                                                  | Change to                                          |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `import { CREATE_MILESTONE_MUTATION, GET_USER_MILESTONES_QUERY, GET_USER_NODE_ID } from "../queries.ts"` | `import { GET_USER_NODE_ID } from "../queries.ts"` |
| `import type { MilestoneRef, UserLogin } from "../types.ts"`                                             | `import type { UserLogin } from "../types.ts"`     |

**File-level comment on line 4:** Update from `"manage resolution of GitHub users and milestones"` to `"manage resolution of GitHub users"` since milestone resolution is being removed.

---

### Step 2: Remove orphaned query constants from `queries.ts`

**File:** [`src/adapters/github/queries.ts`](src/adapters/github/queries.ts)

| Lines | What                                                                                  | Why                                                     |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 111   | `getQuery("GetUserProjectItems"); // startup validation only; not imported elsewhere` | Dead — never exported, only used for startup validation |
| 130   | `export const GET_USER_MILESTONES_QUERY = getQuery("GetUserMilestones");`             | Only consumer was the dead method in Step 1             |
| 155   | `export const CREATE_MILESTONE_MUTATION = getQuery("CreateMilestone");`               | Only consumer was the dead method in Step 1             |

**Section header to remove:** Lines 154 (comment `// ── Milestone mutations ──`). The remaining line 153 becomes part of the Comment mutations section — adjust accordingly, or simply remove lines 153–155 together.

---

### Step 3: Remove orphaned GraphQL operations from `operations.graphql`

**File:** [`src/adapters/github/operations.graphql`](src/adapters/github/operations.graphql)

| Lines   | What                                                                                            | Why                                                            |
| ------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 708–718 | `GetUserMilestones` query                                                                       | Only loaded by `GET_USER_MILESTONES_QUERY` (removed in Step 2) |
| 849–868 | Entire "MUTATIONS - Milestone management" section (`CreateMilestone` mutation + section header) | Only loaded by `CREATE_MILESTONE_MUTATION` (removed in Step 2) |

**Note:** The `QUERIES - Repository and user lookups` section (lines 697–718) also contains `GetRepo` (lines 701–706). Do NOT remove that section header or `GetRepo` — only remove lines 708–718 (the `GetUserMilestones` query block including its section comment on 708–710).

---

### Step 4: Remove orphaned test code from `user-milestone-resolver.test.ts`

**File:** [`src/adapters/github/internal/user-milestone-resolver.test.ts`](src/adapters/github/internal/user-milestone-resolver.test.ts)

**Remove 7 fixtures (lines 29–71):**

| Fixture                           | Lines |
| --------------------------------- | ----- |
| `MILESTONES_FOUND`                | 29–35 |
| `MILESTONES_EMPTY`                | 37–44 |
| `MILESTONES_NULL`                 | 46–51 |
| `MILESTONES_UNDEF`                | 53–56 |
| `MILESTONE_CREATED`               | 58–63 |
| `MILESTONE_CREATE_NULL`           | 65–66 |
| `MILESTONE_CREATE_MILESTONE_NULL` | 68–71 |

**Remove helper (lines 156–158):**

- `givenMilestoneNotFound` function — only used by the dead Group C tests

**Remove Group C section (lines 351–519):**

- All 13 test cases for `resolveOrCreateMilestoneNodeId` (named `resolveOrCreateMilestoneNodeId - ...`)

**Update file-level comment on lines 4–5:**

- From: `"Unit tests for UserMilestoneResolver: resolveUserNodeId, resolveUserNodeIds, and resolveOrCreateMilestoneNodeId."`
- To: `"Unit tests for UserMilestoneResolver: resolveUserNodeId and resolveUserNodeIds."`

---

### Step 5: Remove stale TODO from `types.ts`

**File:** [`src/adapters/github/types.ts`](src/adapters/github/types.ts)

**Remove lines 270–271:**

```
// TODO: replace with a proper discriminated union aligned to the per-type
// generated interfaces once extractBoardFields is refactored.
```

The surrounding `ItemFieldValue` interface (lines 312–338) remains as-is — the flat structural interface pattern is maintainable and no refactoring is planned.

---

### Step 6: Remove unused `_fileReader` parameter from `scrum-read.ts` + call site

**File:** [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts)

| Change  | Detail                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Line 8  | Remove `FileReaderPort` from the import: `import type { ProjectBackend } from "../scrum/ports.ts"` (was `{ FileReaderPort, ProjectBackend }`) |
| Line 43 | Remove `_fileReader: FileReaderPort                                                                                                           |

**File:** [`src/server.ts`](src/server.ts)

| Line | Change                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 277  | Change `registerScrumReadTools(server, backend, scrumConfig, fileReader)` → `registerScrumReadTools(server, backend, scrumConfig)` |

---

### Step 7: Verification

Run in order:

1. **`deno fmt`** — ensure all modified files are consistently formatted
2. **`deno lint`** — must pass (no dangling imports, no unused variables). This catches:
   - Any remaining references to `GET_USER_MILESTONES_QUERY`, `CREATE_MILESTONE_MUTATION`
   - Any remaining references to deleted types (`MilestoneRef`, `CreateMilestoneResponse`, etc.)
   - Any remaining references to `FileReaderPort` in the scrum-read import
   - Any remaining references to `AuthorRef`
3. **`deno task test`** — must pass (no broken references to deleted fixtures). Key tests:
   - `user-milestone-resolver.test.ts` — Groups A and B must still pass (12 tests remaining after removing 13 from Group C)
   - All other test suites must remain unaffected

## Files Modified

| # | File                                                           | Layer       | Change type                                               |
| - | -------------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| 1 | `src/adapters/github/internal/user-milestone-resolver.ts`      | Adapter     | Remove dead method + internal types + orphaned imports    |
| 2 | `src/adapters/github/queries.ts`                               | Adapter     | Remove orphaned query constants + dead startup validation |
| 3 | `src/adapters/github/operations.graphql`                       | Adapter     | Remove orphaned GraphQL operations                        |
| 4 | `src/adapters/github/internal/user-milestone-resolver.test.ts` | Adapter     | Remove orphaned test fixtures + 13 test cases             |
| 5 | `src/adapters/github/types.ts`                                 | Adapter     | Remove stale TODO comment                                 |
| 6 | `src/tools/scrum-read.ts`                                      | Framework   | Remove unused `_fileReader` parameter                     |
| 7 | `src/server.ts`                                                | Entry point | Update call site for Step 6                               |

## Acceptance Criteria Mapping

| AC                                                                                 | How verified                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `deno lint` passes                                                                 | Step 7.2 — lint catches dangling imports, unused vars |
| `deno task test` passes                                                            | Step 7.3 — test suite confirms no broken references   |
| No imports reference `GET_USER_MILESTONES_QUERY` or `CREATE_MILESTONE_MUTATION`    | Step 7.2 — lint + grep-verified by Step 2 removal     |
| No imports reference deleted types                                                 | Step 7.2 — TypeScript compiler catches this via lint  |
| `operations.graphql` has no references to `GetUserMilestones` or `CreateMilestone` | Step 3 — manually verified in the diff                |
| `registerScrumReadTools` accepts one fewer parameter                               | Step 6 — function signature change in `scrum-read.ts` |
