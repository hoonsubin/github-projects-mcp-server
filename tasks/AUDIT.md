# Comprehensive Clean Code Audit Report

## Overall Assessment

The codebase is **well-structured**, with a clean three-layer architecture (Framework → Use-Case → Adapter) that generally follows SOLID principles and the Dependency Inversion Principle. However, the audit revealed **16 actionable issues** across multiple categories, including three layer-breach violations, duplicated code, and test-quality gaps. The most critical finding is a **duplicated `parseDependencies` implementation** that diverges between the domain and adapter layers — this is a latent correctness risk.

---

## 🔴 CRITICAL: Layer Breaches & Duplication

### 1. G5 (Duplication) — Two diverging `parseDependencies` implementations

**Files:**

- [`parseDependencies()`](src/domain/rules/dependencies.ts:31) — Domain layer: returns `DependencyEntry[]`
- [`parseDependencies()`](src/adapters/github/mappers.ts:43) — Adapter layer: returns `{ blocked_by, blocks }`

These implement divergent parsing for the same domain concept:

- **Domain** (`dependencies.ts:31-64`): Parses `- #N Title` list items from `## Dependencies` section, with fallback to inline `Depends on #N` regex scanning.
- **Adapter** (`mappers.ts:43-66`): Parses `- Blocked by: #N` / `- Blocks: #N` lines from `## Dependencies` section, with **no fallback** to inline scanning.

The domain version is **never imported anywhere** (confirmed by regex search: 0 imports of `domain/rules/dependencies`). The adapter version is the one actively used. This means the `hasDependencySection()`, `generateDependencySection()`, and the domain's `parseDependencies()` are dead code (G9).

**Risk:** Refactoring the adapter's parse logic in only one place could create silent bugs. The divergent formats mean a story with `- #17 Login` in `## Dependencies` would parse correctly in one code path but silently fail in another.

**Fix:** Consolidate into one canonical implementation. Since the adapter version implements the format described in [`tasks/REFACTORING.md`](tasks/REFACTORING.md:33-39) (`Blocked by:` / `Blocks:`), either remove the domain version entirely or make the adapter delegate to it.

**Smell codes:** G5 (Duplication), G9 (Dead code)

---

### 2. G5 (Duplication) — Two identical `storyToListing` functions

**Files:**

- [`storyToListing()`](src/scrum/get-backlog.ts:31) — 9 lines
- [`storyToListing()`](src/scrum/get-sprint.ts:29) — 9 lines

These are **character-for-character identical** except the import path for `StoryListing`.

**Fix:** Extract to a shared module (e.g., `src/scrum/story-listing.ts` or `sprint-math.ts`).

**Smell codes:** G5 (Duplication)

---

### 3. G5 (Duplication) — Two identical `assertNever` functions

**Files:**

- [`assertNever()`](src/domain/errors.ts:20)
- [`assertNever()`](src/adapters/github/errors.ts:42)

Identical except the error message phrasing (`"Unhandled variant"` vs `"Unhandled GitHubErrorCode"`).

**Fix:** Keep the domain version only; the adapter can import it.

**Smell codes:** G5 (Duplication)

---

### 4. G6 (Code at wrong level of abstraction) — Framework layer imports adapter internals

**File:** [`src/tools/scrum-write.ts:20`](src/tools/scrum-write.ts:20)

```typescript
import { graphql } from "../adapters/github/internal/http-client.ts";
```

This is a **direct layer breach** — the framework layer (`src/tools/`) should never import from `src/adapters/github/internal/`. The import is used by the deprecated `github_graphql` tool registered later in the file. Per the AGENT.md architecture diagram, the framework layer should only call use-case functions.

**Fix:** Move the `github_graphql` tool to the adapter layer, or inject a `GraphQLExecutor` port through `ProjectBackend`, or remove the deprecated tool entirely (it's marked as deprecated in `inputs.ts:5`).

**Smell codes:** G6 (Code at wrong level of abstraction)

---

### 5. G6 (Code at wrong level of abstraction) — Domain rule accesses adapter config

**File:** [`src/domain/rules/status.ts:21`](src/domain/rules/status.ts:21)

```typescript
const ghConfig = config.backends.github as Record<string, unknown>;
const statusDisplay = (ghConfig.status_display as Record<string, string>) ?? {};
```

The domain rules module accesses `config.backends.github`, a platform-specific field. The comment on line 13 explicitly admits this:

> "Resolves via scrum.status[terminal=true] → backends.github.status_display."

The domain layer should receive the resolved `status_display` mapping as a parameter rather than reaching into `backends.github` itself.

**Fix:** The use-case caller (`get-backlog.ts` or `get-history.ts`) should resolve the display mapping from config and pass it to `isTerminalStatus()` as an argument, keeping the domain function pure.

**Smell codes:** G6 (Code at wrong level of abstraction), G35 (Keep configurable data at high levels)

---

## 🟠 HIGH: Architectural & Design Issues

### 6. G9 (Dead code) — Unused domain/rules/dependencies.ts exports

**File:** [`src/domain/rules/dependencies.ts`](src/domain/rules/dependencies.ts)

All three exports (`parseDependencies`, `hasDependencySection`, `generateDependencySection`) are imported by **no other file** in the codebase (confirmed via regex search). They are dead code — the adapter uses its own `parseDependencies()` in `mappers.ts`.

Additionally, per the proj-diagram analysis, `update-impediment.ts`'s `updateImpedimentUseCase` is marked as unused.

**Fix:** Delete the file if the adapter's version is canonical, or make the adapter delegate to this domain function. Similarly, audit other "%% Unused" markings in [`docs/proj-diagram.md`](docs/proj-diagram.md:26-68).

**Smell codes:** G9 (Dead code)

---

### 7. G8 (Too much information) — Test mocks implement full ProjectBackend when only 2 ports needed

**File:** [`src/scrum/get-backlog.test.ts:44-139`](src/scrum/get-backlog.test.ts:44)

The `createMockBackend` function implements the **full `ProjectBackend` interface** (20+ methods) when `getBacklogUseCase` only depends on `BacklogPort & EpicPort`. The comment on line 43 acknowledges this:

> "Creates a mock ProjectBackend implementing all required methods."

Contrast with [`get-burndown.test.ts:56-60`](src/scrum/get-burndown.test.ts:56) and [`get-history.test.ts:64-71`](src/scrum/get-history.test.ts:64), which correctly use focused mock implementations of only the ports needed (ISP).

**Fix:** Refactor `createMockBackend` in `get-backlog.test.ts` to implement only `BacklogPort & EpicPort`, matching the pattern used by the other test files.

**Smell codes:** G8 (Too much information)

---

### 8. F3 (Flag arguments) / G15 (Selector arguments) — `_scrumConfig` unused parameter

**File:** [`src/scrum/get-burndown.ts:27`](src/scrum/get-burndown.ts:27)

```typescript
export const getBurndownUseCase = async (
  backend: BurndownPort,
  _scrumConfig: ScrumConfig,   // ← prefixed underscore = intentionally unused
  params: GetBurndownParams,
```

The underscore convention signals the parameter is unused but required by the call-site signature. The comment in the file header says "Receives backend: ProjectBackend and scrumConfig: ScrumConfig" but the config is never read.

**Fix:** Either remove the parameter entirely (if the call-site can be restructured) or add a comment explaining why it's kept (e.g., "// Required for handler registration type compatibility").

**Smell codes:** F3 (Flag arguments), G12 (Clutter)

---

## 🟡 MODERATE: Code Quality & Maintainability

### 9. G1 (Multiple languages in one source file) — Inline GraphQL in TypeScript

**File:** [`src/adapters/github/internal/story-mutation-service.ts`](src/adapters/github/internal/story-mutation-service.ts)

Multiple places inline GraphQL mutation strings directly in TypeScript code:

- Lines 126-139: `AddDraftIssue` mutation
- Lines 173-178: `SetLabels` mutation
- Lines 187-191: `SetMilestone` mutation
- Lines 257-263: Dynamic `UpdateIssue` mutation
- Lines 319: Inline query string
- Lines 368-375: `AddComment` mutation
- Lines 385-390: `ConvertDraftIssue` mutation

Contrast with the read side, which uses named constants from [`src/adapters/github/queries.ts`](src/adapters/github/queries.ts). The `operations.graphql` file exists but may not be used.

**Fix:** Extract all inline GraphQL to the `queries.ts` module for consistency with the read path.

**Smell codes:** G1 (Multiple languages in one source file), G11 (Inconsistency)

---

### 10. G33 (Encapsulate boundary conditions) — Date math scattered across modules

Date computation appears in three places with slightly different implementations:

- [`src/scrum/sprint-math.ts:26-28`](src/scrum/sprint-math.ts:26) — `buildSprintMeta()`: `new Date(startDate); endDate.setDate(endDate.getDate() + duration)`
- [`src/scrum/sprint-math.ts:127-130`](src/scrum/sprint-math.ts:127) — `buildSprintWindow()`: Same logic but with `setUTCDate` / `setUTCHours(0,0,0,0)`
- [`src/adapters/github/mappers.ts:288-289`](src/adapters/github/mappers.ts:288) — `toSprintInfo()`: Same logic again

The `buildSprintMeta` uses local-time `setDate`/`setHours` while `buildSprintWindow` uses UTC methods — an inconsistency that could cause off-by-one errors around timezone boundaries.

**Fix:** Consolidate sprint date computation into a single function in `sprint-math.ts`, with `toSprintInfo()` and `buildSprintMeta()` delegating to it.

**Smell codes:** G5 (Duplication), G11 (Inconsistency), G33 (Encapsulate boundary conditions)

---

### 11. N1 (Non-descriptive name) — `resolveP0PriorityDisplay` is imprecise

**File:** [`src/tools/scrum-write.ts:34`](src/tools/scrum-write.ts:34)

```typescript
const resolveP0PriorityDisplay = (scrumConfig: ScrumConfig): string => {
```

The name `resolveP0PriorityDisplay` suggests it resolves the P0 (highest-priority) display name, but its implementation falls back to `"Must"` if no priority tiers are configured. A name like `resolveHighestPriorityDisplay` or `resolveDefaultPriority` would be more accurate.

**Smell codes:** N1 (Non-descriptive name)

---

### 12. G10 (Vertical separation) — `PartialFailureResult` type far from usage

**File:** [`src/tools/scrum-write.ts:25-29`](src/tools/scrum-write.ts:25)

The `PartialFailureResult` interface is defined at the top of the file but only used in one handler (`scrum_create_story`, line 294). It should be closer to its usage site.

**Smell codes:** G10 (Vertical separation)

---

### 13. G28 (Encapsulate conditionals) — Repeated `undefined` checks in handler

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

**Smell codes:** G28 (Encapsulate conditionals), G5 (Duplication)

---

## 🟢 LOW: Polish & Documentation

### 14. N2 (Name at wrong abstraction level) — `orient.ts` uses `unknown` for vocabulary types

**File:** [`src/scrum/orient.ts:34-36`](src/scrum/orient.ts:34)

```typescript
team: unknown;
dor: unknown; // was definition_of_ready
dod: unknown; // was definition_of_done
```

The `team`, `dor`, and `dod` fields are typed as `unknown`, requiring consumers to cast. While this is intentional for a pass-through, it obscures intent.

**Fix:** Define proper types (e.g., `TeamMember[]`, `string[]`) to match the `ScrumConfig` shape.

**Smell codes:** N2 (Name at wrong level of abstraction)

---

### 15. G11 (Inconsistency) — `get-burndown.ts` returns `BurndownResponse | { message: string }`

**File:** [`src/scrum/get-burndown.ts:29`](src/scrum/get-burndown.ts:29)

The return type `BurndownResponse | { message: string }` is a tagged union pattern not used by any other use-case. Other use-cases return a single shape or throw. This forces callers to narrow the type (as the test does with `assertIsBurndownResponse`).

**Fix:** Use a consistent error-handling pattern across all use-cases.

**Smell codes:** G11 (Inconsistency)

---

### 16. E2 (Tests require more than one step) — No single-test-runner check for all test files

The test files (`get-backlog.test.ts`, `get-burndown.test.ts`, `get-history.test.ts`) are comprehensive and well-structured with ISP-aligned mocks. However, there's no centralized test runner configuration file confirming all tests run with a single `deno test` command. The `deno.json` should be verified for a `"test"` task.

---

## 📊 Summary Statistics

| Severity  | Count  | Smell Codes                    |
| --------- | ------ | ------------------------------ |
| CRITICAL  | 5      | G5, G6, G9                     |
| HIGH      | 4      | G8, G9, F3, G15, G12           |
| MODERATE  | 5      | G1, G5, G11, G33, N1, G10, G28 |
| LOW       | 2      | N2, G11                        |
| **Total** | **16** |                                |

## ✅ Architecture Adherence — What's Working

1. **Interface Segregation Principle** — Ports are cleanly decomposed (`BacklogPort`, `SprintPort`, `StoryPort`, etc.) and use-cases import only what they need.
2. **Dependency Inversion** — `GitHubProjectBackend` is a facade delegating to injected services; the `ProjectBackend` interface lives in the use-case layer.
3. **Thin Handlers** — Tool handlers follow `parse → delegate → format` with no business logic.
4. **Strict Zod Schemas** — All schemas use `.strict()` with comprehensive `.describe()` annotations.
5. **Strong Error Design** — `GitHubApiError` carries code, recovery instructions, and structured context.
6. **Test Quality** — Tests are ISP-aligned, use focused mocks, and cover edge cases (empty history, partial failures, case-insensitive matching).

## 🔧 Recommended Action Order

1. **Delete** [`src/domain/rules/dependencies.ts`](src/domain/rules/dependencies.ts) (dead code — G9)
2. **Consolidate** two `parseDependencies` in `mappers.ts` (G5)
3. **Extract** shared `storyToListing` to `sprint-math.ts` or new shared module (G5)
4. **Remove** `graphql` import from [`scrum-write.ts`](src/tools/scrum-write.ts:20) (G6)
5. **Refactor** `isTerminalStatus` to not reach into `backends.github` (G6)
6. **Consolidate** `assertNever` (keep domain version) (G5)
7. **Refactor** `get-backlog.test.ts` mock to ISP pattern (G8)
8. **Extract** inline GraphQL to `queries.ts` (G1)
9. **Consolidate** date math in `sprint-math.ts` (G5/G33)
