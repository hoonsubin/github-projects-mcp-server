# Adapter Layer: Dependency Injection & Assembly Layer Implementation Strategy

## Status: Revised Draft (v2)

This document supersedes the original draft. It defines the incremental strategy to restructure the GitHub adapter around dependency injection and an explicit assembly pipeline, aligning with the objectives in [`tasks/REFACTORING.md`](../tasks/REFACTORING.md).

> **Note on REFACTORING.md:** The implementation phases described in that document are outdated due to subsequent structural changes (port decomposition, ContentLocation portability, AnalyticsService unification). The **problem statement and objectives** remain correct and are the target this plan works toward. Treat REFACTORING.md as the "why" document; treat this plan as the "how" document.

**Goals:**

1. Eliminate duplicated constructor patterns in the adapter's internal services
2. Decouple `PaginatedProjectItemFetcher` from query-building responsibility
3. Introduce an explicit assembly pipeline (Fragment Library → Query Assembler → Execution Engine → Result Normalizer)
4. Establish the structural seams needed to implement org issue type support (REFACTORING.md Phase 0)
5. Lay the multi-backend foundation without over-engineering ahead of a second adapter

---

## 1. Problem Statement

### Issue A: Duplicated Constructor Patterns

Seven of the 16 internal classes take `GitHubBootState`, `GitHubClient`, `owner`, and `repo` as their first N constructor parameters. `factory.ts` has ~80 lines of sequential `new Service(a, b, c, ...)` calls with manual dependency ordering.

| Class                  | Constructor signature                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `StoryQueryService`    | `(config, gh, owner, repo)`                                                          |
| `LabelResolver`        | `(config, gh, owner, repo)`                                                          |
| `SprintHistoryService` | `(config, gh, owner, repo)`                                                          |
| `BurndownCalculator`   | `(config, gh, owner, repo)`                                                          |
| `StoryMutationService` | `(config, gh, owner, repo, labelResolver, userMilestoneResolver, fieldValueMutator)` |
| `ImpedimentService`    | `(config, gh, owner, repo, labelResolver, storyMutationService)`                     |
| `VocabularyManager`    | `(config, gh, labelResolver, owner, repo)`                                           |

**Cost:** Adding a shared infrastructure dependency (e.g., a metrics emitter or trace context) requires modifying 5+ constructors. The factory construction order is implicit and fragile.

Two services are intentionally **excluded** from this pattern:

- **`EpicService`** — takes `(gh, owner, tracked_repos, storyQueryService)`. Uses `tracked_repos` (full list), not `primaryRepo`. Has no `config` dependency. Stays as-is.
- **`ConfigReloader`** — takes `(ghConfig, bootState, gh, projectRoot, configDesc)`. Needs `projectRoot` and `configDesc`, which are construction-time values, not per-request context. Stays as-is.

These two are second-tier compositions built after the context object and are not candidates for the `GitHubInfraContext` pattern.

### Issue B: SRP Violation in PaginatedProjectItemFetcher

`PaginatedProjectItemFetcher` owns three concerns:

1. **Query building** — `buildItemsQuery()` constructs raw GraphQL strings inline
2. **Pagination** — cursor-based iteration across pages
3. **Collection** — `collect()` / `getAll()` with client-side predicate filtering

This prevents fragment reuse and forces over-fetching. A new execution path (e.g., Search API) cannot share the pagination infrastructure without duplicating it.

### Issue C: Hidden Coupling to GitHub Types

Every internal service imports `GitHubClient`, `GitHubBootState`, and `GitHubBackendConfig` directly and non-uniformly. No shared abstraction exists that a second adapter can depend on.

### Issue D: No Seam for org_issue_type Support

REFACTORING.md Phase 0 requires branching on `typeResolution.source` inside `FieldValueMutator` and `mappers.ts`. As these are currently tightly coupled to `GitHubBootState`, the branch will be an inline `if/else` buried in mutation logic — a temporary measure that needs to migrate into an assembler. The assembly pipeline in this plan creates the correct home for that branch from the start.

---

## 2. Design Principles

These principles are not aspirational — they are the constraints that shaped every decision below.

**a. Infrastructure context ≠ domain services.** The `GitHubInfraContext` object carries only platform config and the API client. Domain collaborators (`LabelResolver`, etc.) are constructed from the context and injected explicitly as named constructor parameters. Mixing them creates an unresolvable construction cycle (you can't build the context until services are built, but services need the context to be built).

**b. The factory is the only composition root.** Inner classes never import each other except through constructor parameters. The factory owns the wiring order. No service locator.

**c. Execution engine is a Humble Object.** It has no query logic, no normalization logic, and no retry strategy — it receives all of these as parameters. It is thin by design because it directly calls the GitHub API and is the hardest piece to unit-test. Everything testable lives outside it.

**d. Layer boundaries for errors.** Infrastructure errors (`truncated`, `rateLimitInfo`) do not leak to the agent. The assembler translates infrastructure signals into agent-visible warnings. These are separate types at separate layers.

**e. Port interfaces do not change.** `src/scrum/ports.ts`, all use-case functions, tool handlers, Zod schemas, and domain types are untouched by every phase of this plan.

**f. Phases deliver standalone value.** Each phase either fixes a structural problem or enables the next phase. No phase exists solely as scaffolding for a later one.

---

## 3. Target Architecture

### Construction Tiers

The factory builds services in three sequential tiers. Nothing in a lower tier can reference a service from a higher tier.

```
Tier 1: Infrastructure
  GitHubInfraContext
    └─ config: GitHubBootState
    └─ gh: GitHubClient
    └─ owner: string
    └─ repo: string          ← primaryRepo only; EpicService gets tracked_repos separately
    └─ ghConfig: GitHubBackendConfig

Tier 2: Domain Services (each takes GitHubInfraContext + named domain deps)
  LabelResolver(ctx)
  UserMilestoneResolver(ctx, labelResolver)
  FieldValueMutator(ctx, userMilestoneResolver)
  BurndownCalculator(ctx)
  SprintHistoryService(ctx)
  StoryQueryService(ctx)
  VocabularyManager(ctx, labelResolver)
  StoryMutationService(ctx, labelResolver, userMilestoneResolver, fieldValueMutator)
  ImpedimentService(ctx, labelResolver, storyMutationService)

  ── Excluded from ctx pattern (different dep shapes) ──
  EpicService(gh, owner, tracked_repos, storyQueryService)
  ConfigReloader(ghConfig, bootState, gh, projectRoot, configDesc)

Tier 3: Composed Services (take Tier 2 services only)
  AnalyticsService(config, sprintHistoryService, burndownCalculator)
  BoardHealthService(config, ghConfig, storyQueryService, impedimentService)
```

### Assembly Pipeline (Phases 1–4 target)

```
port call: findItems(filter)
  │
  ▼
FilterStrategyRouter.classify(filter) → FilterProfile (discriminated union)
  │
  ├─ "direct_lookup" ──► DirectLookupAssembler.assemble() ──┐
  ├─ "search_api"    ──► SearchApiAssembler.assemble()    ──┤
  ├─ "project_items" ──► ProjectItemsAssembler.assemble() ──┤
  └─ "mixed"         ──► MixedAssembler.assemble()        ──┘
                                                             │
                                                             ▼
                                                    AssembledQuery[]
                                                             │
                                                             ▼
                                                  ExecutionEngine.execute()
                                                  (cursor pagination, rate limit budget)
                                                             │
                                                             ▼
                                                    PaginationResult
                                                    (raw nodes, truncated flag)
                                                             │
                                                             ▼
                                                  ResultNormalizer.normalize()
                                                             │
                                                             ▼
                                                    AssemblerOutput
                                                    (BacklogItemListing[], warnings[])
```

### Multi-Backend Extension (Phase 5 target)

```
AbstractProjectBackend
  └─ abstract getPlatformState / findItems / getStoryDetail / ... (port obligations)
  └─ createImpediment / updateImpediment (optional, default throws UnsupportedCapabilityError)

AbstractAssemblyBackend extends AbstractProjectBackend
  └─ execute(requests: PlatformRequest[]): Promise<PaginationResult>  ← Humble Object
  └─ assembleItemSearch(filter) → PlatformRequest[]        ─┐ abstract
  └─ normalizeItemList(result)  → AssemblerOutput           ─┘
  └─ findItems() = assemble → execute → normalize           (concrete default)

GitHubAssemblyBackend extends AbstractAssemblyBackend
  └─ Implements assemble* / normalize* for GitHub GraphQL
  └─ Uses FilterStrategyRouter + assemblers built in Phases 1–4
```

---

## 4. TypeScript Patterns

### Pattern A: Two-Tier Context (replaces original Pattern A)

The context carries **only infrastructure** — the four values every service needs to talk to the GitHub API. Domain services are constructed _from_ the context and injected explicitly.

```typescript
// src/adapters/github/internal/infra-context.ts
export interface GitHubInfraContext {
  readonly config: GitHubBootState;
  readonly gh: GitHubClient;
  readonly owner: string;
  readonly repo: string; // primaryRepo
  readonly ghConfig: GitHubBackendConfig;
}

// factory.ts — construction is now sequential and explicit:
const ctx: GitHubInfraContext = {
  config: bootState,
  gh: ghClient,
  owner,
  repo: primaryRepo,
  ghConfig: resolvedGhConfig,
};

// Tier 2 — each class receives ctx + named domain deps only
const labelResolver = new LabelResolver(ctx);
const userMilestoneResolver = new UserMilestoneResolver(ctx, labelResolver);
const fieldValueMutator = new FieldValueMutator(ctx, userMilestoneResolver);
const burndownCalculator = new BurndownCalculator(ctx);
const sprintHistoryService = new SprintHistoryService(ctx);
const storyQueryService = new StoryQueryService(ctx);
const vocabularyManager = new VocabularyManager(ctx, labelResolver);
const storyMutationService = new StoryMutationService(
  ctx,
  labelResolver,
  userMilestoneResolver,
  fieldValueMutator,
);
const impedimentService = new ImpedimentService(ctx, labelResolver, storyMutationService);

// Excluded services — different dep shapes, constructed separately
const epicService = new EpicService(
  ghClient,
  owner,
  resolvedGhConfig.tracked_repos,
  storyQueryService,
);
const configReloader = new ConfigReloader(
  resolvedGhConfig,
  bootState,
  ghClient,
  projectRoot,
  configDesc,
);

// Tier 3 — higher-order compositions
const analyticsService = new AnalyticsService(bootState, sprintHistoryService, burndownCalculator);
const boardHealthService = new BoardHealthService(
  bootState,
  resolvedGhConfig,
  storyQueryService,
  impedimentService,
);
```

Why `EpicService` and `ConfigReloader` are excluded:

- `EpicService` operates across `tracked_repos` (the full array), not `primaryRepo`. Forcing it into a single-repo context would require a breaking signature change or a context variant. It takes `gh` and `owner` directly — already minimal.
- `ConfigReloader` holds `projectRoot` and `configDesc`, which are process-startup values with no equivalent in a per-request context. It cannot and should not receive `GitHubInfraContext`.

### Pattern B: Discriminated Union for Filter Strategy Routing

The router classifies a `ResolvedItemFilter` into one of four execution paths. The discriminated union guarantees exhaustive handling at compile time — adding a new path requires adding a new union arm, at which point every switch becomes a type error until handled.

```typescript
// src/adapters/github/internal/assemblers/types.ts
type FilterProfile =
  | { kind: "direct_lookup"; keys: readonly string[] }
  | { kind: "search_api"; search: string; labels?: readonly string[]; assignee?: string }
  | { kind: "project_items"; filter: ResolvedItemFilter }
  | { kind: "mixed"; filter: ResolvedItemFilter };

// src/adapters/github/internal/filter-strategy-router.ts
// Pure function — no dependencies, fully unit-testable
export const classifyFilter = (filter: ResolvedItemFilter): FilterProfile => {
  if (filter.keys.length > 0) {
    return { kind: "direct_lookup", keys: filter.keys };
  }
  const hasSearchableOnly = filter.search || filter.labels.length > 0 || filter.assignee;
  const hasBoardFields = filter.statuses.length > 0 || filter.sprint_ref ||
    filter.types.length > 0 || filter.priority;
  if (hasSearchableOnly && !hasBoardFields) {
    return {
      kind: "search_api",
      search: filter.search,
      labels: filter.labels,
      assignee: filter.assignee,
    };
  }
  if (hasBoardFields && !hasSearchableOnly) {
    return { kind: "project_items", filter };
  }
  return { kind: "mixed", filter };
};

// Usage in GitHubProjectBackend.findItems():
const profile = classifyFilter(filter);
switch (profile.kind) {
  case "direct_lookup":
    return directLookupAssembler.assemble(profile);
  case "search_api":
    return searchApiAssembler.assemble(profile);
  case "project_items":
    return projectItemsAssembler.assemble(profile);
  case "mixed":
    return mixedAssembler.assemble(profile);
  default:
    assertNever(profile);
}
```

### Pattern C: Sealed `PlatformRequest` + Branded Assembly Types

Assemblers produce `PlatformRequest[]`. The execution engine only knows how to execute `PlatformRequest[]` — it has no knowledge of what they represent. This is the type boundary between assembly logic and execution infrastructure.

```typescript
// src/adapters/github/internal/assemblers/types.ts

// The sealed wire type — all assemblers produce this
export interface PlatformRequest {
  readonly document: string;
  readonly variables: Record<string, unknown>;
  readonly operationName?: string;
}

// Branded types prevent accidental string confusion
declare const QueryDocumentBrand: unique symbol;
export type QueryDocument = string & { readonly [QueryDocumentBrand]: never };

declare const FragmentRefBrand: unique symbol;
export type FragmentRef = string & { readonly [FragmentRefBrand]: never };
```

Using `PlatformRequest` (not `QueryAssembler<TFilter, TAssembled>`) as the contract boundary means `AbstractAssemblyBackend` can hold assembler references without generic type parameters leaking into the abstract class signature. A Trello adapter produces `PlatformRequest[]` from REST calls; a GitHub adapter produces them from GraphQL — same interface, different content.

### Pattern D: Separated Infrastructure and Agent-Facing Result Types

`ExecutionResult` in the original draft conflated two audiences: infrastructure signals (`truncated`, `rateLimitInfo`) visible only to the assembler layer, and agent-visible warnings that surface in `UseCaseResult.warnings[]`. These are separated into two types at two layers:

```typescript
// src/adapters/github/internal/execution-engine.ts
// Raw output from the execution engine — infrastructure layer only
export interface PaginationResult {
  readonly nodes: readonly unknown[];
  readonly pagesConsumed: number;
  readonly truncated: boolean; // rate limit hit or page cap reached
  readonly rateLimitInfo?: {
    readonly remaining: number;
    readonly resetAt: string; // ISO 8601
  };
}

// src/adapters/github/internal/assemblers/types.ts
// Output from the full assembler pipeline — crosses into the port return type
export interface AssemblerOutput {
  readonly items: readonly BacklogItemListing[];
  readonly scopeSummary: string;
  readonly warnings: readonly string[]; // agent-visible; built from PaginationResult signals
}
```

The `ResultNormalizer` receives `PaginationResult` and produces `AssemblerOutput`. It decides whether `truncated: true` becomes a warning string (and what it says) — the execution engine does not make that decision. This respects the Humble Object principle: the engine is as logic-free as possible.

### Pattern E: Humble Object — ExecutionEngine

The execution engine directly calls the GitHub API. It is the hardest component to unit-test and the most likely to surface real network failure modes. Per the Humble Object pattern, it is designed to be as thin and logic-free as possible: all retry policy, all rate limit budget decisions, and all warning generation live _outside_ it.

```typescript
// src/adapters/github/internal/execution-engine.ts

export interface PaginationPolicy {
  readonly maxPages: number; // page cap before truncating
  readonly pageSize: number; // items per page (default: 100)
  readonly stopOnRateLimit: boolean; // truncate vs. throw on rate limit hit
}

export class ExecutionEngine {
  constructor(
    private readonly gh: GitHubClient,
    private readonly policy: PaginationPolicy,
  ) {}

  // Takes assembled requests, handles cursor iteration, returns raw nodes.
  // No query construction. No response interpretation. No retry logic.
  async execute(requests: readonly PlatformRequest[]): Promise<PaginationResult> {
    // cursor loop, page cap check, rate limit detection → truncated flag
    // Returns raw response nodes; caller interprets their shape
  }
}
```

Unit tests for the execution engine require a real (or fakes) GitHub client. All other logic (routing, assembly, normalization) is unit-tested without any network interaction.

---

## 5. Implementation Phases

### Pre-Phase: REFACTORING.md Prerequisite Gate

**This gate must be satisfied before Phase 3 begins.** It is not part of this plan's mechanical refactoring, but Phase 3's assemblers need `typeResolution.source` on `RuntimeConfig` to route field writes correctly. Without it, Phase 3 either has to add inline branching (which defeats the purpose) or it cannot implement correct type field writes.

**Required from REFACTORING.md Phase 0:**

- `typeResolution: { source: "board_field" | "org_issue_type"; fieldId: string | null }` added to `RuntimeConfig` / `GitHubBootState`
- `config-loader.ts` no longer throws on missing `typeFieldId` for org-owned projects
- `issueType { id name }` added to the `ItemContent` fragment in `operations.graphql`

**Files touched (REFACTORING.md scope, not this plan's scope):** `operations.graphql`, `queries.ts`, `config-loader.ts`, `bootstrap.ts`, `backend.ts`

The `FieldValueMutator` and `mappers.ts` temporary branches added in REFACTORING.md Phase 0 are **intentionally temporary** — Phase 3 of this plan absorbs and replaces them. Do not invest in making those branches elaborate.

---

### Phase 0: Introduce `GitHubInfraContext`

**Goal:** Collapse the repeated 4-param constructor pattern into a single infrastructure context object. No behavior change. This is a purely mechanical refactor.

**What changes:** Constructor signatures for 9 internal services. Factory construction block. Test utilities that construct services directly.

**What does NOT change:** Business logic in any service, port interfaces, use-case layer, `EpicService`, `ConfigReloader`, `AnalyticsService`, `BoardHealthService`.

**Files to create:**

```
src/adapters/github/internal/infra-context.ts   ← GitHubInfraContext interface
```

**Files to modify:**

```
src/adapters/github/factory.ts                              ← build ctx, pass to services
src/adapters/github/internal/label-resolver.ts              ← (ctx) 
src/adapters/github/internal/user-milestone-resolver.ts     ← (ctx, labelResolver)
src/adapters/github/internal/field-value-mutator.ts         ← (ctx, userMilestoneResolver)
src/adapters/github/internal/burndown-calculator.ts         ← (ctx)
src/adapters/github/internal/sprint-history-service.ts      ← (ctx)
src/adapters/github/internal/story-query-service.ts         ← (ctx)
src/adapters/github/internal/vocabulary-manager.ts          ← (ctx, labelResolver)
src/adapters/github/internal/story-mutation-service.ts      ← (ctx, labelResolver, userMilestoneResolver, fieldValueMutator)
src/adapters/github/internal/impediment-service.ts          ← (ctx, labelResolver, storyMutationService)
src/adapters/github/internal/pagination.ts                  ← PaginatedProjectItemFetcher constructor simplified
src/adapters/github/internal/_test_utils.ts                 ← helper builders updated
```

**Files NOT modified:**

```
src/adapters/github/internal/epic-service.ts        (different dep shape — tracked_repos)
src/adapters/github/internal/config-reloader.ts     (different dep shape — projectRoot, configDesc)
src/adapters/github/internal/analytics-service.ts   (tier 3 — composed from tier 2 services)
src/adapters/github/internal/board-health-service.ts (tier 3 — composed from tier 2 services)
```

**Risk:** Low. Purely mechanical. No behavior change.

**Validation:**

```bash
deno lint && deno fmt --check && deno task test
```

---

### Phase 1: Extract `ProjectItemsQueryBuilder` from `PaginatedProjectItemFetcher`

**Goal:** Separate query building from pagination. After this phase, the fetcher is pure cursor iteration infrastructure — it receives a pre-built query document and does nothing but page through results.

**Prerequisite:** Phase 0

**Files to create:**

```
src/adapters/github/internal/project-items-query-builder.ts
  └─ buildItemsQuery(ownerType, options): QueryDocument  (extracted verbatim from pagination.ts)
```

**Files to modify:**

```
src/adapters/github/internal/pagination.ts
  └─ PaginatedProjectItemFetcher constructor accepts pre-built QueryDocument
  └─ Remove buildItemsQuery() from this file
```

**Why this matters for REFACTORING.md:** Extracting query-building into its own class is the direct precursor to the Query Assembler (Phase 3). The query builder can later be replaced by the full assembler without touching the execution engine.

**Validation:**

```bash
deno task test   # PaginatedProjectItemFetcher tests still pass
deno lint
```

---

### Phase 2: Complete Fragment Library Migration

**Goal:** Eliminate the last inline GraphQL string path. After this phase, all query construction uses fragments from `operations.graphql` via the `queries.ts` registry.

**Prerequisite:** Phase 1. REFACTORING.md Pre-Phase should also be complete so that `issueType { id name }` is already in the `ItemContent` fragment.

**Current state:**

- `operations.graphql` defines `ProjectCore`, `ItemContent`, `ItemFieldValues` fragments
- `queries.ts` auto-parses and bundles them for registered operations
- `buildItemsQuery()` (now in `ProjectItemsQueryBuilder`) still constructs inline GraphQL

**Files to modify:**

```
src/adapters/github/internal/project-items-query-builder.ts
  └─ Reference ItemContent, ItemFieldValues from fragment registry
  └─ No inline GraphQL field selections remain

src/adapters/github/queries.ts
  └─ Ensure all fragments are registered and parsed
  └─ Verify GetOrgProjectItems and GetProjectItems use these fragments

src/adapters/github/operations.graphql
  └─ Add custom_fields passthrough fields to ItemFieldValues fragment if not present
```

**Outcome:** A field addition (e.g., `createdAt`) is a one-line fragment change that propagates to all query paths automatically.

**Validation:**

```bash
deno task test
# Manually verify: add a test field to ItemContent, confirm it appears in listing results
```

---

### Phase 3: Filter Strategy Router + Assembler Classes

**Goal:** Replace the `findItems` delegation path in `GitHubProjectBackend` with an explicit router + assembler pipeline. The router classifies filter profiles; each assembler handles one execution path cleanly.

**Prerequisites:**

- Phase 2 (unified fragment library)
- REFACTORING.md Pre-Phase (typeResolution.source on RuntimeConfig)

**Files to create:**

```
src/adapters/github/internal/filter-strategy-router.ts
  └─ classifyFilter(filter: ResolvedItemFilter): FilterProfile  — pure function

src/adapters/github/internal/assemblers/types.ts
  └─ FilterProfile discriminated union
  └─ PlatformRequest interface
  └─ AssembledQuery, AssemblerOutput types

src/adapters/github/internal/assemblers/direct-lookup-assembler.ts
src/adapters/github/internal/assemblers/project-items-assembler.ts
  └─ Reads typeResolution.source from ctx.config for field routing
src/adapters/github/internal/assemblers/mixed-assembler.ts
src/adapters/github/internal/assemblers/search-api-assembler.ts
  └─ Shell only in Phase 3; full implementation deferred to Phase 4
```

**Files to modify:**

```
src/adapters/github/backend.ts
  └─ findItems() uses router + assembler pipeline instead of delegating to StoryQueryService.findItems()
  └─ StoryQueryService.findItems() becomes internal-only; only getStoryDetail / computeSprintCompletion remain public

src/adapters/github/factory.ts
  └─ Construct and wire assembler instances
```

**Scope boundary:** The assembler router replaces _only_ `findItems()`. These methods stay in `StoryQueryService` unchanged:

- `getStoryDetail`
- `fetchAllItems` (used by BurndownCalculator, SprintHistoryService)
- `computeSprintCompletion`

**Note on typeResolution.source:** The `FieldValueMutator` and `mappers.ts` temporary branches added in REFACTORING.md Phase 0 are replaced here. `ProjectItemsAssembler` branches on `ctx.config.live.typeResolution.source` when assembling type field writes. `ResultNormalizer` (Phase 4) branches on it when extracting `BacklogItemListing.type`. After Phase 3 ships, the temporary branches in the mutator and mappers are deleted.

**Validation:**

```bash
deno task test   # findItems behavior preserved across all filter combinations
# Verify routing: keys-only filter → direct_lookup path
# Verify routing: status+sprint filter → project_items path
# Verify routing: search+labels filter → search_api path (returns empty, shell)
```

---

### Phase 4: Execution Engine + Result Normalizer

**Goal:** Extract the execution concerns from `PaginatedProjectItemFetcher` into a dedicated `ExecutionEngine` (the Humble Object). Extract mapping concerns from `mappers.ts` into `ResultNormalizer`. After this phase, the assembly pipeline is fully separated into its four components.

**Prerequisite:** Phase 3

**Files to create:**

```
src/adapters/github/internal/execution-engine.ts
  └─ ExecutionEngine class
  └─ PaginationPolicy interface (maxPages, pageSize, stopOnRateLimit)
  └─ PaginationResult interface (nodes, pagesConsumed, truncated, rateLimitInfo?)
  └─ Accepts PlatformRequest[], handles cursor pagination, returns PaginationResult
  └─ No query construction. No response interpretation. No retry logic.

src/adapters/github/internal/result-normalizer.ts
  └─ ResultNormalizer class
  └─ normalize(PaginationResult): AssemblerOutput
  └─ Handles typeResolution.source branching (board_field vs. org_issue_type)
  └─ Populates custom_fields passthrough — all field values, not just canonical four
  └─ Preserves __typename as custom_fields entry for content type vs. semantic type
```

**Files to modify:**

```
src/adapters/github/internal/pagination.ts
  └─ PaginatedProjectItemFetcher is replaced by ExecutionEngine
  └─ Keep as a thin shim or delete if no external consumers remain
  └─ BurndownCalculator and SprintHistoryService switch to ExecutionEngine directly

src/adapters/github/backend.ts
  └─ Wire ExecutionEngine + ResultNormalizer into the assembler pipeline
```

**The __typename passthrough rule:** The normalizer must preserve the distinction between content type (`__typename`: `Issue`, `PullRequest`, `DraftIssue`) and semantic item type (`BacklogItemListing.type`). Both travel in the raw response. Content type passes through as `custom_fields.__typename`. Semantic type is extracted from the appropriate source per `typeResolution.source` and written to `BacklogItemListing.type`. The agent and use-case layer can read both without hardcoding assumptions about the underlying object structure.

**Implementing the Search API path (Phase 4b):** Once `ExecutionEngine` and `ResultNormalizer` exist, `SearchApiAssembler` can be fully implemented. It produces `PlatformRequest` with the search query syntax; the engine executes it; a `SearchResultNormalizer` maps the inverted response shape (issue with nested `projectItems`) to `BacklogItemListing[]`. This is additive — nothing in the existing assemblers or engine changes.

**Validation:**

```bash
deno task test
# Verify custom_fields passthrough: non-canonical fields survive normalization
# Verify __typename present in custom_fields for all item types
# Verify typeResolution.source branching: board_field path extracts from fieldValues
# Verify typeResolution.source branching: org_issue_type path extracts from issue.issueType
```

---

### Phase 5: Multi-Backend Foundation

**Goal:** Define the abstract assembly contract and capability taxonomy that make adding a second backend a matter of implementing focused interfaces — not redesigning the data flow.

**Prerequisite:** Phases 0–4 complete for the GitHub adapter

**Important:** Phase 5 is the only phase that modifies shared infrastructure files (`abstract-backend.ts`, `capabilities.ts`). All preceding phases touch only the GitHub adapter package.

#### 5a: Abstract Assembly Contracts

**Files to create:**

```
src/adapters/assembly-contracts.ts
  └─ QueryAssembler interface: assemble(filter): PlatformRequest[]
  └─ ExecutionEngine interface: execute(requests): Promise<PaginationResult>
  └─ ResultNormalizer interface: normalize(result): AssemblerOutput
  └─ PlatformRequest sealed type (promoted from assemblers/types.ts)

src/adapters/abstract-assembly-backend.ts
  └─ AbstractAssemblyBackend extends AbstractProjectBackend
  └─ abstract assemble*(filter) → PlatformRequest[]   (one per port method)
  └─ abstract normalize*(result) → domain type
  └─ concrete findItems() = assemble → execute → normalize
  └─ If capability UNAVAILABLE → throw CapabilityUnavailableError before assembly
  └─ If capability EMULATED → append emulation notice to warnings[]
```

#### 5b: Capability Status Taxonomy (Backward-Compatible Migration)

The current `PlatformCapabilities.supports.*` fields are booleans and have existing callers. Changing them to enums in-place breaks all callers without a compile error (non-null enums are truthy). Use a **parallel addition** strategy:

```typescript
// src/adapters/capabilities.ts

// Step 1: Add enum alongside existing boolean fields (no callers break)
export enum CapabilityStatus {
  NATIVE = "NATIVE",
  EMULATED = "EMULATED",
  UNAVAILABLE = "UNAVAILABLE",
}

export interface PlatformCapabilities {
  readonly platform: string;
  readonly supports: {
    // ── Existing boolean fields — preserved for backward compat ──────────
    readonly auditLogBurndown: boolean;
    readonly nativeSprints: boolean;
    readonly dependencies: boolean;
    readonly fileReader: boolean;
    readonly stableItemKeys: boolean;

    // ── New tri-state fields — added in Phase 5 for assembly layer ───────
    // These mirror the boolean fields above but carry emulation semantics.
    // Boolean fields will be removed in a follow-up once all callers migrate.
    readonly auditLogBurndownStatus?: CapabilityStatus;
    readonly nativeSprintsStatus?: CapabilityStatus;
    readonly dependenciesStatus?: CapabilityStatus;
    readonly fileReaderStatus?: CapabilityStatus;
    readonly stableItemKeysStatus?: CapabilityStatus;
  };
}
```

The abstract assembly backend reads `Status` fields for capability checking. The composition root (`server.ts`) and any existing `if (capabilities.supports.fileReader)` callers continue reading boolean fields unchanged. Boolean fields are removed only after all callers have been migrated — that migration is out of scope for Phase 5.

`GITHUB_CAPABILITIES` is updated to add the `Status` fields alongside existing booleans:

```typescript
export const GITHUB_CAPABILITIES: PlatformCapabilities = {
  platform: "github",
  supports: {
    auditLogBurndown: true,
    nativeSprints: true,
    dependencies: true,
    fileReader: true,
    stableItemKeys: true,
    // Phase 5 additions
    auditLogBurndownStatus: CapabilityStatus.NATIVE,
    nativeSprintsStatus: CapabilityStatus.NATIVE,
    dependenciesStatus: CapabilityStatus.NATIVE,
    fileReaderStatus: CapabilityStatus.NATIVE,
    stableItemKeysStatus: CapabilityStatus.NATIVE,
  },
};
```

#### 5c: Platform Vocabulary Map

Each backend defines how Scrum domain concepts map to and from platform primitives. This is an internal adapter contract — the use-case layer never sees it.

```typescript
// src/adapters/platform-vocabulary.ts
export interface PlatformVocabularyMap {
  encode(concept: ScrumConcept, value: ScrumValue): PlatformValue;
  decode(concept: ScrumConcept, value: PlatformValue): ScrumValue;
  isSpecialLabel(label: string): boolean;
  extractUserLabels(allLabels: string[]): string[];
}
```

The vocabulary map is injected into assemblers at construction. When the normalizer maps raw responses to domain types, it calls `decode()` for each field. When assemblers build mutation requests, they call `encode()`.

**Validation:**

```bash
deno lint
deno task test
# Create a stub TestBackend implementing AbstractAssemblyBackend
# Verify the abstract contract compiles and the pipeline runs through a fake assembler
```

---

## 6. Factory Code Transformation

### Current State (factory.ts)

```typescript
// 80 lines of manually-ordered service construction
const labelResolver = new LabelResolver(bootState, ghClient, owner, primaryRepo);
const userMilestoneResolver = new UserMilestoneResolver(
  ghClient,
  owner,
  primaryRepo,
  labelResolver,
);
const fieldValueMutator = new FieldValueMutator(bootState, ghClient, userMilestoneResolver);
const burndownCalculator = new BurndownCalculator(bootState, ghClient, owner, primaryRepo);
const sprintHistoryService = new SprintHistoryService(bootState, ghClient, owner, primaryRepo);
const vocabularyManager = new VocabularyManager(
  bootState,
  ghClient,
  labelResolver,
  owner,
  primaryRepo,
);
const storyQueryService = new StoryQueryService(bootState, ghClient, owner, primaryRepo);
const epicService = new EpicService(
  ghClient,
  owner,
  resolvedGhConfig.tracked_repos,
  storyQueryService,
);
const storyMutationService = new StoryMutationService(
  bootState,
  ghClient,
  owner,
  primaryRepo,
  labelResolver,
  userMilestoneResolver,
  fieldValueMutator,
);
const impedimentService = new ImpedimentService(
  bootState,
  ghClient,
  owner,
  primaryRepo,
  labelResolver,
  storyMutationService,
);
const configReloader = new ConfigReloader(
  resolvedGhConfig,
  bootState,
  ghClient,
  projectRoot,
  configDesc,
);
// ...
```

### After Phase 0

```typescript
// ── Tier 1: Infrastructure context ─────────────────────────────────────────
const ctx: GitHubInfraContext = {
  config: bootState,
  gh: ghClient,
  owner,
  repo: primaryRepo,
  ghConfig: resolvedGhConfig,
};

// ── Tier 2: Domain services (ctx + named domain deps) ───────────────────────
const labelResolver = new LabelResolver(ctx);
const userMilestoneResolver = new UserMilestoneResolver(ctx, labelResolver);
const fieldValueMutator = new FieldValueMutator(ctx, userMilestoneResolver);
const burndownCalculator = new BurndownCalculator(ctx);
const sprintHistoryService = new SprintHistoryService(ctx);
const storyQueryService = new StoryQueryService(ctx);
const vocabularyManager = new VocabularyManager(ctx, labelResolver);
const storyMutationService = new StoryMutationService(
  ctx,
  labelResolver,
  userMilestoneResolver,
  fieldValueMutator,
);
const impedimentService = new ImpedimentService(ctx, labelResolver, storyMutationService);

// ── Excluded (different dep shapes) ─────────────────────────────────────────
const epicService = new EpicService(
  ghClient,
  owner,
  resolvedGhConfig.tracked_repos,
  storyQueryService,
);
const configReloader = new ConfigReloader(
  resolvedGhConfig,
  bootState,
  ghClient,
  projectRoot,
  configDesc,
);

// ── Tier 3: Composed services ────────────────────────────────────────────────
const analyticsService = new AnalyticsService(bootState, sprintHistoryService, burndownCalculator);
const boardHealthService = new BoardHealthService(
  bootState,
  resolvedGhConfig,
  storyQueryService,
  impedimentService,
);
```

### After Phase 3 (assembler pipeline wired)

```typescript
// ... (same Tier 1 + Tier 2 as above)

// ── Assemblers (use ctx.config for typeResolution routing) ──────────────────
const fragmentRegistry = buildFragmentRegistry(); // from queries.ts
const directLookupAssembler = new DirectLookupAssembler(ctx, fragmentRegistry);
const projectItemsAssembler = new ProjectItemsAssembler(ctx, fragmentRegistry);
const searchApiAssembler = new SearchApiAssembler(ctx, fragmentRegistry); // shell
const mixedAssembler = new MixedAssembler(ctx, projectItemsAssembler);
const executionEngine = new ExecutionEngine(ghClient, DEFAULT_PAGINATION_POLICY);

// GitHubProjectBackend receives assemblers in addition to existing deps
const deps: GitHubBackendDependencies = {
  ...existingDeps,
  directLookupAssembler,
  projectItemsAssembler,
  searchApiAssembler,
  mixedAssembler,
  executionEngine,
};
```

### After Phase 5 (full assembly backend)

```typescript
const ctx = buildInfraContext(bootState, ghClient, owner, primaryRepo, resolvedGhConfig);

// The backend is now self-contained: wires its own assemblers and engine
const backend = new GitHubAssemblyBackend(ctx);

return {
  backend,
  capabilities: GITHUB_CAPABILITIES,
  fileReader,
  typeTemplatePaths: live.typeTemplatePaths,
};
```

---

## 7. What Does Not Change (Any Phase)

| Artifact                              | Why untouched                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `src/scrum/ports.ts`                  | Port interfaces are the contract boundary; ISP already applied                 |
| `src/scrum/*.ts` (use-case functions) | Policy layer; no adapter knowledge                                             |
| `src/domain/types.ts`                 | Domain types are stable                                                        |
| `src/schemas/`                        | Zod schemas belong to the tool surface, not the adapter                        |
| `src/server.ts`                       | Composition root reads `BackendResult`; factory encapsulates adapter internals |
| Tool handlers                         | Untouched through all phases; consume use-case results only                    |

---

## 8. Migration Sequence

```
Pre-Phase ── REFACTORING.md Phase 0 (typeResolution on RuntimeConfig)
    │
Phase 0 ─── Introduce GitHubInfraContext, update 9 service constructors
    │
Phase 1 ─── Extract ProjectItemsQueryBuilder from PaginatedProjectItemFetcher
    │
Phase 2 ─── Complete fragment library migration (no inline GraphQL remains)
    │
Phase 3 ─── FilterStrategyRouter + 4 Assembler classes (typeResolution absorbed here)
    │         ← temporary FieldValueMutator + mappers.ts branches deleted
    │
Phase 4 ─── ExecutionEngine (Humble Object) + ResultNormalizer
    │         ← PaginatedProjectItemFetcher retired
    │         ← SearchApiAssembler fully implemented (Phase 4b)
    │
Phase 5 ─── AbstractAssemblyBackend + CapabilityStatus taxonomy (backward-compatible)
```

### Dependency Graph

```
Pre-Phase: no prerequisites (can start in parallel with Phase 0)
Phase 0:   no prerequisites (start here)
Phase 1:   requires Phase 0
Phase 2:   requires Phase 1 + Pre-Phase (for issueType fragment)
Phase 3:   requires Phase 2 + Pre-Phase (for typeResolution.source on config)
Phase 4:   requires Phase 3
Phase 5:   requires Phases 0–4
```

---

## 9. Risk Assessment

| Risk                                               | Likelihood     | Impact | Mitigation                                                                                                                                  |
| -------------------------------------------------- | -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Construction cycle in context object               | **Eliminated** | —      | Two-tier split: infra context carries no domain services                                                                                    |
| Regression in existing queries (Phases 0–2)        | Low            | Medium | Purely mechanical refactors; behavior unchanged; full test suite gating                                                                     |
| Phase 3 scope creep into StoryQueryService         | Medium         | Medium | Assembler router replaces _only_ `findItems()`. `getStoryDetail`, `fetchAllItems`, `computeSprintCompletion` stay in service unchanged      |
| EpicService / ConfigReloader forced into ctx       | **Eliminated** | —      | Explicitly excluded from ctx pattern; documented in Phase 0                                                                                 |
| ExecutionResult agent/infra conflation             | **Eliminated** | —      | `PaginationResult` (infra) vs. `AssemblerOutput` (agent-facing) are separate types                                                          |
| Phase 5 capability bool→enum breaking callers      | **Eliminated** | —      | Parallel addition: `Status` fields added alongside existing booleans; booleans preserved                                                    |
| Pre-Phase (REFACTORING.md) not done before Phase 3 | Medium         | High   | Phase 3 assemblers cannot correctly route type field writes without `typeResolution.source`. The dependency graph above enforces this gate. |
| Fragment registry divergence (Phase 2)             | Low            | Low    | `buildItemsQuery()` is the only bypass path; Phase 2 eliminates it entirely                                                                 |
| Multi-backend over-engineering                     | Low            | Medium | Phase 5 is the final phase and can be deferred indefinitely; Phases 0–4 deliver value for the single-backend case without it                |

---

## 10. Decision Log

| Decision                                                                                  | Rationale                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`GitHubInfraContext` carries only infrastructure; domain services injected explicitly** | Mixing domain services into the context creates an unsolvable construction cycle: the context needs the services to be built, but the services need the context. The two-tier split eliminates this.                                                                    |
| **`EpicService` and `ConfigReloader` excluded from ctx pattern**                          | `EpicService` uses `tracked_repos`, not `primaryRepo`. `ConfigReloader` needs `projectRoot` and `configDesc`, which are process-startup values. Forcing these into the context would require a new context variant or silent scope reduction. They are already minimal. |
| **`PlatformRequest` as sealed type, not `QueryAssembler<TFilter, TAssembled>` generic**   | Unbounded generics force `AbstractAssemblyBackend` to carry type parameters for every assembler it holds. `PlatformRequest` is the common wire format — all assemblers produce it; the engine consumes it. This matches the multi-backend design in REFACTORING.md.     |
| **`PaginationResult` (infra) vs. `AssemblerOutput` (agent-facing) are separate types**    | `truncated` and `rateLimitInfo` are execution signals; `warnings[]` are agent-visible text. The assembler/normalizer decides what infrastructure signals become agent warnings and how they are phrased — the engine does not.                                          |
| **ExecutionEngine is a Humble Object**                                                    | The engine directly calls the GitHub API and is the hardest piece to unit-test. All policy (retry budget, page cap, warning generation) lives in injectable `PaginationPolicy` values outside the engine, keeping it testable.                                          |
| **CapabilityStatus added in parallel to existing boolean fields**                         | Changing `boolean` to `enum` in-place breaks all `if (caps.supports.x)` callers without a type error (enums are truthy). Parallel addition lets the abstract assembly backend use tri-state while existing callers continue using booleans until migrated.              |
| **Parameter object over DI container library**                                            | A library adds a dependency with decorators/metadata. TypeScript structural typing makes a simple interface + builder pattern more transparent and debuggable. This is a CLI app, not a framework.                                                                      |
| **Router as a pure function, not a class**                                                | `classifyFilter()` has no dependencies — it is a pure transformation from `ResolvedItemFilter` to `FilterProfile`. Pure functions maximize testability and eliminate the need to construct a router instance.                                                           |
| **Assemblers as classes, not functions**                                                  | Assemblers hold a reference to the fragment registry (state) and implement a polymorphic interface. Functions would need the registry threaded through every call, or captured in a closure that cannot be easily substituted in tests.                                 |
| **`PaginatedProjectItemFetcher` replaced, not wrapped**                                   | The fetcher was already too coupled. Wrapping adds indirection without fixing the SRP violation. The execution engine extracts the pure pagination concern; the fetcher class is retired.                                                                               |
