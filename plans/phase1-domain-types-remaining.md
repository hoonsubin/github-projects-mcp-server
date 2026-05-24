# Phase 1: Domain Types — Remaining Tasks

**Status:** P0 (Adapter Infrastructure) fully complete. P1 (Domain Types) ~80% done — most new types were already added to `src/domain/types.ts`. This plan covers the remaining cleanup.

---

## Current State Assessment

### ✅ Already Done (P0 — Adapter Infrastructure)

| File                               | Status   |
| ---------------------------------- | -------- |
| `src/adapters/capabilities.ts`     | Complete |
| `src/adapters/abstract-backend.ts` | Complete |
| `src/adapters/factory.ts`          | Complete |

### ✅ Already Done (P1 — Domain Types Added)

| Type                                                                   | Status   |
| ---------------------------------------------------------------------- | -------- |
| `ItemRef` / `ResolvedRef` + `isResolvedRef()` guard                    | ✅ Added |
| `ITEM_TYPES` const tuple + `ItemType` union                            | ✅ Added |
| `IssueKey` + `toIssueKey()`                                            | ✅ Added |
| `ScrumTemplateUri`                                                     | ✅ Added |
| `TemplateUriMap`                                                       | ✅ Added |
| `SprintContext` + `SprintRiskStance` + `sprintContextFromSprintInfo()` | ✅ Added |
| `EpicSummary`                                                          | ✅ Added |
| `BacklogHealth`                                                        | ✅ Added |
| `ItemListing`                                                          | ✅ Added |
| `DependencyNode` + `DependencyMap`                                     | ✅ Added |
| `ItemSearchResult`                                                     | ✅ Added |
| `AnalyticsResult`                                                      | ✅ Added |
| `ItemDetailResult`                                                     | ✅ Added |
| `OrientResult` (exported)                                              | ✅ Added |
| `StoryNotFoundError` in `errors.ts`                                    | ✅ Added |
| `ArtifactType` moved to `config.ts`                                    | ✅ Added |

### ⚠️ Remaining P1 Work

| # | Task                                  | File                                  | Details                                                                                 |
| - | ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| 1 | Delete `TemplateResponse` dead type   | `src/domain/types.ts` (lines 517–535) | Deprecated type, no consumers after `scrum_get_template` removal                        |
| 2 | Fix `DependencyEntry.ref` nullability | `src/domain/types.ts` (line 92)       | Change `{ id: string \| null }` to `ResolvedRef` (`{ id: string }`), then fix consumers |
| 3 | **Verification gate**                 | —                                     | `deno lint && deno test && deno check src/index.ts`                                     |

---

## Detailed Task Breakdown

### Task 1: Delete `TemplateResponse`

**File:** `src/domain/types.ts` (lines 517–535)

**What to do:**

- Remove the entire `TemplateResponse` type (lines 517–535)
- Update the deprecation comment if needed

**Impact:** Zero — `TemplateResponse` is marked `@deprecated` and has no consumers.

---

### Task 2: Fix `DependencyEntry.ref` nullability

**File:** `src/domain/types.ts` (line 92)

**Change:**

```diff
- ref: { id: string | null };
+ ref: ResolvedRef;
```

**Rationale:** The `DependencyEntry.ref.id` nullability was an acknowledged bug. All new types (`ItemListing`, `DependencyNode`, `ItemSearchResult`) use the non-null pattern. Making `id` non-null aligns `DependencyEntry` with `ResolvedRef`.

**Impact:** Code that accesses `dependency.ref.id` without narrowing still works (type narrows from `string | null` to `string`). Code that explicitly checks for `null` will need removal of the null check.

**Files that reference `DependencyEntry.ref.id`:**

- `src/scrum/ports.ts` — `StoryListing` uses `DependencyEntry[]` (will need type update in P2)
- `src/adapters/github/mappers.ts` — constructs `DependencyEntry` objects (may set `id: null`)
- `src/adapters/github/internal/story-query-service.ts` — constructs `DependencyEntry` objects

---

### Task 3: Verification Gate

```bash
deno lint
deno test
deno check src/index.ts
grep -r "import.*from.*adapters/github" src/scrum/ src/domain/ src/schemas/
```

---

## Risk Mitigation

| Risk                                                           | Mitigation                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `DependencyEntry.ref.id` becomes non-null, breaks adapter code | Fix adapter `mappers.ts` and `story-query-service.ts` to not set `null` |
| `TemplateResponse` removal breaks an import path               | No consumers — confirmed by grep                                        |
| Compile errors in P1-P2 boundary                               | P1 is additive only; `StoryRef` union change (`ItemRef`) deferred to P2 |
