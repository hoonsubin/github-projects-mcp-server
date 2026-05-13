# Architecture Audit — github-projects-mcp-server

**Date:** 2026-05-13 | **Auditor:** Clean Architecture Skill | **Scope:** `src/` Framework Layer

---

## Summary

The project demonstrates a **mature, well-intentioned Clean Architecture** with clear layer boundaries (domain → use cases → ports → adapters → tools → entry point). The `ProjectBackend` interface in [`src/scrum/ports.ts`](src/scrum/ports.ts) is a strong port that successfully decouples use-case code from GitHub specifics. However, several structural issues undermine the architecture: the `GitHubProjectBackend` class has grown into a massive ball of mud (1105 lines), the dependency direction is violated in multiple places, and the entry point (`src/index.ts`) leaks framework concerns inward. The project is in a **recoverable state** — not a big ball of mud yet, but drifting.

---

## Architecture as Found

```
src/
├── index.ts                    ← Entry/Main (Framework)
├── tools/                      ← Tool Handlers (Controllers)
│   ├── scrum-read.ts
│   └── scrum-write.ts
├── scrum/                      ← Use Cases + Ports
│   ├── ports.ts                ← ProjectBackend interface (THE CONTRACT)
│   ├── get-backlog.ts          ← Use Case
│   ├── get-burndown.ts         ← Use Case
│   ├── get-history.ts          ← Use Case
│   ├── get-sprint.ts           ← Use Case
│   ├── get-story.ts            ← Use Case
│   ├── get-template.ts         ← Use Case
│   ├── orient.ts               ← Use Case
│   └── sprint-math.ts          ← Pure helpers
├── services/                   ← Shared Services (cross-cutting)
│   ├── github.ts               ← GitHub HTTP client (graphql, rest)
│   ├── resolver.ts             ← Sprint/Story resolution
│   ├── pagination.ts           ← PaginatedProjectItemFetcher
│   ├── logger.ts               ← Structured logger
│   ├── error-enrichment.ts     ← Error hints
│   └── mutation-validator.ts   ← GraphQL mutation detection
├── adapters/github/            ← Adapter Layer (Concrete Details)
│   ├── backend.ts              ← GitHubProjectBackend (1105 lines)
│   ├── config-loader.ts        ← Config loading + validation
│   ├── errors.ts               ← GitHubApiError
│   ├── mappers.ts              ← Raw → Domain mappers
│   ├── queries.ts              ← GraphQL query loader
│   └── types.ts                ← GitHub-specific types
├── domain/                     ← Domain Layer (Policy)
│   ├── types.ts                ← Domain entity types
│   ├── config.ts               ← ScrumConfig
│   └── rules/
│       ├── acceptance-criteria.ts
│       ├── labels.ts
│       └── readiness.ts
├── schemas/                    ← Input Validation
│   ├── inputs.ts
│   └── scrum.ts
└── generated/                  ← Auto-generated
```

**Dependency flow:** `index.ts → tools → use cases → ports → adapters → services → domain`

---

## Findings

### P0 — Fix Soon

#### P0-1: `GitHubProjectBackend` violates SRP — massive god class (1105 lines)

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

The class implements `ProjectBackend` but also contains:

- GraphQL query strings inline (e.g., `clearField`, `resolveUserNodeId`, `resolveOrCreateMilestoneNodeId`, `resolveLabelNodeIds`, `createStory`, `updateStory`, `setField`)
- Label management logic (`fetchRepoNodeId`, `hashToColor`)
- Milestone CRUD operations
- User node resolution
- Field clearing logic
- Multiple private helpers that are really separate services

**Symptoms:** The class has 15+ public/semi-public methods spanning at least 6 distinct responsibilities. The `//todo: this class is way too massive` comment on line 61 confirms the author's own awareness.

**Fix:** Extract into:

- `GitHubLabelService` — label CRUD (resolveLabelNodeIds, resolveOrCreateLabel, fetchRepoNodeId, hashToColor)
- `GitHubMilestoneService` — milestone operations (resolveOrCreateMilestoneNodeId, fetchRepoNodeId)
- `GitHubUserService` — user resolution (resolveUserNodeId, resolveUserNodeIds)
- `GitHubFieldService` — field clearing and manipulation (clearField)
- Keep only `ProjectBackend` interface methods on `GitHubProjectBackend`

**Effort:** ~3–5 days

---

#### P0-2: Dependency Rule violation — use-case layer imports adapter types

**Files:** [`src/scrum/get-history.ts`](src/scrum/get-history.ts:6), [`src/scrum/get-burndown.ts`](src/scrum/get-burndown.ts:8), [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts:11-13)

```typescript
// src/scrum/get-history.ts:6
import type { ProjectBackend, SprintHistoryEntry, StoryListing } from "./ports.ts";

// src/adapters/github/backend.ts:11-13
import { type RuntimeConfig } from "./config-loader.ts";
import { resolveSprint, resolveStory } from "../../services/resolver.ts";
import { isBacklogItem, PaginatedProjectItemFetcher } from "../../services/pagination.ts";
```

The `resolver.ts` service imports `RuntimeConfig` from the adapter layer:

```typescript
// src/services/resolver.ts:8
import type { RuntimeConfig } from "../adapters/github/config-loader.ts";
```

This creates a **bidirectional dependency** between `services/` and `adapters/github/`. The `resolveSprint` function is a pure function that only needs `RuntimeConfig.iterations`, but it's placed in `services/` which imports from `adapters/`.

**Impact:** Any change to `RuntimeConfig` forces recompilation of `resolver.ts`, and `resolver.ts` is imported by `backend.ts` — creating a tight coupling loop.

**Fix:** Move `resolveSprint` to `src/scrum/` (use-case layer) or make it a method on a domain-level `SprintResolver` interface declared in `ports.ts`. Alternatively, move `RuntimeConfig` to `domain/` since it's configuration, not an adapter detail.

**Effort:** ~1 day

---

#### P0-3: Dependency Rule violation — `pagination.ts` imports adapter types directly

**File:** [`src/services/pagination.ts`](src/services/pagination.ts:16-23)

```typescript
import type {
  GitHubBackendConfig,
  ItemContentType,
  ProjectItem,
  ProjectItemDraftContent,
  ProjectItemIssueContent,
  ProjectItemPRContent,
} from "../adapters/github/types.ts";
```

`PaginatedProjectItemFetcher` is a **service** (cross-cutting concern) that directly imports **adapter-specific types**. This means the pagination abstraction is not reusable for any non-GitHub backend. The `buildItemsQuery` function generates GitHub-specific GraphQL fragments.

**Impact:** The "service" layer is not truly shared — it's GitHub-specific code masquerading as infrastructure.

**Fix:** Either:

1. Move `PaginatedProjectItemFetcher` into `adapters/github/` where it belongs (it's GitHub-specific), or
2. Define a generic `ProjectItemFetcher` interface in `ports.ts` and make the GitHub implementation a concrete class in the adapter layer.

**Effort:** ~1–2 days

---

#### P0-4: Entry point (`index.ts`) imports adapter types directly

**File:** [`src/index.ts`](src/index.ts:20-26)

```typescript
import { loadConfig } from "./adapters/github/config-loader.ts";
import { GitHubProjectBackend } from "./adapters/github/backend.ts";
import { graphql, rest } from "./services/github.ts";
import type { ProjectBackend } from "./scrum/ports.ts";
import type { GitHubBackendConfig } from "./adapters/github/types.ts";
```

`index.ts` (the Main component) knows about `GitHubProjectBackend` concretely and calls `new GitHubProjectBackend(...)`. While Main _is_ the one place that knows about concretions, it also imports `GitHubBackendConfig` from the adapter layer and performs type casting:

```typescript
const gh = config.scrumConfig.backends.github as GitHubBackendConfig;
```

This is acceptable for Main, but the `createBackend` function is tightly coupled to GitHub. If a second backend (e.g., AzureDevOps) is added, `createBackend` will need an if/else chain — violating OCP.

**Fix:** Introduce a `BackendFactory` interface in `ports.ts`:

```typescript
interface BackendFactory {
  create(config: RuntimeConfig): ProjectBackend;
}
```

Each backend provides its own factory. Main selects the factory based on config.

**Effort:** ~1 day

---

### P1 — Fix Opportunistically

#### P1-1: `mappers.ts` imports `RuntimeConfig` — adapter types leak into mapper layer

**File:** [`src/adapters/github/mappers.ts`](src/adapters/github/mappers.ts:7)

```typescript
import type { RuntimeConfig } from "./config-loader.ts";
```

The `extractBoardFields` function takes `RuntimeConfig["fields"]` to map field IDs to values. This is acceptable within the adapter layer, but `buildStoryFromRaw` and `buildEnrichedStory` both take the full `RuntimeConfig` object — they only need `config.fields` and `config.statusOptions`.

**Impact:** Over-dependence on `RuntimeConfig` makes the mappers harder to test in isolation and couples them to config loading details.

**Fix:** Pass only the needed subset:

```typescript
interface FieldMapping {
  statusFieldId: string;
  sprintFieldId: string;
  storyPointsFieldId: string | null;
  priorityFieldId: string | null;
}
```

**Effort:** ~0.5 days

---

#### P1-2: `queries.ts` performs file I/O at module init — violates testability

**File:** [`src/adapters/github/queries.ts`](src/adapters/github/queries.ts:20-22)

```typescript
const _source = Deno.readTextFileSync(
  new URL("./operations.graphql", import.meta.url),
);
```

Module-level side effects (file I/O) make unit testing of consumers harder. Any test that imports `queries.ts` triggers file reading at import time.

**Impact:** Tests that import `backend.ts` (which imports `queries.ts`) will fail if `operations.graphql` is missing or unreadable, even if the test doesn't need GraphQL queries.

**Fix:** Defer file reading to a factory function or inject the query source:

```typescript
export function createQueryLoader(source: string): QueryMap { ... }
```

**Effort:** ~0.5 days

---

#### P1-3: `sprint-math.ts` uses hardcoded "done" comparison in `get-history.ts`

**File:** [`src/scrum/get-history.ts`](src/scrum/get-history.ts:56-58)

```typescript
const completed_points = stories
  .filter((s) => s.status?.toLowerCase() === "done")
  .reduce((sum, s) => sum + s.points, 0);
```

The comment on line 42 acknowledges this is a "pragmatic approximation." The `computeSprintTotals` function in `sprint-math.ts` takes `doneDisplay` as a parameter (correct), but `get-history.ts` bypasses this by doing its own case-insensitive comparison.

**Impact:** Inconsistent done-status detection. If the team's done status is "Completed" or "Done" (capitalized), the history computation will miss it.

**Fix:** Use the config-driven terminal status from `ScrumConfig` or the `PlatformState` returned by `orient`.

**Effort:** ~0.5 days

---

#### P1-4: `BurndownStoryInput` defined in `ports.ts` but used by adapter layer

**File:** [`src/scrum/ports.ts`](src/scrum/ports.ts:64), [`src/adapters/github/mappers.ts`](src/adapters/github/mappers.ts:9)

```typescript
// ports.ts:64
export interface BurndownStoryInput { ... }

// mappers.ts:9
import type { BurndownStoryInput } from "../../scrum/ports.ts";
```

This is a **correct** cross-layer type — it's defined at the port boundary and used by both the use-case layer (`sprint-math.ts`) and the adapter layer (`mappers.ts`). However, the type includes a `ref` field that is only populated by the adapter:

```typescript
ref?: { id: string } | null;
```

This is a minor design smell — the port type carries adapter-specific knowledge.

**Effort:** ~0.25 days (trivial)

---

#### P1-5: `config-loader.ts` contains business logic (iteration classification)

**File:** [`src/adapters/github/config-loader.ts`](src/adapters/github/config-loader.ts:170-229)

The `classifyIterations` function (60 lines) determines active/next/completed sprints based on date arithmetic. This is **business logic** (Scrum domain rules) living in the adapter layer.

**Impact:** Changes to sprint classification logic require touching adapter code. The adapter layer should not contain domain rules.

**Fix:** Move `classifyIterations` to `src/scrum/` (e.g., `sprint-classifier.ts`) and have `config-loader.ts` call it.

**Effort:** ~0.5 days

---

### P2 — Note, May Be Fine

#### P2-1: `RuntimeConfig` mixes domain config with adapter metadata

**File:** [`src/adapters/github/config-loader.ts`](src/adapters/github/config-loader.ts:20-50)

`RuntimeConfig` contains:

- `scrumConfig: ScrumConfig` — domain config (belongs in `domain/`)
- `projectId: string` — adapter detail
- `fields: { ... }` — adapter field IDs
- `statusOptions / priorityOptions / typeOptions` — adapter option mappings
- `iterations: { ... }` — hybrid (domain concept, adapter-sourced)

**Impact:** The adapter layer owns the composite config type that the entire application depends on. This inverts the expected ownership.

**Fix:** Split into `DomainConfig` (in `domain/`) and `RuntimeConfig` (in `adapters/github/`). Use composition: `RuntimeConfig` wraps `DomainConfig`.

**Effort:** ~2 days

---

#### P2-2: `error-enrichment.ts` re-exports `GitHubApiError` — leaks adapter types

**File:** [`src/services/error-enrichment.ts`](src/services/error-enrichment.ts:13)

```typescript
export { GitHubApiError };
```

Re-exporting an adapter type from a service module makes it appear as if the service layer owns this type. Callers in `tools/` import from `error-enrichment.ts` rather than from the adapter layer.

**Impact:** Minor — this is a convenience pattern but obscures the dependency direction.

**Effort:** ~0.25 days

---

#### P2-3: `mutation-validator.ts` is a regex-based validator — fragile

**File:** [`src/services/mutation-validator.ts`](src/services/mutation-validator.ts:33)

```typescript
const mutationPattern = /\bmutation\b\s+\w+/;
```

A simple regex to detect GraphQL mutations is fragile. It will miss edge cases (comments, strings containing "mutation") and is not self-documenting.

**Impact:** Low — this is used only for the deprecated `github_graphql` tool, which is a passthrough. The risk is minimal.

**Effort:** N/A (low priority)

---

## Component Metrics (I/A/D)

| Component          | Ca (Fan-in) | Ce (Fan-out) | I = Ce/(Ca+Ce) | A (Abstractness) | D =  | A+I−1                       |   | Verdict |
| ------------------ | ----------- | ------------ | -------------- | ---------------- | ---- | --------------------------- | - | ------- |
| `domain/`          | 8           | 0            | 0.00           | 1.00             | 0.00 | **OK**                      |   |         |
| `scrum/`           | 4           | 3            | 0.43           | 0.85             | 0.42 | **Drift**                   |   |         |
| `services/`        | 6           | 4            | 0.40           | 0.60             | 0.00 | **OK**                      |   |         |
| `adapters/github/` | 3           | 5            | 0.63           | 0.40             | 0.37 | **Drift**                   |   |         |
| `tools/`           | 0           | 5            | 1.00           | 0.00             | 0.00 | **OK** (unstable by design) |   |         |
| `index.ts`         | 0           | 10           | 1.00           | 0.00             | 0.00 | **OK** (Main)               |   |         |

**Notes:**

- `scrum/` has D = 0.42 — it depends on adapter types (`RuntimeConfig` via `resolver.ts`), pulling it away from the Main Sequence.
- `adapters/github/` has D = 0.37 — it contains business logic (`classifyIterations`) that belongs in `scrum/`.

---

## SOLID Analysis

| Principle | Status   | Finding                                                                            |
| --------- | -------- | ---------------------------------------------------------------------------------- |
| **SRP**   | VIOLATED | `GitHubProjectBackend` (1105 lines) handles 6+ responsibilities                    |
| **OCP**   | AT RISK  | `createBackend()` in `index.ts` will need if/else for new backends                 |
| **LSP**   | OK       | No subtype violations detected                                                     |
| **ISP**   | OK       | `ProjectBackend` interface is focused; no kitchen-sink ports                       |
| **DIP**   | PARTIAL  | `ProjectBackend` is a good abstraction, but `resolver.ts` depends on adapter types |

---

## Dependency Direction Analysis

### Correct (inward-pointing):

- `tools/` → `scrum/` → `domain/` ✓
- `tools/` → `scrum/` → `services/` ✓
- `adapters/github/` → `domain/` ✓
- `adapters/github/` → `scrum/` (via `ports.ts`) ✓

### Violated (outward-pointing):

- `services/resolver.ts` → `adapters/github/config-loader.ts` ✗
- `services/pagination.ts` → `adapters/github/types.ts` ✗
- `services/github.ts` → `adapters/github/types.ts` ✗ (service depends on adapter)

---

## Scalability Bottlenecks

1. **`fetchAllItems()` in `GitHubProjectBackend`** — Every read tool that needs project data calls `fetchAllItems()`, which fetches ALL project items paginated. For large projects (1000+ items), this is O(n) per tool call with no caching.

2. **No query result caching** — `orient.ts` calls `getPlatformState()` which makes live API calls. Repeated calls by an agent session waste API quota.

3. **`config-loader.ts` fetches live field metadata on every startup** — This is acceptable for startup but means any field change requires a server restart.

---

## Recommended Actions (Sized)

| # | Action                                                                                   | Effort    | Priority |
| - | ---------------------------------------------------------------------------------------- | --------- | -------- |
| 1 | Extract `GitHubProjectBackend` into focused services (Label, Milestone, User, Field)     | ~3–5 days | P0       |
| 2 | Move `resolveSprint` to `scrum/` layer; remove `RuntimeConfig` import from `resolver.ts` | ~1 day    | P0       |
| 3 | Move `PaginatedProjectItemFetcher` into `adapters/github/` (it's GitHub-specific)        | ~1–2 days | P0       |
| 4 | Introduce `BackendFactory` interface to support OCP for new backends                     | ~1 day    | P0       |
| 5 | Move `classifyIterations` from `config-loader.ts` to `scrum/`                            | ~0.5 days | P1       |
| 6 | Split `RuntimeConfig` into `DomainConfig` + `RuntimeConfig`                              | ~2 days   | P1       |
| 7 | Defer `queries.ts` file I/O to factory function                                          | ~0.5 days | P1       |
| 8 | Fix hardcoded "done" comparison in `get-history.ts`                                      | ~0.5 days | P1       |

---

## Monitoring to Add

- **Cycle detection in CI:** Add `madge --no-progress` or `dependency-cruiser` to `.github/workflows/pr-check.yml` to fail on new dependency cycles.
- **Import restriction rules:** Configure `dependency-cruiser` to enforce: `domain/` imports nothing from `adapters/`, `scrum/` imports nothing from `adapters/`, `services/` imports nothing from `adapters/`.
- **File size guard:** Add a lint rule warning on files exceeding 500 lines (currently `backend.ts` at 1105 lines).
- **Periodic re-audit:** Schedule quarterly architecture review.

---

## Overall Health Assessment

**Score: 6.5/10** — The architecture has a **strong foundation** with a well-defined port (`ProjectBackend`) and clean domain types. The use-case layer is properly separated from the adapter layer. However, the **massive `GitHubProjectBackend` class** and **dependency direction violations** in the services layer are the primary risks. The project is **not yet a big ball of mud** but is drifting in that direction if the `backend.ts` file continues to grow. The recommended P0 actions should be completed before adding new backend adapters.
