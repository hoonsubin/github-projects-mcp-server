# Story B: Backend Abstraction Layer (Phase 5)

**Epic:** [Refactoring Plan](../REFACTORING.md)\
**Priority:** P1 — Core architectural shift\
**Dependencies:** Story A (quality fixes) must be complete first

---

## Title: Implement Backend Abstraction Layer with `ProjectBackend` Interface

As a **developer building the MCP server**,\
I want a `ProjectBackend` interface that separates Scrum policy from platform details,\
So that swapping to a different project management platform requires only adding one new directory and changing one import.

---

## Acceptance Criteria

1. `ProjectBackend` interface defined in [`src/scrum/ports.ts`](../../src/scrum/ports.ts) with all read and write method signatures
2. `GitHubProjectBackend` implements `ProjectBackend` in [`src/adapters/github/backend.ts`](../../src/adapters/github/backend.ts)
3. All 7 read methods implemented; write methods can be stubs
4. 7 use-case files created — one per read tool
5. Tool handlers in [`src/tools/scrum-read.ts`](../../src/tools/scrum-read.ts) are thin — parse, delegate, format
6. No handler imports `graphql`, `rest`, `loadConfig`, `resolveSprint`, or any GitHub raw type
7. `src/adapters/github/backend.ts` imports no MCP SDK types
8. `src/scrum/*.ts` imports no adapter types
9. `deno check src/index.ts` passes clean
10. At least one unit test per use case stubbing `ProjectBackend`

---

## Subtasks

### B1: Extract Pure Domain Rules

**Title:** Extract pure domain rules to `src/domain/rules/`

As a **developer organizing the codebase**,\
I want pure functions (no external dependencies) in the domain layer,\
So that domain logic is testable in isolation and has no imports outside std lib.

**Acceptance Criteria:**

1. Create `src/domain/rules/labels.ts` with `classifyLabels()`
2. Create `src/domain/rules/acceptance-criteria.ts` with `parseAcceptanceCriteria()`
3. Create `src/domain/rules/readiness.ts` with `computeStoryReadiness()`
4. Replace `StoryReadiness` interface with `type ReadinessLevel = "ready" | "partially_ready" | "not_ready"`
5. Add re-exports from `scrum-read.ts` temporarily for test compatibility
6. `deno check src/index.ts` passes
7. All existing tests pass

**Files Created:**

- `src/domain/rules/labels.ts`
- `src/domain/rules/acceptance-criteria.ts`
- `src/domain/rules/readiness.ts`

**Files Modified:**

- `src/tools/scrum-read.ts` — update imports
- `src/services/readiness.ts` — move function, delete `StoryReadiness` interface

---

### B2: Extract Sprint-Math Helpers

**Title:** Extract pure sprint computation functions to `src/scrum/sprint-math.ts`

As a **developer organizing Scrum policy logic**,\
I want all pure computation functions in one file,\
So that Scrum rules are centralized and independent of platform details.

**Acceptance Criteria:**

1. Create `src/scrum/sprint-math.ts` with 6 exported functions:
   - `groupStoriesByStatus`
   - `computeSprintTotals`
   - `buildSprintMeta`
   - `buildSprintWindow`
   - `buildIdealLine`
   - `buildDaySeries`
2. All functions depend only on domain types (no `RuntimeConfig` or GitHub types)
3. Update import sites in `scrum-read.ts`
4. `deno check src/index.ts` passes
5. All existing tests pass

**Files Created:**

- `src/scrum/sprint-math.ts`

**Files Modified:**

- `src/tools/scrum-read.ts` — update imports

---

### B3: Extract GitHub Raw Types and Queries

**Title:** Extract GitHub raw types and GraphQL queries to adapter layer

As a **developer organizing platform-specific code**,\
I want all GitHub-specific type declarations and query strings in the adapter layer,\
So that the rest of the codebase is free of GitHub schema knowledge.

**Acceptance Criteria:**

1. Create `src/adapters/github/raw-types.ts` with all `interface Raw*` and `interface Get*Response` types
2. Create `src/adapters/github/queries.ts` with all `const GET_*_QUERY` GraphQL strings
3. These are pure declarations — no logic moves
4. Update import sites in `scrum-read.ts`
5. `deno check src/index.ts` passes

**Files Created:**

- `src/adapters/github/raw-types.ts`
- `src/adapters/github/queries.ts`

**Files Modified:**

- `src/tools/scrum-read.ts` — update imports

---

### B4: Extract Mappers

**Title:** Extract GitHub-to-domain mapper functions to `src/adapters/github/mappers.ts`

As a **developer organizing data transformation logic**,\
I want all mapper functions in one adapter file,\
So that the transformation from GitHub raw types to domain types is centralized and testable.

**Acceptance Criteria:**

1. Create `src/adapters/github/mappers.ts` with 6 exported functions:
   - `extractBoardFields`
   - `buildStoryFromRaw`
   - `buildEnrichedStory`
   - `buildCommentList`
   - `buildLinkedPrList`
   - `buildBurndownStoryInput`
2. Functions take GitHub raw types as input, return domain types as output
3. Functions remain exported for test access
4. Update import sites in `scrum-read.ts`
5. `deno check src/index.ts` passes
6. All existing tests pass

**Files Created:**

- `src/adapters/github/mappers.ts`

**Files Modified:**

- `src/tools/scrum-read.ts` — update imports

---

### B5: Define Port Interface + Write `GitHubProjectBackend`

**Title:** Define `ProjectBackend` interface and implement `GitHubProjectBackend`

As a **developer creating the backend abstraction**,\
I want a `ProjectBackend` interface that all backends must implement,\
So that the dependency rule is enforced by TypeScript and backend switching is safe.

**Acceptance Criteria:**

1. Create `src/scrum/ports.ts` with full `ProjectBackend` interface (from §7 of REFACTORING.md)
2. Create `src/adapters/github/config-loader.ts` with `loadConfig`, `RuntimeConfig`, `getBootstrapConfig`, `getRepo`
3. Create `src/adapters/github/backend.ts` with `GitHubProjectBackend implements ProjectBackend`
4. All read methods implemented; write methods are stubs (`throw new Error("not yet implemented")`)
5. `GitHubProjectBackend` constructor accepts `RuntimeConfig`, `gh`, `owner`, `ownerType`, `repo`
6. `resolveSprint` and `resolveStory` are private methods on the class
7. Update `index.ts` to construct `GitHubProjectBackend` and pass it to tool registration
8. Server starts successfully
9. All 7 read tools respond correctly
10. Write stubs throw `new Error("not yet implemented")` and return an MCP error response

**Files Created:**

- `src/scrum/ports.ts`
- `src/adapters/github/config-loader.ts`
- `src/adapters/github/backend.ts`

**Files Modified:**

- `src/index.ts` — construct backend, pass to tool registration
- `src/services/config.ts` — move types to config-loader
- `src/services/resolver.ts` — move functions to backend

---

### B6: Extract Use Cases — One File Per Read Tool

**Title:** Extract each read tool handler body into a standalone use-case function

As a **developer separating concerns**,\
I want each use case in its own file receiving `backend: ProjectBackend` and `yml: ScrumConfigYml`,\
So that business logic is testable with stubbed backends and handlers are thin.

**Acceptance Criteria (per use case):**

1. Function takes typed params matching Zod schema output
2. Function calls `backend.*` methods for all I/O
3. Function calls domain-rule functions for pure computation
4. Function calls sprint-math functions for aggregation
5. Function returns typed result (not JSON string — handler stringifies)
6. Function throws on error — handler catches
7. Corresponding handler in `scrum-read.ts` updated to delegate

**Suggested extraction order (simplest to most complex):**

#### B6.1: `get-template.ts`

- `getTemplateUseCase(backend, yml, params)` — one file fetch, no computation

#### B6.2: `orient.ts`

- `orientUseCase(backend, yml)` — one backend call + gap computation

#### B6.3: `get-story.ts`

- `getStoryUseCase(backend, params)` — one backend call + AC parsing

#### B6.4: `get-sprint.ts`

- `getSprintUseCase(backend, yml, params)` — backend call + sprint-math

#### B6.5: `get-backlog.ts`

- `getBacklogUseCase(backend, yml, params)` — backend call + filters + readiness

#### B6.6: `get-history.ts`

- `getHistoryUseCase(backend, yml, params)` — backend call + summary computation

#### B6.7: `get-burndown.ts`

- `getBurndownUseCase(backend, yml, params)` — backend call + series computation

**Files Created:**

- `src/scrum/get-template.ts`
- `src/scrum/orient.ts`
- `src/scrum/get-story.ts`
- `src/scrum/get-sprint.ts`
- `src/scrum/get-backlog.ts`
- `src/scrum/get-history.ts`
- `src/scrum/get-burndown.ts`

**Files Modified:**

- `src/tools/scrum-read.ts` — update handlers to delegate

---

### B7: Verify and Stabilize

**Title:** Verify architecture integrity and add tests

As a **developer ensuring quality**,\
I want to verify that all dependency rules are enforced and all use cases are tested,\
So that the architecture is production-ready and future backends can be added safely.

**Acceptance Criteria:**

1. `scrum-read.ts` contains only `registerScrumReadTools(server, backend, yml)` and 7 thin handlers
2. No handler imports `graphql`, `rest`, `loadConfig`, `resolveSprint`, or any GitHub raw type
3. `src/adapters/github/backend.ts` imports no MCP SDK types
4. `src/scrum/*.ts` imports no adapter types
5. Temporary re-exports added in B1 are removed from `src/tools/scrum-read.ts`
6. `deno check src/index.ts` passes clean
7. All existing tests pass
8. At least one new unit test per use case that stubs `ProjectBackend` with a fake implementation

**Verification Commands:**

```bash
deno check src/index.ts
deno test
```

---

## Verification Checklist

- [x] B1: Domain rules extracted to `src/domain/rules/`
- [x] B2: Sprint-math helpers extracted to `src/scrum/sprint-math.ts`
- [x] B3: Raw types and queries extracted to `src/adapters/github/`
- [x] B4: Mappers extracted to `src/adapters/github/mappers.ts`
- [x] B5: `ProjectBackend` interface + `GitHubProjectBackend` implemented
- [x] B6.1: `get-template.ts` use case extracted
- [x] B6.2: `orient.ts` use case extracted
- [x] B6.3: `get-story.ts` use case extracted
- [x] B6.4: `get-sprint.ts` use case extracted
- [x] B6.5: `get-backlog.ts` use case extracted
- [x] B6.6: `get-history.ts` use case extracted
- [x] B6.7: `get-burndown.ts` use case extracted
- [x] B7: B1 temporary re-exports removed from `src/tools/scrum-read.ts`
- [x] B7: All verifications pass, tests added
- [x] `deno check src/index.ts` passes clean
- [x] All existing tests pass
- [x] New unit tests added per use case
