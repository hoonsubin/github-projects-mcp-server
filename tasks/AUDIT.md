# Architecture Audit — github-projects-mcp-server

**Date:** 2026-05-13 | **Auditor:** Clean Architecture Skill | **Scope:** `src/` Framework & Domain Layers

---

## Summary

The project demonstrates a **mature, well-intentioned Clean Architecture** with clear layer boundaries (domain → use cases → ports → adapters → tools → entry point). The `ProjectBackend` interface in [`src/scrum/ports.ts`](src/scrum/ports.ts) is a strong port that successfully decouples use-case code from GitHub specifics.

However, several structural issues undermine the architecture:

1. **Massive God Class**: The `GitHubProjectBackend` class has grown into a massive ball of mud (1269 lines).
2. **Dependency Violations**: Dependency direction is violated in multiple places, particularly between services and adapters.
3. **Domain Leakage**: Core business logic for impediments (status rules, sprint association) resides in the adapter layer rather than the domain layer, due to the absence of a dedicated `Impediment` entity.
4. **Fragile Associations**: The system relies on fragile string-matching/regex patterns for critical relationships like sprint associations.

The project is in a **recoverable state** — not a big ball of mud yet, but drifting significantly if these structural debts are not addressed.

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
│   ├── backend.ts              ← GitHubProjectBackend (1269 lines)
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

#### P0-1: `GitHubProjectBackend` violates SRP — massive god class (1269 lines)

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

The class implements `ProjectBackend` but also contains:

- GraphQL query strings inline
- Label management logic
- Milestone CRUD operations
- User node resolution
- Field clearing logic
- Multiple private helpers that are really separate services

**Fix:** Extract into focused services: `GitHubLabelService`, `GitHubMilestoneService`, `GitHubUserService`, and `GitHubFieldService`.

#### P0-2: Dependency Rule violation — use-case layer imports adapter types

**Files:** [`src/scrum/get-history.ts`](src/scrum/get-history.ts), [`src/scrum/get-burndown.ts`](src/scrum/get-burndown.ts)

The `resolver.ts` service imports `RuntimeConfig` from the adapter layer, creating a bidirectional dependency loop between `services/` and `adapters/github/`.

**Fix:** Move `resolveSprint` to `src/scrum/` or move `RuntimeConfig` to `domain/`.

#### P0-3: Dependency Rule violation — `pagination.ts` imports adapter types directly

**File:** [`src/services/pagination.ts`](src/services/pagination.ts)

`PaginatedProjectItemFetcher` is a service that directly imports GitHub-specific types, making it non-reusable for other backends.

**Fix:** Move to `adapters/github/` or define a generic interface in `ports.ts`.

#### P0-4: Entry point (`index.ts`) imports adapter types directly

**File:** [`src/index.ts`](src/index.ts)

While Main is allowed to know about concretions, the current implementation violates OCP by being tightly coupled to GitHub's specific configuration types.

**Fix:** Introduce a `BackendFactory` interface in `ports.ts`.

#### P0-5: `ImpedimentPort` thinness — Use case layer is a pass-through

**File:** [`src/scrum/update-impediment.ts`](src/scrum/update-impediment.ts)

The use case layer adds zero business logic for impediment operations; it simply passes calls directly to the adapter. This violates the purpose of the Use Case layer.

#### P0-6: Lack of `Impediment` domain entity — Business logic leaked to adapter

**File:** [`src/domain/types.ts`](src/domain/types.ts)

There is no dedicated `Impediment` entity. Impediments are treated as a label on a `Story`. Consequently, all impediment-specific business rules (status transitions, resolution requirements) reside in the adapter layer (`backend.ts`), violating the principle that policy belongs in the inner layers.

---

### P1 — Fix Opportunistically

#### P1-1: `mappers.ts` imports `RuntimeConfig` — adapter types leak into mapper layer

**File:** [`src/adapters/github/mappers.ts`](src/adapters/github/mappers.ts)

Mappers take the full `RuntimeConfig` instead of just the required field subsets, making them harder to test in isolation.

#### P1-2: `queries.ts` performs file I/O at module init — violates testability

**File:** [`src/adapters/github/queries.ts`](src/adapters/github/queries.ts)

Module-level side effects (reading `.graphql` files) make unit testing difficult.

#### P1-3: `sprint-math.ts` uses hardcoded "done" comparison in `get-history.ts`

**File:** [`src/scrum/get-history.ts`](src/scrum/get-history.ts)

Inconsistent done-status detection due to bypassing config-driven terminal status.

#### P1-4: `BurndownStoryInput` defined in `ports.ts` but used by adapter layer

**File:** [`src/scrum/ports.ts`](src/scrum/ports.ts), [`src/adapters/github/mappers.ts`](src/adapters/github/mappers.ts)

The port type carries an adapter-specific `ref: { id }` field.

#### P1-5: `config-loader.ts` contains business logic (iteration classification)

**File:** [`src/adapters/github/config-loader.ts`](src/adapters/github/config-loader.ts)

Sprint classification logic belongs in the domain layer, not the adapter.

#### P1-6: String-based sprint association — Fragile regex matching

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

The system uses regex on issue bodies/comments to associate impediments with sprints rather than using structured data (e.g., an iteration field). This is highly fragile and prone to false positives.

---

### P2 — Note, May Be Fine

#### P2-1: `RuntimeConfig` mixes domain config with adapter metadata

**File:** [`src/adapters/github/config-loader.ts`](src/adapters/github/config-loader.ts)

The composite config type is owned by the adapter layer, inverting expected ownership.

#### P2-2: `error-enrichment.ts` re-exports `GitHubApiError` — leaks adapter types

**File:** [`src/services/error-enrichment.ts`](src/services/error-enrichment.ts)

Obscures dependency direction by making it appear the service layer owns the error type.

#### P2-3: `mutation-validator.ts` is a regex-based validator — fragile

**File:** [`src/services/mutation-validator.ts`](src/services/mutation-validator.ts)

Simple regex for GraphQL mutation detection is prone to edge cases.

---

## Workflow & Operational Analysis (Impediment Lifecycle)

### 1. Workflow Quantification: Log → Convert → Close

| Phase                       | Logical Steps                                                                                   | API Calls (Est.)           | Layers Crossed                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| **Log Impediment**          | Build input $\rightarrow$ Create Issue/Project Item $\rightarrow$ Post warning comments         | 2-3 (1 GraphQL + 0-1 REST) | Tool $\rightarrow$ Use Case $\rightarrow$ Backend $\rightarrow$ GitHub API |
| **Convert to Story-Linked** | Identify orphan $\rightarrow$ Re-log with `affects.story` $\rightarrow$ Cross-link via comments | 1-3 (1 GraphQL + 2 REST)   | Tool $\rightarrow$ Use Case $\rightarrow$ Backend $\rightarrow$ GitHub API |
| **Close Impediment**        | Fetch issue $\rightarrow$ Replace labels $\rightarrow$ Post resolution comment                  | 2-3 (1 GraphQL + 0-1 REST) | Tool $\rightarrow$ Use Case $\rightarrow$ Backend $\rightarrow$ GitHub API |

**Total Workflow Complexity**: ~10-11 steps and 5-9 API calls to complete a full lifecycle.

### 2. Operational Efficiency

- **Tracking Open Impediments**:
  - _Orphan Detection_: Efficient $O(n)$ scan of issues with `impediment` label, but relies on client-side comment scanning for the `PVTI_` pattern.
  - _Sprint Association_: **Poor efficiency and reliability**. Uses regex matching against issue bodies/comments rather than structured fields. This is a significant scalability and accuracy bottleneck.
- **Interdependency Tracking**: Relies entirely on comment-based cross-referencing (e.g., `PVTI_` patterns). While functional, it lacks the structural integrity of a relational model.

---

## Component Metrics (I/A/D)

| Component          | Ca (Fan-in) | Ce (Fan-out) | I = Ce/(Ca+Ce) | A (Abstractness) | D =  | A+I−1             | Verdict |
| ------------------ | ----------- | ------------ | -------------- | ---------------- | ---- | ----------------- | ------- |
| `domain/`          | 8           | 0            | 0.00           | 1.00             | 0.00 | **OK**            |         |
| `scrum/`           | 4           | 3            | 0.43           | 0.85             | 0.42 | **Drift**         |         |
| `services/`        | 6           | 4            | 0.40           | 0.60             | 0.00 | **OK**            |         |
| `adapters/github/` | 3           | 5            | 0.63           | 0.40             | 0.37 | **Drift**         |         |
| `tools/`           | 0           | 5            | 1.00           | 0.00             | 0.00 | **OK** (unstable) |         |

---

## SOLID Analysis

| Principle | Status   | Finding                                                                            |
| --------- | -------- | ---------------------------------------------------------------------------------- |
| **SRP**   | VIOLATED | `GitHubProjectBackend` (1269 lines) handles 6+ responsibilities                    |
| **OCP**   | AT RISK  | `createBackend()` in `index.ts` will need if/else for new backends                 |
| **LSP**   | OK       | No subtype violations detected                                                     |
| **ISP**   | OK       | `ProjectBackend` interface is focused; no kitchen-sink ports                       |
| **DIP**   | PARTIAL  | `ProjectBackend` is a good abstraction, but `resolver.ts` depends on adapter types |

---

## Dependency Direction Analysis

### Correct (inward-pointing):

- `tools/` $\rightarrow$ `scrum/` $\rightarrow$ `domain/` ✓
- `tools/` $\rightarrow$ `scrum/` $\rightarrow$ `services/` ✓
- `adapters/github/` $\rightarrow$ `domain/` ✓
- `adapters/github/` $\rightarrow$ `scrum/` (via `ports.ts`) ✓

### Violated (outward-pointing):

- `services/resolver.ts` $\rightarrow$ `adapters/github/config-loader.ts` ✗
- `services/pagination.ts` $\rightarrow$ `adapters/github/types.ts` ✗
- `services/github.ts` $\rightarrow$ `adapters/github/types.ts` ✗

---

## Scalability Bottlenecks

1. **`fetchAllItems()` in `GitHubProjectBackend`**: Every read tool calls this, fetching ALL project items paginated. For large projects (1000+ items), this is $O(n)$ per tool call with no caching.
2. **No query result caching**: Repeated calls by an agent session waste API quota.
3. **String-based Sprint Association**: The regex matching for sprint association scales poorly and becomes increasingly unreliable as the number of sprints grows.

---

## Recommended Actions (Sized)

| #  | Action                                                                                   | Effort    | Priority |
| -- | ---------------------------------------------------------------------------------------- | --------- | -------- |
| 1  | Extract `GitHubProjectBackend` into focused services (Label, Milestone, User, Field)     | ~3–5 days | P0       |
| 2  | Move `resolveSprint` to `scrum/` layer; remove `RuntimeConfig` import from `resolver.ts` | ~1 day    | P0       |
| 3  | Move `PaginatedProjectItemFetcher` into `adapters/github/` (it's GitHub-specific)        | ~1–2 days | P0       |
| 4  | Introduce `BackendFactory` interface to support OCP for new backends                     | ~1 day    | P0       |
| 5  | Move `classifyIterations` from `config-loader.ts` to `scrum/`                            | ~0.5 days | P1       |
| 6  | Split `RuntimeConfig` into `DomainConfig` + `RuntimeConfig`                              | ~2 days   | P1       |
| 7  | Defer `queries.ts` file I/O to factory function                                          | ~0.5 days | P1       |
| 8  | Fix hardcoded "done" comparison in `get-history.ts`                                      | ~0.5 days | P1       |
| 9  | **Introduce an `Impediment` domain entity in `src/domain/types.ts`**                     | ~2 days   | P0       |
| 10 | **Extract impediment status rules into `src/domain/rules/impediments.ts`**               | ~1 day    | P1       |
| 11 | **Refactor sprint association to use structured field checks instead of regex**          | ~2 days   | P1       |

---

## Monitoring to Add

- **Cycle detection in CI:** Use `dependency-cruiser` to fail on new dependency cycles.
- **Import restriction rules:** Enforce that `domain/` and `scrum/` never import from `adapters/`.
- **File size guard:** Lint rule warning for files exceeding 500 lines.

---

## Overall Health Assessment

**Score: 6.2/10** — The architecture has a **strong foundation** with a well-defined port (`ProjectBackend`) and clean domain types. However, the **massive `GitHubProjectBackend` class**, **dependency direction violations**, and **lack of structured impediment entities** represent significant technical debt. The project is currently in a "drifting" state; addressing the P0 items is critical before expanding functionality or adding new backends.
