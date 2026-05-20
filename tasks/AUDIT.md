# Comprehensive Clean Code Audit Report

> **Date:** 2026-05-20
> **Verification:** All claims verified against actual codebase via file reads and import searches.

## Overall Assessment

The codebase exhibits a **well-structured**, clean three-layer architecture (Framework → Use-Case → Adapter) that generally adheres to SOLID principles and the Dependency Inversion Principle. The audit identified **16 claims**, resulting in **15 actionable findings** (1 falsified). The most critical architectural risk is a duplicated `parseDependencies` implementation between the domain and adapter layers, which poses a latent correctness threat due to divergent parsing logic.

---

## Architecture Adherence — What's Working

Before detailing findings, the following architectural strengths are confirmed:

1. **Interface Segregation Principle** — Ports are cleanly decomposed (`BacklogPort`, `SprintPort`, `StoryPort`, etc.) and use-cases import only what they need.
2. **Dependency Inversion** — `GitHubProjectBackend` is a facade delegating to injected services; the `ProjectBackend` interface lives in the use-case layer.
3. **Thin Handlers** — Tool handlers follow `parse → delegate → format` with no business logic.
4. **Strict Zod Schemas** — All schemas use `.strict()` with comprehensive `.describe()` annotations.
5. **Strong Error Design** — `GitHubApiError` carries code, recovery instructions, and structured context.
6. **Test Quality** — Tests are ISP-aligned, use focused mocks, and cover edge cases (empty history, partial failures, case-insensitive matching).

---

## Findings by Issue Type

### 🔴 Duplication (G5)

#### 1. Diverging `parseDependencies` Implementations
**Severity:** CRITICAL
**Files:** [`src/domain/rules/dependencies.ts:31`](src/domain/rules/dependencies.ts:31) (Domain) · [`src/adapters/github/mappers.ts:43`](src/adapters/github/mappers.ts:43) (Adapter)

Two implementations of `parseDependencies()` exist for the same domain concept but parse dependency sections differently:

- **Domain** (`dependencies.ts:31-64`): Parses `- #N Title` list items from `## Dependencies` section, with fallback to inline `Depends on #N` regex scanning.
- **Adapter** (`mappers.ts:43-66`): Parses `- Blocked by: #N` / `- Blocks: #N` lines from `## Dependencies` section, with **no fallback** to inline scanning.

The domain version is **never imported anywhere** (0 imports confirmed). The adapter version is the one actively used. This means `hasDependencySection()`, `generateDependencySection()`, and the domain's `parseDependencies()` are dead code.

**Risk:** Refactoring the adapter's parse logic in only one place could create silent bugs. The divergent formats mean a story with `- #17 Login` in `## Dependencies` would parse correctly in one code path but silently fail in another.

**Fix:** Consolidate into one canonical implementation. Since the adapter version implements the format described in [`tasks/REFACTORING.md:33-39`](tasks/REFACTORING.md:33-39) (`Blocked by:` / `Blocks:`), either remove the domain version entirely or make the adapter delegate to it.

---

#### 2. Identical `storyToListing` Functions
**Severity:** CRITICAL
**Files:** [`src/scrum/get-backlog.ts:31`](src/scrum/get-backlog.ts:31) · [`src/scrum/get-sprint.ts:29`](src/scrum/get-sprint.ts:29)

These are **character-for-character identical** (9 lines each) except for the import path for `StoryListing`.

**Fix:** Extract to a shared module (e.g., `src/scrum/story-listing.ts` or `sprint-math.ts`).

---

#### 3. Identical `assertNever` Functions
**Severity:** CRITICAL
**Files:** [`src/domain/errors.ts:20`](src/domain/errors.ts:20) · [`src/adapters/github/errors.ts:42`](src/adapters/github/errors.ts:42)

Identical except the error message phrasing (`"Unhandled variant"` vs `"Unhandled GitHubErrorCode"`).

**Fix:** Keep the domain version only; the adapter can import it.

---

#### 4. Scattered Date Math (G5 + G33)
**Severity:** HIGH
**Files:** [`src/scrum/sprint-math.ts:26-28`](src/scrum/sprint-math.ts:26) · [`src/scrum/sprint-math.ts:127-130`](src/scrum/sprint-math.ts:127) · [`src/adapters/github/mappers.ts:288-289`](src/adapters/github/mappers.ts:288)

Sprint date computation is duplicated in three places with slightly different implementations:

- `buildSprintMeta()`: Uses local-time `setDate`/`setHours`
- `buildSprintWindow()`: Uses UTC `setUTCDate`/`setUTCHours(0,0,0,0)`
- `toSprintInfo()`: Same logic again

The inconsistency between local-time and UTC methods could cause off-by-one errors around timezone boundaries.

**Fix:** Consolidate sprint date computation into a single function in `sprint-math.ts`, with `toSprintInfo()` and `buildSprintMeta()` delegating to it.

---

### 🔴 Layer Breaches & Wrong Abstraction (G6)

#### 5. Framework Imports Adapter Internals
**Severity:** CRITICAL
**File:** [`src/tools/scrum-write.ts:20`](src/tools/scrum-write.ts:20)

```typescript
import { graphql } from "../adapters/github/internal/http-client.ts";
```

This is a **direct layer breach** — the framework layer (`src/tools/`) should never import from `src/adapters/github/internal/`. The import is used by the deprecated `github_graphql` tool registered later in the file. Per the AGENT.md architecture diagram, the framework layer should only call use-case functions.

**Fix:** Move the `github_graphql` tool to the adapter layer, inject a `GraphQLExecutor` port through `ProjectBackend`, or remove the deprecated tool entirely (marked as deprecated in `inputs.ts:5`).

---

#### 6. Domain Rule Accesses Platform Config (G6 + G35)
**Severity:** CRITICAL
**File:** [`src/domain/rules/status.ts:21`](src/domain/rules/status.ts:21)

```typescript
const ghConfig = config.backends.github as Record<string, unknown>;
const statusDisplay = (ghConfig.status_display as Record<string, string>) ?? {};
```

The domain rules module accesses `config.backends.github`, a platform-specific field. The comment on line 13 explicitly admits this:

> "Resolves via scrum.status[terminal=true] → backends.github.status_display."

The domain layer should receive the resolved `status_display` mapping as a parameter rather than reaching into `backends.github` itself.

**Fix:** The use-case caller (`get-backlog.ts` or `get-history.ts`) should resolve the display mapping from config and pass it to `isTerminalStatus()` as an argument, keeping the domain function pure.

---

#### 7. Handler Bypasses Use-Case Layer
**Severity:** CRITICAL
**File:** [`src/tools/scrum-write.ts:506`](src/tools/scrum-write.ts:506) · [`src/scrum/update-impediment.ts`](src/scrum/update-impediment.ts)

The call chain for `scrum_update_impediment` **bypasses the use-case layer entirely**:

```
scrum-write.ts:506  →  backend.updateImpediment()        [calls ProjectBackend directly]
backend.ts:192      →  this.impedimentService.update...()  [adapter internal]
```

The handler never calls `updateImpedimentUseCase()`. This is both dead code (G9) and a layer breach (G6) — all other handlers follow the `handler → useCase → backend` pattern, but `scrum_update_impediment` skips the use case.

**Fix:** Either wire the handler through the use case (restoring the architecture), or delete the file and keep the direct backend call. Also audit other "%% Unused" markings in [`docs/proj-diagram.md:26-68`](docs/proj-diagram.md:26-68).

---

### 🟠 Dead Code (G9)

#### 8. `dependencies.ts` — Entire Module Unused
**Severity:** CRITICAL
**File:** [`src/domain/rules/dependencies.ts`](src/domain/rules/dependencies.ts)

All three exports (`parseDependencies`, `hasDependencySection`, `generateDependencySection`) are imported by **no other file** in the codebase (confirmed via regex search of `from.*dependencies`). They are dead code — the adapter uses its own `parseDependencies()` in `mappers.ts`.

**Fix:** Delete `src/domain/rules/dependencies.ts`.

---

#### 9. `update-impediment.ts` — Use Case Never Called
**Severity:** CRITICAL
**File:** [`src/scrum/update-impediment.ts`](src/scrum/update-impediment.ts)

The exported `updateImpedimentUseCase` is imported by **no other file** in the codebase. See Finding #7 for the call-chain analysis showing the handler bypasses this use case entirely.

**Fix:** See Finding #7.

---

### 🟠 Inline Multi-Language (G1)

#### 10. Inline GraphQL Mutations Across Adapter Files
**Severity:** HIGH
**Primary File:** [`src/adapters/github/internal/story-mutation-service.ts`](src/adapters/github/internal/story-mutation-service.ts)

Multiple places inline GraphQL mutation strings directly in TypeScript code:

- Lines 126-139: `AddDraftIssue` mutation
- Lines 173-178: `SetLabels` mutation
- Lines 187-191: `SetMilestone` mutation
- Lines 257-263: Dynamic `UpdateIssue` mutation
- Line 319: Inline query string
- Lines 368-375: `AddComment` mutation
- Lines 385-390: `ConvertDraftIssue` mutation

**Broader scope:** The inline pattern also appears in 4 other adapter files: [`impediment-service.ts:265-276`](src/adapters/github/internal/impediment-service.ts:265-276), [`field-value-mutator.ts:39`](src/adapters/github/internal/field-value-mutator.ts:39), [`vocabulary-manager.ts:125`](src/adapters/github/internal/vocabulary-manager.ts:125), and [`label-resolver.ts:168`](src/adapters/github/internal/label-resolver.ts:168) — totalling **11 inline mutation strings across 5 files**.

Contrast with the read side, which uses named constants from [`src/adapters/github/queries.ts`](src/adapters/github/queries.ts). The `operations.graphql` file exists but is only consumed by `queries.ts` for read operations — mutations are not yet extracted.

**Fix:** Extract all inline GraphQL (across all 5 adapter files) to `operations.graphql` / `queries.ts` for consistency with the read path.

---

### 🟡 Naming Issues (N1, N2)

#### 11. Imprecise Function Name: `resolveP0PriorityDisplay`
**Severity:** MODERATE
**File:** [`src/tools/scrum-write.ts:34`](src/tools/scrum-write.ts:34)

```typescript
const resolveP0PriorityDisplay = (scrumConfig: ScrumConfig): string => {
```

The name suggests it resolves the P0 (highest-priority) display name, but its implementation falls back to `"Must"` if no priority tiers are configured. A name like `resolveHighestPriorityDisplay` or `resolveDefaultPriority` would be more accurate.

---

#### 12. Obscured Intent: `unknown` Types in `orient.ts`
**Severity:** LOW
**File:** [`src/scrum/orient.ts:34-36`](src/scrum/orient.ts:34)

```typescript
team: unknown;
dor: unknown; // was definition_of_ready
dod: unknown; // was definition_of_done
```

The `team`, `dor`, and `dod` fields are typed as `unknown`, requiring consumers to cast. While this is intentional for a pass-through, it obscures intent.

**Fix:** Define proper types (e.g., `TeamMember[]`, `string[]`) to match the `ScrumConfig` shape.

---

### 🟡 Inconsistency (G11)

#### 13. Inconsistent Return Type Pattern
**Severity:** LOW
**File:** [`src/scrum/get-burndown.ts:29`](src/scrum/get-burndown.ts:29)

The return type `BurndownResponse | { message: string }` is a tagged union pattern not used by any other use-case. Other use-cases return a single shape or throw. This forces callers to narrow the type (as the test does with `assertIsBurndownResponse`).

**Fix:** Use a consistent error-handling pattern across all use-cases.

---

### 🟡 Test Quality (G8)

#### 14. Over-Engineered Test Mocks
**Severity:** HIGH
**File:** [`src/scrum/get-backlog.test.ts:44-139`](src/scrum/get-backlog.test.ts:44)

The `createMockBackend` function implements the **full `ProjectBackend` interface** (20+ methods) when `getBacklogUseCase` only depends on `BacklogPort & EpicPort`. The comment on line 43 acknowledges this:

> "Creates a mock ProjectBackend implementing all required methods."

Contrast with [`get-burndown.test.ts:56-60`](src/scrum/get-burndown.test.ts:56) and [`get-history.test.ts:64-71`](src/scrum/get-history.test.ts:64), which correctly use focused mock implementations of only the ports needed (ISP).

**Fix:** Refactor `createMockBackend` in `get-backlog.test.ts` to implement only `BacklogPort & EpicPort`, matching the pattern used by the other test files.

---

### 🟡 Code Clutter & Separation (G10, G12, G28, F3)

#### 15. Vertical Separation: `PartialFailureResult` Far from Usage
**Severity:** MODERATE
**File:** [`src/tools/scrum-write.ts:25-29`](src/tools/scrum-write.ts:25)

The `PartialFailureResult` interface is defined at the top of the file but only used in one handler (`scrum_create_story`, line 294). It should be closer to its usage site.

---

#### 16. Repetitive `undefined` Checks (G28)
**Severity:** MODERATE
**File:** [`src/tools/scrum-write.ts:175-181`](src/tools/scrum-write.ts:175)

```typescript
if (params.title !== undefined) updates.title = params.title;
if (params.body !== undefined) updates.body = params.body;
if (params.labels !== undefined) updates.labels = params.labels;
if (params.assignees !== undefined) updates.assignees = params.assignees;
if (params.epic !== undefined) updates.epic = params.epic;
if (params.blocked_by !== undefined) updates.blocked_by = params.blocked_by;
if (params.blocks !== undefined) updates.blocks = params.blocks;
```

This pattern is repetitive and error-prone (easy to miss a field). A helper function like `pickDefined(params, keys)` would encapsulate this.

---

#### 17. Unused Parameter Convention (F3/G12)
**Severity:** HIGH
**File:** [`src/scrum/get-burndown.ts:27`](src/scrum/get-burndown.ts:27)

```typescript
export const getBurndownUseCase = async (
  backend: BurndownPort,
  _scrumConfig: ScrumConfig,   // ← prefixed underscore = intentionally unused
  params: GetBurndownParams,
```

The underscore convention signals the parameter is unused but required by the call-site signature. The comment in the file header says "Receives backend: ProjectBackend and scrumConfig: ScrumConfig" but the config is never read.

**Fix:** Either remove the parameter entirely (if the call-site can be restructured) or add a comment explaining why it's kept (e.g., "// Required for handler registration type compatibility").

---

## 📊 Summary Statistics

| Severity      | Count | Smell Codes                          | Actionable |
| :------------ | :---- | :----------------------------------- | :--------- |
| CRITICAL      | 7     | G5, G6, G9                           | 7          |
| HIGH          | 3     | G1, G5/G33, G8, F3/G12               | 3          |
| MODERATE      | 3     | N1, G10, G28                         | 3          |
| LOW           | 2     | N2, G11                              | 2          |
| **Total**     | **16**|                                      | **15**     |

---

## 🔧 Recommended Action Order (Prioritized by Risk)

1. **Delete** [`src/domain/rules/dependencies.ts`](src/domain/rules/dependencies.ts) (Dead code — G9)
2. **Consolidate** two `parseDependencies` implementations (G5)
3. **Extract** shared `storyToListing` to a new module (G5)
4. **Remove** `graphql` import from [`src/tools/scrum-write.ts:20`](src/tools/scrum-write.ts:20) (G6)
5. **Refactor** `isTerminalStatus` to not reach into `backends.github` (G6)
6. **Consolidate** `assertNever` (keep domain version) (G5)
7. **Wire `scrum_update_impediment` through `updateImpedimentUseCase`** or **delete** the use-case file (G9/G6)
8. **Refactor** `get-backlog.test.ts` mock to ISP pattern (G8)
9. **Extract** inline GraphQL to `queries.ts` (G1)
10. **Consolidate** date math in `sprint-math.ts` (G5/G33)
11. **Rename** `resolveP0PriorityDisplay` → `resolveHighestPriorityDisplay` (N1)
12. **Add** proper types for `team`/`dor`/`dod` in `src/scrum/orient.ts` (N2)
13. **Normalize** error handling pattern in `src/scrum/get-burndown.ts` (G11)
14. **Move** `PartialFailureResult` closer to usage (G10)
15. **Encapsulate** `undefined` checks with helper function (G28)
16. **Remove or document** unused `_scrumConfig` parameter (F3/G12)

---

## 📋 Verification Methodology

Every claim was verified by reading the exact `file:line` references and running regex import searches across the codebase.

- **File reads:** Each referenced file was read at the cited line ranges; code excerpt accuracy confirmed.
- **Import searches:** `search_files` with regex patterns against `src/` for:
  - `from.*domain/rules/dependencies` → **0 results** (dead code confirmed)
  - `from.*update-impediment` → **0 results** (dead code confirmed)
  - `groupStoriesByStatus|computeSprintTotals` → only definition site, 0 importers (dead code confirmed)
- **Call-site tracing:** `scrum-write.ts:506` calls `backend.updateImpediment()` **directly on `ProjectBackend`** — it does NOT call `updateImpedimentUseCase()`. The handler bypasses the use-case layer.
- **Config verification:** `deno.json:7` confirmed the `"test"` task exists and covers `src/`.

### Corrections / Refinements from Original Audit

| Claim                        | Original Audit      | After Verification                                                |
| ---------------------------- | ------------------- | ----------------------------------------------------------------- |
| `updateImpedimentUseCase`    | Dead code (G9)      | **Confirmed** — 0 importers. Handler bypasses use case (also G6). |
| `dependencies.ts`            | Dead code (G9)      | **Confirmed** — 0 importers.                                      |
| Inline GraphQL scope         | 1 file, 7 mutations | **Expanded** — 5 files, 11 inline mutations total.                |
| Test runner config (E2)      | Claimed absent      | **Falsified** — `deno.json:7` has `"test"` task.                  |

### Readiness Assessment

The codebase is **ready to proceed** with the refactoring plan in [`tasks/REFACTORING.md`](tasks/REFACTORING.md). The 15 remaining actionable items are well-scoped and do not block forward progress. The recommended action order above is prioritized by risk: dead code removal and layer breach fixes first, then consolidation and extraction work.
