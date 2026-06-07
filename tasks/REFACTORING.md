# Refactoring Plan: Align Server to Architecture Vision

**Reference:** [`docs/ARCHITECTURE.MD`](../docs/ARCHITECTURE.MD) — the source of truth for the target state.

---

## 1. Problem Statement

The architecture defines a clear boundary: **the MCP server is a structured fact retriever** that translates tool calls into platform API calls and normalizes results into stable Scrum-vocabulary types. It never applies Scrum rules, makes readiness judgments, or computes health assessments. **The SM agent is the Scrum intelligence layer** that receives raw facts and applies Scrum domain knowledge.

The current codebase violates this boundary. Scrum judgments — readiness evaluation, risk computation, burndown series construction, velocity calculation — are computed inside the server's adapter layer and returned as pre-digested outputs. This makes agent behavior opaque (the agent cannot explain why a judgment was made) and non-adjustable (changing a threshold requires a server deployment).

The 2025 refactoring plan (previous version of this document) focused on performance: eliminating redundant board scans, reducing payload sizes, and consolidating query paths. Those performance goals are largely achieved. This document addresses the next phase: moving Scrum computation out of the server so the architecture invariant "Server Returns Facts; Agent Applies Judgment" holds end-to-end.

---

## 2. What's Already Aligned

Several architectural invariants are fully satisfied. These must be preserved during the refactoring.

| Invariant                                          | Status                                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Invariant 1 — Dependency Rule**                  | ✅ `domain/` imports nothing from outer layers; `scrum/` depends only on `domain/` and the port interface; `adapters/` implements the port; `tools/` goes through use cases.      |
| **Invariant 3 — PBI Boundary**                     | ✅ Only Issues and Draft Issues become domain objects. PRs/MRs return null at the mapper.                                                                                         |
| **Invariant 4 — StoryKind**                        | ✅ `kind: "issue" \| "draft"` only. No platform content types leak into the discriminant.                                                                                         |
| **Invariant 5 — Filter Semantic Purity**           | ✅ [`item-filter.ts`](../src/adapters/github/internal/item-filter.ts) predicates on Scrum-semantic fields only.                                                                   |
| **Invariant 10 — Mapper Is the Platform Boundary** | ✅ [`mappers.ts`](../src/adapters/github/mappers.ts) is the sole translation point from wire types to domain types.                                                               |
| **Capability System**                              | ✅ Tri-state `NATIVE \| EMULATED \| UNAVAILABLE` — not booleans.                                                                                                                  |
| **Post-mutation re-reads eliminated**              | ✅ [`composeStorySnapshot`](../src/adapters/github/internal/story-query-service.ts:163) merges mutation-known fields over a single lean fetch — no full `getStoryDetail` re-read. |
| **`resolveRef({number})` direct lookup**           | ✅ Uses `GetIssueProjectItem` — no board scan for number→ID resolution.                                                                                                           |
| **Aggregate query profile**                        | ✅ [`ProjectItemsQueryBuilder`](../src/adapters/github/internal/project-items-query-builder.ts:32) supports `ItemContentAggregate` with ~60-80% payload reduction.                |
| **Session-scoped board cache**                     | ✅ [`BoardScanCoordinator`](../src/adapters/github/internal/board-scan-coordinator.ts) wraps `ProjectItemsCache` for deduplication within a session.                              |
| **Sprint completion via aggregates**               | ✅ [`sprintCompletionFromAggregates`](../src/adapters/github/mappers.ts:542) uses `ItemAggregate` (not full `Story`) for the completion count.                                    |
| **Tool Surface Stability** (Invariant 8)           | ✅ `scrum_*` tool names and parameter shapes must not change — and will not during this refactor.                                                                                 |

---

## 3. Gap Analysis

### 3.1 Server Computes Scrum Judgments (Invariant 2 violation)

The adapter and domain layers currently produce values that require Scrum knowledge to compute. The ARCHITECTURE.MD explicitly lists these as agent responsibilities.

| What the server currently computes                     | Where                                                                                                               | Why it's a judgment                                                                        | Should move to |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------- |
| Readiness-by-type breakdown (DoR evaluation)           | Adapter health service calls domain-level readiness rules to score each story                                       | Evaluates story body format, estimates, AC presence, dependencies — Scrum DoR criteria     | Agent skill    |
| Story-level DoR evaluation (user-story format, AC)     | Domain-level readiness rules module: regex-based detection, AC parsing                                              | Detecting user-story format and AC presence requires Scrum domain knowledge                | Agent skill    |
| Sprint risk counts (unestimated, blocked, no-assignee) | Adapter health service counts items by risk signals                                                                 | Counts items by Scrum risk signals — requires knowing what "blocked" means                 | Agent skill    |
| Ungroomed count                                        | Adapter health service identifies stories missing type, estimate, or AC                                             | Judgment call: "missing type OR estimate OR AC"                                            | Agent skill    |
| Burndown series (actual + ideal line)                  | Adapter analytics service builds day-by-day burndown from completion timestamps                                     | Computes burndown series from timestamps — agent domain per ARCHITECTURE.MD § Design Notes | Agent skill    |
| Sprint velocity/history snapshots                      | Adapter analytics service aggregates completed sprints into velocity records                                        | Aggregates completed sprints into velocity records — agent domain                          | Agent skill    |
| Sprint risk stance (normal/monitor/elevated)           | Domain-level function compares time-elapsed % against work % with hardcoded thresholds; called from orient use case | Time vs. work comparison with fixed risk thresholds — Scrum judgment                       | Agent skill    |
| Overall readiness percentage                           | Adapter health service derives percentage from per-story readiness scores                                           | Percentage of "ready" stories — derived from DoR evaluation                                | Agent skill    |

**Root cause:** The port interface has methods (`getBoardHealth`, `getAnalytics`) that return pre-computed Scrum artifacts. The agent receives ready-made judgments instead of raw facts.

### 3.2 Port Interface Has Computation-Oriented Methods (Invariant 9)

The port interface ([`src/scrum/ports.ts`](../src/scrum/ports.ts)) defines separate `AnalyticsPort`, `BoardHealthPort`, and `ImpedimentPort` interfaces that return derived types:

- `getBoardHealth(sprintScope)` → `BacklogHealth` — derived type with readiness, risk, impediment counts
- `getAnalytics(query)` → `AnalyticsResult` — derived type with pre-computed burndown series
- `getSprintCompletion(iterationId)` → `{ completed, total }` — computed count (borderline; could be a raw fact but is currently a derived aggregation)

The ARCHITECTURE.MD § "BackendPort Contract" describes a simpler port: `getSprintData(query)` returns raw sprint items with completion timestamps; `findItems(filter)` returns raw item listings. The architecture diagram shows no `getBoardHealth` or `getAnalytics` on the port — those are agent-level compositions.

### 3.3 Adapter Internal Structure (Five-Subfolder Contract)

The ARCHITECTURE.MD § "Adapter Subfolder Contract" prescribes five subdirectories with enforced import boundaries:

| Subfolder           | Responsibility                                           |
| ------------------- | -------------------------------------------------------- |
| `query-pipeline/`   | Board-scan loop: query building, caching, pagination     |
| `query-strategies/` | Routes `findItems`; normalizes raw pages to domain types |
| `read-services/`    | Aggregates via coordinator; no direct pagination         |
| `write-services/`   | Mutations only                                           |
| `infra/`            | API client, context, ref resolution — no business logic  |

The current structure has all services in a flat [`internal/`](../src/adapters/github/internal/) directory with an [`assemblers/`](../src/adapters/github/internal/assemblers/) subdirectory. There are no dep-cruiser rules enforcing import boundaries between these roles. While the conceptual separation exists (query builder → execution engine is a pipeline; services delegate to the coordinator), the directory structure does not encode the contract.

### 3.4 Domain Types Mix Server and Agent Shapes

`domain/types.ts` exports types that the server currently produces but should be agent-produced:

- `BurndownResponse`, `BurndownDayPoint`, `IdealDayPoint` — used by the server's analytics path
- `SprintContext` with `riskStance` — computed in the domain layer, called from orient use case
- `SprintSnapshot`, `SprintTotals` — produced by the adapter's analytics service
- `BacklogHealth`, `SprintRisk`, `ReadinessBreakdown` — produced by the adapter's health service

These types describe valid Scrum concepts. The issue is not the types themselves but the layer that produces them. After refactoring, they should still exist but be produced by the agent from raw server data, not by the server.

### 3.5 Domain Layer Contains Runtime Scrum Computation

The domain layer's structural contract (ARCHITECTURE.MD § "Source-Code Structure") states that `domain/` exports should be type declarations or vocabulary constants only — no runtime computation. Two violations exist:

- **Readiness evaluation logic.** The domain layer contains functions that evaluate Definition of Ready criteria: user-story format detection, acceptance criteria checkbox parsing, and "story too large for a sprint" heuristics. These are Scrum judgments — they require knowing what a user story looks like and what constitutes readiness. The adapter's health service calls these functions to produce readiness-by-type breakdowns. Both the domain-level rules module and the adapter's call site must be addressed.

- **Risk stance computation.** The domain layer contains a function that compares time-elapsed percentage against work-completion percentage using hardcoded thresholds (110%, 130%) to produce a `normal | monitor | elevated` verdict. This is called from the orient use case to populate `SprintContext.riskStance`. The thresholds are policy decisions, not facts, and the computation is a Scrum judgment.

Both functions violate the Dependency Rule in a subtle way: they are policy code (Scrum rules) living in the innermost layer (entities/domain). Their callers in the use-case and adapter layers also violate Invariant 2 by consuming pre-computed judgment values. The fix for both violations is the same: remove the functions from the server entirely and reimplement the logic in the agent skill.

---

## 4. Target Architecture

### 4.1 Principle

The server returns two categories of data:

1. **Per-item facts** — what `scrum_find_items` already returns: title, status, story points, sprint, assignee, labels, dependencies. One item per row. No aggregation, no counting, no evaluation.

2. **Raw sprint data** — what a new `scrum_get_sprint_data` tool will return: items in a sprint with their completion timestamps (when available from the platform audit log). Timestamps are facts — the platform recorded when something happened. The agent uses these timestamps to compute burndown, velocity, and trends.

The agent applies all aggregation, counting, evaluation, and computation on top of these two data sources.

### 4.2 Clean Port Interface

The port simplifies to the methods declared in ARCHITECTURE.MD § "BackendPort Contract":

**Read methods (unchanged):**

| Method                         | Returns                                    |
| ------------------------------ | ------------------------------------------ |
| `getPlatformState(vocabulary)` | Platform state with vocabulary gaps        |
| `getEpics(sprintRef?)`         | Epic list                                  |
| `findItems(filter)`            | Item listings                              |
| `getStoryDetail(ref)`          | Item with body, comments, linked artifacts |
| `getOrphanImpediments()`       | Impediment listings                        |
| `fetchContent(location)`       | Template content                           |

**Read methods (new):**

| Method                 | Returns                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `getSprintData(query)` | Raw sprint items with completion timestamps — replaces `getAnalytics`, `getBoardHealth`, and `getSprintCompletion` |

**Write methods (unchanged):**

| Method                          | Returns                         |
| ------------------------------- | ------------------------------- |
| `createStory(input)`            | Item reference                  |
| `createImpediment(input)`       | Impediment reference + item ref |
| `updateStory(ref, updates)`     | void                            |
| `setField(ref, field, value)`   | void                            |
| `addComment(ref, body)`         | void                            |
| `updateImpediment(ref, update)` | Updated impediment listing      |
| `addVocabulary(kind, value)`    | Create result                   |

`getAnalytics`, `getBoardHealth`, and `getSprintCompletion` are removed from the port. Use cases that need sprint data call `getSprintData()`.

### 4.3 What `getSprintData` Returns

```typescript
interface SprintDataQuery {
  sprint_ref: "current" | "next" | string; // sprint name
  history_window?: number; // how many completed sprints to include
}

interface SprintRawData {
  active_sprint: {
    info: SprintInfo; // name, dates, duration
    items: SprintDataItem[]; // per-item facts
  } | null;
  completed_sprints: {
    info: SprintInfo;
    items: SprintDataItem[];
  }[];
}

interface SprintDataItem {
  issue_number: number | null; // null for draft items
  title: string | null;
  story_points: number | null;
  status: string | null; // display name from board
  completed_at: string | null; // ISO-8601 timestamp from audit log or close proxy
  sprint_name: string | null;
  type: string | null;
  has_assignee: boolean;
  has_blockers: boolean;
}
```

Key design decisions:

- **No aggregation.** The server returns a flat item list per sprint. The agent counts, groups, and computes.
- **Completion timestamps are facts.** The platform records when a status changed. The adapter retrieves this (from audit log, timeline, or issue close date) and returns it raw.
- **Sprint metadata is facts.** Start date, end date, duration — these come from the platform iteration configuration.
- **The agent chooses the history window.** The `history_window` parameter controls how many completed sprints to return, but the agent decides what window to request based on its own velocity-calculation policy.
- **Type design.** The `SprintDataItem` type represents the minimal per-item fact set needed for agent-side analytics. Where existing port types already capture equivalent fields (e.g., `ItemAggregate`), prefer extending them with a `completed_at` field rather than introducing a parallel type family. The principle: one canonical per-item projection, not multiple overlapping shapes.

### 4.4 Agent Responsibilities (clear boundary)

After refactoring, these computations move exclusively to the agent:

| Computation          | Input from server                                              | Agent logic                                     |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| Sprint risk stance   | Sprint dates, item status counts                               | Compare time elapsed % vs. completion %         |
| Burndown series      | Per-item completion timestamps, sprint dates, committed points | Day-by-day remaining-points calculation         |
| Ideal burndown line  | Sprint duration, committed points                              | Arithmetic line from committed to zero          |
| Velocity             | Completed sprint history windows                               | Average or weighted average of completed points |
| Readiness assessment | Per-item body text, estimates, dependency flags                | Evaluate against DoR criteria from config       |
| Backlog health       | Per-item fields                                                | Count and categorize by readiness, risk signals |
| Acceptance criteria  | Story body text                                                | Parse checklist from markdown                   |
| Sprint context       | Sprint dates                                                   | Compute days elapsed, remaining, risk stance    |

### 4.5 Adapter Structure (Five-Subfolder Contract)

The adapter internal directory is restructured to match the ARCHITECTURE.MD contract. Files at the adapter root (`backend.ts`, `mappers.ts`, `bootstrap.ts`, `types.ts`) remain as the adapter's shared vocabulary.

```
src/adapters/github/
├── backend.ts                    # Concrete BackendPort
├── mappers.ts                    # Wire → domain translation
├── bootstrap.ts                  # Platform boot state
├── types.ts                      # Adapter-internal types
├── queries.ts                    # GraphQL fragments (shared vocabulary)
├── ...
├── query-pipeline/               # Board scan loop
│   ├── project-items-query-builder.ts
│   ├── project-items-cache.ts
│   ├── execution-engine.ts
│   └── pagination.ts
├── query-strategies/             # findItems routing + normalization
│   ├── filter-strategy-router.ts
│   └── result-normalizer.ts
├── read-services/                # Data aggregation via coordinator
│   ├── board-scan-coordinator.ts
│   ├── story-query-service.ts
│   ├── epic-service.ts
│   ├── impediment-service.ts
│   └── sprint-data-service.ts    # NEW: getSprintData implementation
├── write-services/               # Mutations only
│   ├── story-mutation-service.ts
│   ├── field-value-mutator.ts
│   ├── label-resolver.ts
│   ├── vocabulary-manager.ts
│   └── user-milestone-resolver.ts
├── infra/                        # API client, ref resolution
│   ├── http-client.ts
│   ├── infra-context.ts
│   ├── resolver.ts
│   ├── resolve-issue-number.ts
│   ├── config-reloader.ts
│   ├── concurrent.ts
│   └── file-reader.ts
└── assemblers/                   # Assembler pipeline (strategy implementations)
    ├── project-items-assembler.ts
    ├── direct-lookup-assembler.ts
    ├── search-api-assembler.ts
    ├── mixed-assembler.ts
    └── assembler-output.ts
```

Note: `assemblers/` is intentionally kept as a peer to the five subfolders — assemblers are strategy implementations that span query construction and normalization, and they are the only consumers allowed to bridge pipeline ↔ strategy boundaries.

**Services removed during refactoring:**

- `analytics-service.ts` — burndown + history computation moves to agent
- `board-health-service.ts` — readiness + risk computation moves to agent
- `sprint-history-service.ts` — velocity computation moves to agent
- `burndown-calculator.ts` — burndown series computation moves to agent

**Domain rules module removed:**

- The readiness evaluation functions in the domain layer — user-story format detection, AC checkbox parsing, "too large for sprint" heuristics — are removed. Readiness evaluation is agent-side judgment. This also restores the domain layer's contract of containing only type declarations and vocabulary constants.

### 4.6 Domain Types Cleanup

Types that the server no longer produces are removed from the server's domain output schemas:

| Type                                                    | Action                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `BurndownResponse`, `BurndownDayPoint`, `IdealDayPoint` | Remove from server output schemas; agent defines its own             |
| `SprintSnapshot`, `SprintTotals`                        | Remove from server output schemas                                    |
| `BacklogHealth`, `SprintRisk`, `ReadinessBreakdown`     | Remove from server output schemas                                    |
| `AnalyticsResult`                                       | Remove from server output schemas                                    |
| `SprintContext.riskStance`                              | Remove `riskStance` field; sprint context stays as dates+counts only |
| `sprintContextFromSprintInfo()`                         | Remove `riskStance` computation; function returns dates only         |
| `computeRiskStance()`                                   | Move to agent                                                        |

**Pure math utilities.** Functions that perform pure arithmetic on dates and numbers (`buildIdealLine`, `buildDaySeries`, `computeSprintEndDate`) are not Scrum judgments — they are deterministic transformations. After the refactoring, the server no longer calls them. They are marked as deprecated in the server codebase with a comment directing readers to the agent skill where equivalent logic should live. They are removed from the server in a follow-up once agent-side parity is confirmed.

**Listing mapper cleanup.** The `historyEntryToItemListing()` function in `listing-mappers.ts` converts history-specific story shapes to item listings. Its only caller is the adapter's analytics service. After that service is removed in Phase C, this function is dead code and is removed.

---

## 5. Implementation Strategy (Phased)

All phases respect Invariant 8 (Tool Surface Stability): `scrum_*` tool names, parameter shapes, and response schemas must not change in a breaking way.

### Phase A — Add `scrum_get_sprint_data` Tool (Non-breaking)

Add a new MCP tool that returns raw sprint data. The existing `scrum_get_board_health` and `scrum_get_analytics` tools continue to work unchanged.

**A1.** Define `SprintDataQuery` and `SprintRawData` types in the port interface. Prefer extending existing types (e.g., `ItemAggregate`) with a `completed_at` field over introducing fully independent types.

**A2.** Add `getSprintData(query)` to the port interface (`ProjectReader`).

**A3.** Implement `SprintDataService` in the adapter that:

- Fetches sprint items via the aggregate board scan (already cached via the coordinator)
- Retrieves completion timestamps from the audit log. The timestamp-extraction logic — deriving a `completed_at` from platform events (audit log, issue close date, or status-change proxy) — already exists in the adapter layer, likely split across the burndown calculator and a dedicated completion-extraction utility. Locate these utilities and reuse them; do not duplicate the derivation logic in the new service.
- Returns `SprintRawData` — no aggregation, no series computation

**A4.** Register `scrum_get_sprint_data` as a new MCP tool.

**A5.** Add contract tests for the new tool (schema validation against `SprintRawData` shape).

### Phase B — Agent Skill Update

Update the SM agent skill to use the new tool and compute its own judgments from raw data.

**B1.** Agent calls `scrum_get_sprint_data` instead of `scrum_get_analytics` + `scrum_get_board_health`.

**B2.** Agent implements burndown series computation, velocity calculation, readiness assessment, and sprint risk evaluation in the skill layer.

**B3.** Agent implements `buildIdealLine` and `buildDaySeries` logic (or reuses sprint-math as a skill-internal utility).

This phase validates that the server's raw data is sufficient for the agent to produce equivalent-quality Scrum judgments. Run agent evaluations against both the old tools and the new tool to confirm output parity.

**Phase B exit gate:** Phase C must not begin until Phase B's evaluation suite confirms output parity. Phase C removes the server's computation paths with no rollback — if the agent work is incomplete or producing subtly wrong results, starting Phase C eliminates the fallback. Treat the Phase B evaluation sign-off as a hard prerequisite.

### Phase C — Remove Server-Side Computation (Port Cleanup)

**Prerequisite:** Phase B evaluation parity confirmed (see above). Do not begin Phase C until that gate is cleared.

Once the agent is fully migrated to `scrum_get_sprint_data`:

**C1.** Remove `getBoardHealth()`, `getAnalytics()`, and `getSprintCompletion()` from the port interface. Before removing `getSprintCompletion`, trace all its call sites in the use-case layer and replace each with an equivalent `getSprintData()` call scoped to the relevant sprint reference. Do not remove the port method until all call sites are redirected.

**C2.** Deprecate `scrum_get_board_health` and `scrum_get_analytics` by replacing their implementations with a stub that returns `{ deprecated: true, use: "scrum_get_sprint_data" }`. Do not remove the tool registrations outright — removing a named tool is a breaking change that violates Invariant 8. Stubs preserve the tool surface while signaling migration. Schedule hard removal only after confirming no active agent sessions reference the old tool names.

**C3.** Remove adapter services that compute Scrum judgments:

- Health service (readiness-by-type, sprint risk counts, ungroomed count)
- Analytics service (burndown series, velocity history)
- Sprint history service (completed sprint aggregation)
- Burndown calculator (burndown data collection and series computation)
- Timestamp-extraction utilities that were only called by the removed services (e.g., any module whose sole purpose is deriving completion timestamps for burndown input — if it is no longer called by `SprintDataService`, it is dead code). If a timestamp-extraction utility is shared with `SprintDataService` (Phase A3), keep it; otherwise remove it.

Also remove dead code that was only called by these services:

- `historyEntryToItemListing()` in listing-mappers (only caller was analytics service)

**C4.** Remove `BacklogHealth`, `AnalyticsResult`, `BurndownResponse`, `SprintSnapshot`, and related types from server output schemas.

**C5.** Remove Scrum computation from the domain and use-case layers:

- Remove the domain-level readiness evaluation module entirely. Readiness assessment (user-story format detection, AC parsing, "too large" heuristics) is agent-side judgment. This restores the domain layer's "zero runtime computation" contract.
- Remove `sprintContextFromSprintInfo()` risk-stance computation; `SprintContext` becomes dates-only metadata.
- Remove `computeRiskStance()` — thresholds are agent policy, not server facts.
- Mark pure math functions in sprint-math as deprecated with a comment directing readers to the agent skill. Remove from the server in a follow-up once agent evaluation parity is confirmed.

**C6.** Remove `AnalyticsPort`, `BoardHealthPort` from the port interface; keep only the focused ports that survive (`FindItemsPort`, `StoryPort`, `EpicPort`, `ImpedimentPort`).

### Phase D — Adapter Structure (Subfolder Contract)

Restructure the adapter to match the five-subfolder contract from ARCHITECTURE.MD.

**D1.** Create the five subdirectories under `internal/`: `query-pipeline/`, `query-strategies/`, `read-services/`, `write-services/`, `infra/`.

**D2.** Move files into their contract directories. Before moving, classify every file currently in the flat `internal/` directory by its primary responsibility using these rules:

| Responsibility                                                                                | Destination         |
| --------------------------------------------------------------------------------------------- | ------------------- |
| GraphQL query construction, pagination state, cache management                                | `query-pipeline/`   |
| Filter routing, result normalization from raw wire pages to domain types                      | `query-strategies/` |
| Data aggregation via the coordinator; read orchestration                                      | `read-services/`    |
| Mutations only (no reads)                                                                     | `write-services/`   |
| API client, request plumbing, ref resolution, config, concurrency helpers — no business logic | `infra/`            |

Any file that does not fit cleanly into one subfolder likely has mixed responsibilities and should be split at the function boundary before moving. Document the classification decisions in a short comment at the top of each moved file (e.g., `// read-services: aggregates sprint data via board coordinator`).

**D3.** Add dep-cruiser rules enforcing import boundaries:

- `query-pipeline/` may only be imported by `query-strategies/` and `read-services/` (via the coordinator)
- `query-strategies/` may not import `read-services/` or `write-services/`
- `read-services/` may not import the paginator directly or import `write-services/`
- `write-services/` may not import `query-pipeline/`
- `infra/` may not import any service folder

**D4.** Remove dead assembler-output references from service imports (assembler types stay with assemblers).

---

## 6. Boundaries for Agent-Side Implementation

This refactoring plan is scoped to the server. The agent skill must be updated in parallel, but specific agent implementation decisions belong to the agent skill maintainers. The following agent-side design questions are out of server scope:

- Exact burndown algorithm (how to handle missing timestamps, partial-day completion)
- Velocity window policy (last N sprints, weighted average, trim outliers)
- Risk thresholds (what time-to-completion ratio triggers "elevated")
- Readiness criteria weights (how many DoR criteria must pass for "ready")
- Coaching language (how the agent presents findings to the human)

The server provides raw data. The agent makes policy decisions.

---

## 7. Verification

After each phase:

- **Phase A:** `deno task test` passes; new `scrum_get_sprint_data` tool returns schema-valid JSON; contract test covers new tool.
- **Phase B:** Agent evaluation suite produces equivalent (or better) Scrum judgments using raw data vs. pre-computed data.
- **Phase C:** Phase B gate was cleared before this phase began. `deno task depcruise` passes; no references to removed services; port interface is clean; domain layer contains no runtime Scrum computation (verify: no imports of removed readiness functions, no callers of removed risk-stance logic). `scrum_get_board_health` and `scrum_get_analytics` respond with a deprecation stub, not a 404 or missing-tool error.
- **Phase D:** `deno task depcruise` with new rules passes; adapter directory structure matches ARCHITECTURE.MD.

No phase introduces breaking changes to existing `scrum_*` tool names or parameter shapes.
