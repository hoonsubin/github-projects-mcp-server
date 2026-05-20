# Comprehensive Clean Code Audit Report

> **Date:** 2026-05-20
> **Verification:** All claims verified against actual codebase via file reads and import searches.

## Overall Assessment

The codebase exhibits a **well-structured**, clean three-layer architecture (Framework → Use-Case → Adapter) that generally adheres to SOLID principles and the Dependency Inversion Principle. The audit identified **16 claims**, resulting in **15 actionable findings** (1 falsified). A detailed follow-up examination added **8 new findings**, and a subsequent verification pass corrected 2 severity ratings, unified 2 co-rooted findings, and added 1 new finding — bringing the total to **26 actionable findings**. The most critical architectural risks are: duplicated `parseDependencies` implementations (with structurally incompatible return types), type erasure via unsafe casts, a handler bypassing the use-case layer, and dead code in the domain and adapter layers.

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

**Note (verified):** The two functions are not just format-divergent — they are structurally incompatible. The domain version returns `DependencyEntry[]` (flat list); the adapter version returns `{ blocked_by: DependencyEntry[]; blocks: DependencyEntry[] }` (directional). The adapter cannot delegate to the domain version without a signature change. These cannot be unified by wrapping.

**Fix:** Delete `src/domain/rules/dependencies.ts` entirely (see Finding 8). The adapter's directional format is the canonical one; the domain version has no callers and implements the wrong shape.

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

The implementations differ in signature, not just message phrasing: the domain version is `(x: never, msg?: string): never` (accepts an optional message); the adapter version is `(x: never): never`. The adapter version is a strict subset. Since the domain version's `msg` parameter is optional, all existing call sites in the adapter are compatible without modification.

**Fix:** Delete the adapter version; import `assertNever` from `src/domain/errors.ts` at adapter call sites.

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

#### 6. Domain Rule Resolves Adapter-Specific Config (SRP / G35)
**Severity:** HIGH *(downgraded from CRITICAL — see verification note)*
**File:** [`src/domain/rules/status.ts:21`](src/domain/rules/status.ts:21)

```typescript
const ghConfig = config.backends.github as Record<string, unknown>;
const statusDisplay = (ghConfig.status_display as Record<string, string>) ?? {};
```

**Verification note:** This is not a strict layer breach — `ScrumConfig.backends` is intentionally typed as `Record<string, unknown>` at the domain level ([`src/domain/config.ts:95`](src/domain/config.ts:95)), and no adapter module is imported. However, it is a **Single Responsibility violation**: the domain rule is performing adapter config resolution (looking up `status_display` by platform key) rather than receiving an already-resolved mapping. The domain function knows it must look in `backends.github` — a platform-specific assumption baked into pure business logic.

**Fix:** The use-case caller (`get-backlog.ts` or `get-history.ts`) should resolve the `status_display` mapping from config and pass it to `isTerminalStatus()` as a parameter, keeping the domain function free of config-resolution logic.

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

## 🔍 New Findings from Detailed Examination

The following **8 additional findings** were discovered during a thorough codebase examination beyond the initial audit scope.

### 🔴 Critical Severity

#### 18. Type Erasure via `as Record<string, unknown>`
**Severity:** CRITICAL
**Files:** [`src/domain/rules/status.ts:21`](src/domain/rules/status.ts:21), [`src/tools/scrum-write.ts:36`](src/tools/scrum-write.ts:36), [`src/scrum/orient.ts:64`](src/scrum/orient.ts:64)

Four locations cast `config.backends.github` then access arbitrary properties:

- [`status.ts:21`](src/domain/rules/status.ts:21): `const ghConfig = config.backends.github as Record<string, unknown>; const statusDisplay = (ghConfig.status_display as Record<string, string>) ?? {};`
- [`scrum-write.ts:36`](src/tools/scrum-write.ts:36): Same double-cast pattern for `priority_display`
- [`orient.ts:64`](src/scrum/orient.ts:64): `const ghDisplay = scrumConfig.backends.github as GhDisplay | undefined;` — partially better: uses a locally-defined `GhDisplay` interface, but that interface is defined in the same function and is still unverified against the actual config shape
- [`src/index.ts:40`](src/index.ts:40): `const _server = server as unknown as Record<string, any>;` — **worst case**: a double cast through `unknown` into `any`, which bypasses the type system entirely (see Finding 26)

The three production cast sites are inconsistent: `status.ts` and `scrum-write.ts` use raw `Record<string, string>` for property access; `orient.ts` at least uses a named interface. None are verified by the compiler.

**Risk:** Silent runtime errors if config structure changes. The `as` cast suppresses all type checking.

**Fix:** Define a `GitHubBackendConfig` interface with explicit optional properties in `src/adapters/github/` and use it consistently across all cast sites. Each caller should cast once via the typed interface rather than double-casting to `Record<string, unknown>`.

---

#### 19. `console.error` in Logger — Not a Transport Safety Issue
**Severity:** LOW *(downgraded from CRITICAL — see verification note)*
**File:** [`src/services/logger.ts:43`](src/services/logger.ts:43)

**Verification note:** This finding was incorrect as stated. `console.error()` writes to **stderr**, not stdout. The MCP JSON-RPC wire format runs over **stdout**. These are separate file descriptors; stderr output does not corrupt the MCP protocol. The AGENT.md rule targets `console.log` (stdout), not `console.error`. The logger's use of stderr is the correct pattern for CLI diagnostic output.

The remaining concern is stylistic: the logger provides no transport abstraction, so callers cannot redirect log output (e.g., to a file) without patching `console.error`. This is low priority given the MCP server context.

**Fix (optional):** If log redirection becomes a requirement, abstract the output channel behind a writer interface. No action required for transport safety.

---

#### 20. `default` Branch Throws Generic Error Instead of `assertNever`
**Severity:** CRITICAL
**File:** [`src/adapters/github/internal/story-mutation-service.ts:351`](src/adapters/github/internal/story-mutation-service.ts:351)

The `setField` switch uses `throw new Error(\`Unknown field: ${field}\`)` instead of `assertNever(field)`. This loses the compile-time exhaustiveness guarantee that `assertNever` provides.

**Risk:** If a new field is added to the union type but not handled here, TypeScript will not flag it at compile time.

**Fix:** Replace with `assertNever(field, \`Unknown field: ${field}\`)`.

---

#### 21. Impediment Sprint Matching Uses Fragile String Matching
**Severity:** CRITICAL
**File:** [`src/adapters/github/internal/impediment-service.ts:181-196`](src/adapters/github/internal/impediment-service.ts:181)

The `getSprintImpediments` method matches sprint names via regex on issue body/comments. The TODO comment on line 181 acknowledges this is a known issue. This is a **layer breach** — the adapter should resolve project item iteration fields directly, not parse text.

**Risk:** False positives/negatives if sprint names appear in unrelated text.

**Fix:** Implement PVTI_ project item resolution + iteration field check as noted in the TODO.

---

### 🟠 High Severity

#### 22. `hasDependencies` Inconsistency Between Readiness and Domain
**Severity:** HIGH
**Files:** [`src/domain/rules/readiness.ts:30`](src/domain/rules/readiness.ts:30) · [`src/adapters/github/mappers.ts:43`](src/adapters/github/mappers.ts:43)

`readiness.ts:30` uses regex `(?:Depends\\s+on|Blocked\\s+by|Related\\s+to|Blocks)\\s+#\\d+` to detect dependencies in readiness scoring. The adapter's `parseDependencies` uses `- Blocked by: #N` / `- Blocks: #N` format. These are **different formats** — the readiness check will match inline references that the adapter won't parse into structured dependencies.

**Risk:** A story with `Depends on #123` in its body will score as "has dependencies" for readiness but won't have structured `blocked_by` entries. This is the same root cause as Finding 24 — the `has_dependencies` flag on `StoryListing` is populated from structured arrays (`blocked_by.length > 0`), not the regex, so `hasDependencies() = true` can coexist with `has_dependencies: false` on the same story. See Finding 24 for the documentation mismatch that compounds this.

**Fix:** Use a single canonical dependency detection function that matches the adapter's structured format. Findings 22 and 24 should be resolved together.

---

#### 23. `computeSprintTotals` and `groupStoriesByStatus` Are Dead Code
**Severity:** HIGH
**File:** [`src/scrum/sprint-math.ts:53`](src/scrum/sprint-math.ts:53) · [`src/scrum/sprint-math.ts:90`](src/scrum/sprint-math.ts:90)

Both `groupStoriesByStatus` and `computeSprintTotals` have **0 importers** in the codebase. They were extracted as part of Story B (Phase 5) but never wired into any use case. The `get-sprint.ts` computes `by_status` inline (lines 77-81) and `story_points` via `reduce` (line 105).

**Fix:** Delete these functions or wire them into `buildSingleSnapshot`.

---

### 🟡 Moderate Severity

#### 24. `StoryListing.has_dependencies` Comment Mismatch
**Severity:** MODERATE
**File:** [`src/scrum/ports.ts:148`](src/scrum/ports.ts:148)

The `has_dependencies` field comment says "true when the story body contains a ## Dependencies section" but the actual implementation in `storyToListing` checks `story.blocked_by.length > 0 || story.blocks.length > 0`. These are **different conditions** — a story could have a `## Dependencies` section with no entries, or have inline dependency references that don't create structured entries.

**Risk:** Misleading documentation causes consumer confusion, and compounds the inconsistency in Finding 22: `hasDependencies()` in `readiness.ts` fires on inline patterns (`Depends on #N`) that never populate the structured arrays, meaning a story can have `has_dependencies: false` in its listing while scoring as dependency-blocked in readiness. Findings 22 and 24 share the same root cause.

**Fix:** Resolve together with Finding 22. The comment should read: "true when `blocked_by` or `blocks` contains at least one structured dependency entry." Long-term, unify the detection logic so readiness scoring and structured parsing agree on what constitutes a dependency.

---

### 🟡 Low Severity

#### 25. Test Helper Has Unnecessary Stub Methods
**Severity:** LOW
**File:** [`src/scrum/get-backlog.test.ts:82-93`](src/scrum/get-backlog.test.ts:82)

The mock implements `getPlatformState`, `reload`, `getSprintStories`, `getStoryDetail`, `getCompletedSprintHistory`, `getBurndownInput`, `resolveCompletionTimestamps`, `fetchRepoFile`, `createImpediment`, `updateImpediment` — all returning empty/null stubs. These are never called by `getBacklogUseCase`.

**Fix:** Use a focused mock implementing only `BacklogPort & EpicPort`.

---

#### 26. Double Cast with `any` in Server Initialization
**Severity:** MODERATE
**File:** [`src/index.ts:40`](src/index.ts:40)

```typescript
const _server = server as unknown as Record<string, any>;
```

This is a double cast through `unknown` into `any` — the most permissive type erasure available in TypeScript. Unlike the `Record<string, unknown>` casts in Finding 18, which at least constrain property values to `unknown`, the `any` cast disables all further type checking on the object and its properties. The `_server` prefix suggests this is a workaround to satisfy the compiler without actually using the variable, which makes the cast even more suspicious.

**Risk:** If the code around this cast evolves to use `_server`, the `any` type will silently propagate through downstream operations with no compiler safety net.

**Fix:** Investigate why the cast is needed. If `_server` is truly unused (the underscore prefix convention), delete the line. If it is needed, find the correct type rather than casting to `any`.

---

## 📊 Summary Statistics

| Severity      | Count | Smell Codes                                            |
| :------------ | :---- | :----------------------------------------------------- |
| CRITICAL      | **10** | G5 (×3), G9 (×4), type-erasure, impediment-matching  |
| HIGH          | **7**  | G1, G5/G33, SRP/G35, G8, F3/G12, dead-code (×2)      |
| MODERATE      | **5**  | N1, G10, G28, comment-mismatch, any-cast              |
| LOW           | **4**  | N2, G11, test-stubs, logger                           |
| **Total**     | **26** |                                                        |

> **Note on prior counts:** The original audit reported "7 CRITICAL / 15 total" and the follow-up reported "+4 CRITICAL / +8 total". After verification: Finding 6 downgraded CRITICAL→HIGH (SRP violation, not a layer breach per `config.ts:95`); Finding 19 downgraded CRITICAL→LOW (`console.error` is stderr, not MCP stdout); Finding 26 added as MODERATE (`as unknown as Record<string, any>` double cast in `index.ts:40`). The original CRITICAL count was also 8 (not 7) — Findings 8 and 9 were labeled CRITICAL despite appearing under a HIGH-severity section header.

---

## 🔧 Recommended Action Order (Prioritized by Risk)

### Phase 1: Immediate (Risk Reduction)

1. **Delete** [`src/domain/rules/dependencies.ts`](src/domain/rules/dependencies.ts) (Dead code — G9)
2. **Delete** `computeSprintTotals` and `groupStoriesByStatus` from [`sprint-math.ts`](src/scrum/sprint-math.ts) (Dead code — G9)
3. **Fix** `assertNever` in [`story-mutation-service.ts:351`](src/adapters/github/internal/story-mutation-service.ts:351) (Loses exhaustiveness — G5)
4. **Delete** `graphql` import from [`scrum-write.ts:20`](src/tools/scrum-write.ts:20) if deprecated tool is removed (G6)

### Phase 2: Consolidation (Code Quality)

5. **Delete** domain `parseDependencies` (unreachable dead code; incompatible return type prevents unification — see Finding 1)
6. **Extract** shared `storyToListing` to a new module (G5)
7. **Consolidate** `assertNever` — delete adapter version, import domain version (G5)
8. **Consolidate** date math in `sprint-math.ts` (G5/G33)

### Phase 3: Architecture Fixes (Layer Compliance)

9. **Wire** `scrum_update_impediment` through `updateImpedimentUseCase` or **delete** the use-case file (G9/G6)
10. **Refactor** `isTerminalStatus` — pass resolved `status_display` mapping as a parameter instead of resolving it from `backends.github` (SRP/G35)
11. **Define** `GitHubBackendConfig` interface; replace all `as Record<string, unknown>` casts at `status.ts:21`, `scrum-write.ts:36`, `orient.ts:64` (G6)
12. **Investigate and remove** `as unknown as Record<string, any>` double cast in `src/index.ts:40` (Finding 26)
13. **Refactor** impediment sprint matching to use PVTI_ resolution (G6)

### Phase 4: Polish (Maintainability)

14. **Refactor** `get-backlog.test.ts` mock to ISP pattern (G8)
15. **Extract** inline GraphQL to `queries.ts` (G1)
16. **Rename** `resolveP0PriorityDisplay` → `resolveHighestPriorityDisplay` (N1)
17. **Add** proper types for `team`/`dor`/`dod` in `src/scrum/orient.ts` (N2)
18. **Normalize** error handling pattern in `src/scrum/get-burndown.ts` (G11)
19. **Move** `PartialFailureResult` closer to usage (G10)
20. **Encapsulate** `undefined` checks with helper function (G28)
21. **Remove or document** unused `_scrumConfig` parameter (F3/G12)
22. **Fix** `has_dependencies` comment in `ports.ts` and align `hasDependencies` regex in `readiness.ts` — resolve together (Findings 22 + 24 share the same root cause)

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
| `dependencies.ts`            | Dead code (G9)      | **Confirmed** — 0 importers. Return type is also incompatible with adapter version; consolidation via delegation is not feasible. |
| `assertNever` duplication    | "Identical except message" | **Refined** — signatures differ: domain adds optional `msg` param. Adapter is a strict subset; no call-site changes needed on consolidation. |
| Finding 6 (status.ts)        | Layer breach — CRITICAL | **Downgraded to HIGH** — `backends` is intentionally `Record<string, unknown>` in `ScrumConfig`; no adapter import occurs. Real issue is SRP: the domain function resolves platform-specific config instead of receiving a resolved value. |
| Finding 19 (console.error)   | MCP transport safety — CRITICAL | **Downgraded to LOW** — `console.error` writes to stderr, not stdout. MCP wire format uses stdout. No transport corruption risk. The pattern is correct for CLI diagnostic output. |
| Findings 22 + 24             | Two separate findings | **Unified root cause** — `hasDependencies()` regex (4 patterns) is a superset of what the adapter structures (2 patterns). A story can score as dependency-blocked in readiness while showing `has_dependencies: false` in its listing. Resolve together. |
| Inline GraphQL scope         | 1 file, 7 mutations | **Expanded** — 5 files, 11 inline mutations total.                |
| Test runner config (E2)      | Claimed absent      | **Falsified** — `deno.json:7` has `"test"` task.                  |
| Finding 26 (index.ts cast)   | Not in audit        | **New** — `as unknown as Record<string, any>` double cast; worse than the `Record<string, unknown>` casts in Finding 18 because `any` disables all downstream type checking. |

### Readiness Assessment

The codebase is **ready to proceed** with the refactoring plan in [`tasks/REFACTORING.md`](tasks/REFACTORING.md). The 26 actionable items are well-scoped and do not block forward progress. The recommended action order above is prioritized by risk: dead code removal and layer breach fixes first (Phase 1-2), then architecture compliance (Phase 3), and finally polish (Phase 4).

Two previously CRITICAL findings were downgraded after verification (Finding 6 → HIGH, Finding 19 → LOW), reducing the critical count from 11 to 9. One new MODERATE finding was added (Finding 26). Findings 22 and 24 were confirmed to share the same root cause and should be resolved together.

---

## 📐 Architecture Health Metrics

### Layer Compliance

| Layer | Imports From | Violations |
|-------|-------------|------------|
| Framework (`src/tools/`) | Use-Case, Schemas | 1: imports `adapters/github/internal/http-client.ts` |
| Use-Case (`src/scrum/`, `src/domain/`) | Standard lib, each other | 1: `domain/rules/status.ts` imports `backends.github` |
| Adapter (`src/adapters/`) | Use-Case ports, Standard lib | 0 |

### Dead Code Inventory

| Module | Exports | Importers | Status |
|--------|---------|-----------|--------|
| `src/domain/rules/dependencies.ts` | 3 | 0 | **Delete** |
| `src/scrum/update-impediment.ts` | 1 | 0 | **Wire or delete** |
| `src/scrum/sprint-math.ts::groupStoriesByStatus` | 1 | 0 | **Delete or wire** |
| `src/scrum/sprint-math.ts::computeSprintTotals` | 1 | 0 | **Delete or wire** |
| `src/scrum/get-backlog.ts::storyToListing` | 1 | 0 (duplicate) | **Extract to shared** |
| `src/scrum/get-sprint.ts::storyToListing` | 1 | 0 (duplicate) | **Extract to shared** |
| `src/domain/errors.ts::assertNever` | 1 | 0 (duplicate) | **Keep, adapter imports** |
| `src/adapters/github/errors.ts::assertNever` | 1 | 0 (duplicate) | **Delete, import domain** |

### Duplication Matrix

| Pattern | Locations | Lines Each |
|---------|-----------|------------|
| `storyToListing` | get-backlog.ts:31, get-sprint.ts:29 | 9 |
| `assertNever` | domain/errors.ts:20, adapter/errors.ts:42 | 3 |
| `parseDependencies` | domain/dependencies.ts:31, adapter/mappers.ts:43 | 34, 24 |
| Date math (local) | sprint-math.ts:26, mappers.ts:288 | 3, 2 |
| Date math (UTC) | sprint-math.ts:127 | 4 |
