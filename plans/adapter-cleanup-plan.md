# Adapter Layer Cleanup Plan

## Overview

Remove dead code and update stale comments in the adapter layer. The primary target is the `resolveOrCreateMilestoneNodeId` method and its dependency chain, which was explicitly marked dead after the EpicRef migration. Secondary targets are stale TODO comments and an unused function parameter.

---

## Item 1 — Remove dead code from `user-milestone-resolver.ts`

**Location:** [`src/adapters/github/internal/user-milestone-resolver.ts:99-122`](src/adapters/github/internal/user-milestone-resolver.ts:99)

**What to do:** Remove the dead method `resolveOrCreateMilestoneNodeId` and its supporting internal types.

**Rationale:** The method is explicitly tagged `// TODO: dead after EpicRef migration - remove in follow-up.` Epic refs now pass `MI_` node IDs directly, so title-to-ID resolution via the GitHub Milestones API is never needed.

**Remove these items:**

| Item                                    | Lines  | Description                                       |
| --------------------------------------- | ------ | ------------------------------------------------- |
| `MilestoneNode` interface               | 27     | `interface MilestoneNode extends MilestoneRef {}` |
| `ListMilestonesResponse` interface      | 29-35  | Response shape for milestone listing query        |
| `CreateMilestoneResponse` interface     | 37-42  | Response shape for milestone creation mutation    |
| `resolveOrCreateMilestoneNodeId` method | 99-122 | The dead method + its TODO comment                |

**Keep:**

- `UserMilestoneResolver` class constructor and fields — still used by `resolveUserNodeId` and `resolveUserNodeIds`
- `resolveUserNodeId` — used by `FieldValueMutator`
- `resolveUserNodeIds` — used by `StoryMutationService`
- `GetUserNodeIdResponse` / `AuthorRef` types — still needed for `resolveUserNodeId`
- `GET_USER_NODE_ID` import — still needed

---

## Item 2 — Remove orphaned imports from `user-milestone-resolver.ts`

**Location:** [`src/adapters/github/internal/user-milestone-resolver.ts:12-16`](src/adapters/github/internal/user-milestone-resolver.ts:12)

**What to do:** Remove the now-unused imports for `CREATE_MILESTONE_MUTATION` and `GET_USER_MILESTONES_QUERY`. Remove the `MilestoneRef` type import from `../types.ts` (this is distinct from the `MilestoneRef` in `domain/types.ts` but no longer used here).

**Remove from imports:**

- `CREATE_MILESTONE_MUTATION`
- `GET_USER_MILESTONES_QUERY`
- `MilestoneRef` (from `../types.ts`)

**Keep:** `GET_USER_NODE_ID`

---

## Item 3 — Remove orphaned query constants from `queries.ts`

**Location:** [`src/adapters/github/queries.ts:130,155`](src/adapters/github/queries.ts:130)

**What to do:** Remove the query constants that were only referenced by the deleted method. Also remove the `GetUserProjectItems` startup-validation-only call.

**Remove these items:**

| Item                                                  | Line | Description                                     |
| ----------------------------------------------------- | ---- | ----------------------------------------------- |
| `getQuery("GetUserProjectItems");`                    | 111  | Startup validation only, not imported elsewhere |
| `GET_USER_MILESTONES_QUERY`                           | 130  | Only imported by user-milestone-resolver.ts     |
| `CREATE_MILESTONE_MUTATION`                           | 155  | Only imported by user-milestone-resolver.ts     |
| Comment section header `// ── Milestone mutations ──` | 154  | Now empty section                               |

**Keep:**

- The section header `// ── Repository and user lookups ──` — still has `GET_REPO_QUERY`

---

## Item 4 — Remove orphaned GraphQL operations from `operations.graphql`

**Location:** [`src/adapters/github/operations.graphql:708-718,860-868`](src/adapters/github/operations.graphql:708)

**What to do:** Remove the two GraphQL operations that are only consumed by the orphaned query constants.

**Remove these operations:**

| Operation                  | Lines   | Description                  |
| -------------------------- | ------- | ---------------------------- |
| `GetUserMilestones` query  | 708-718 | Milestone title-to-ID lookup |
| `CreateMilestone` mutation | 860-868 | Milestone creation           |

Also remove the section headers:

```
# ── GetUserMilestones ──────────────────────────────────────────
```

```
# ══════════════════════════════════════════════════════════════
# MUTATIONS - Milestone management
# ══════════════════════════════════════════════════════════════
```

---

## Item 5 — Remove orphaned test code from `user-milestone-resolver.test.ts`

**Location:** [`src/adapters/github/internal/user-milestone-resolver.test.ts:28-71,351-519`](src/adapters/github/internal/user-milestone-resolver.test.ts:28)

**What to do:** Remove all test fixtures and test cases related to the dead method.

**Remove these items:**

| Item                                      | Lines   | Description                              |
| ----------------------------------------- | ------- | ---------------------------------------- |
| `MILESTONES_FOUND` fixture                | 28-35   | GraphQL response with milestones         |
| `MILESTONES_EMPTY` fixture                | 37-44   | Empty milestones                         |
| `MILESTONES_NULL` fixture                 | 46-51   | Null milestones                          |
| `MILESTONES_UNDEF` fixture                | 53-56   | Undefined repository                     |
| `MILESTONE_CREATED` fixture               | 58-63   | Successful creation                      |
| `MILESTONE_CREATE_NULL` fixture           | 65-66   | Null create mutation                     |
| `MILESTONE_CREATE_MILESTONE_NULL` fixture | 68-71   | Null milestone in response               |
| Group C section header                    | 351-353 | `resolveOrCreateMilestoneNodeId` section |
| Test: exact match                         | 355-367 |                                          |
| Test: case-insensitive                    | 370-381 |                                          |
| Test: variable passing                    | 384-394 |                                          |
| Test: creates when not found              | 397-409 |                                          |
| Test: title/repositoryId passed           | 412-425 |                                          |
| Test: null milestones                     | 428-441 |                                          |
| Test: missing repository                  | 444-457 |                                          |
| Test: null createMilestone                | 460-472 |                                          |
| Test: null milestone in create            | 475-487 |                                          |
| Test: fetchRepoNodeId failure             | 490-517 |                                          |

**Update:** The file-level comment on line 4-5 still says "and resolveOrCreateMilestoneNodeId" — update to only list `resolveUserNodeId` and `resolveUserNodeIds`.

---

## Item 6 — Update stale TODO comment in `types.ts`

**Location:** [`src/adapters/github/types.ts:267-268`](src/adapters/github/types.ts:267)

**Current content:**

```typescript
// TODO: replace with a proper discriminated union aligned to the per-type
// generated interfaces once extractBoardFields is refactored.
```

**What to do:** This TODO references `extractBoardFields` being refactored as a precondition, but `extractBoardFields` is actively used in 4 locations and the `ItemFieldValue` interface is stable. Either:

- **Option A (preferred):** Remove the TODO entirely — the `ItemFieldValue` interface with flat optional fields works correctly and is not a priority refactor target.
- **Option B:** Update the TODO to be more specific and drop the stale reference to `extractBoardFields`:
  ```typescript
  // TODO: replace ItemFieldValue with a discriminated union keyed by __typename
  // once field iteration is extracted into a dedicated function.
  ```

**Recommendation:** Option A — the flat interface pattern is common and maintainable.

---

## Item 7 — Clean up unused `_fileReader` parameter in `scrum-read.ts`

**Location:** [`src/tools/scrum-read.ts:43`](src/tools/scrum-read.ts:43)

**Current content:**

```typescript
_fileReader: FileReaderPort | null,
```

**What to do:** Remove the unused underscore-prefixed parameter. The `registerScrumReadTools` function accepts `_fileReader` but never references it. This violates Clean Code principle of no unused parameters.

**Changes needed:**

1. Remove `_fileReader: FileReaderPort | null` from [`scrum-read.ts:43`](src/tools/scrum-read.ts:43)
2. Remove `import type { FileReaderPort } from "../scrum/ports.ts";` from [`scrum-read.ts:8`](src/tools/scrum-read.ts:8) (if no other usage)
3. Remove the null argument at the call site in [`server.ts`](src/server.ts) — need to verify the call site

**Note:** Verify the call site in `server.ts` or wherever `registerScrumReadTools` is invoked. The parameter may need to be removed from the call as well.

---

## Execution Order

The items must be executed in this order because later items depend on earlier ones (e.g., removing the query constant before the GraphQL operation is fine, but the reverse order would leave a dangling reference).

| Step | Item                            | Files Modified                    | Risk                                     |
| ---- | ------------------------------- | --------------------------------- | ---------------------------------------- |
| 1    | Remove dead method + types      | `user-milestone-resolver.ts`      | Low — method is explicitly dead          |
| 2    | Remove orphaned imports         | `user-milestone-resolver.ts`      | Low — follows step 1                     |
| 3    | Remove orphaned query constants | `queries.ts`                      | Low — only imported by deleted code      |
| 4    | Remove orphaned GraphQL ops     | `operations.graphql`              | Low — only consumed by deleted constants |
| 5    | Remove orphaned test code       | `user-milestone-resolver.test.ts` | Low — tests for deleted method           |
| 6    | Update stale TODO               | `types.ts`                        | Trivial — comment only                   |
| 7    | Clean up unused parameter       | `scrum-read.ts`, `server.ts`      | Low — parameter is unused                |

---

## Verification Checklist

After all items are applied, verify:

- [ ] `deno lint` passes (no dangling imports or unused variables)
- [ ] `deno task test` passes (no broken references to deleted fixtures)
- [ ] No `import` statements reference `GET_USER_MILESTONES_QUERY` or `CREATE_MILESTONE_MUTATION`
- [ ] No `import` statements reference the deleted types (`CreateMilestoneResponse`, etc.)
- [ ] `operations.graphql` has no references to `GetUserMilestones` or `CreateMilestone`
- [ ] `registerScrumReadTools` accepts one fewer parameter (`FileReaderPort` removed)
