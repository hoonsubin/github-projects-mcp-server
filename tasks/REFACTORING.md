# Refactoring Plan: Align Server to Architecture Vision

**Reference:** [`docs/ARCHITECTURE.MD`](../docs/ARCHITECTURE.MD) — the authoritative source of truth.

**Status (2026-06):** Server-side refactoring **complete**. Phases A, C, and D are done; Phase B exit gate is cleared. Remaining work is agent-skill migration and optional follow-ups listed in §6.

---

## 1. Problem Statement (original)

The architecture defines a clear boundary: **the MCP server is a structured fact retriever** that translates tool calls into platform API calls and normalizes results into stable Scrum-vocabulary types. It never applies Scrum rules, makes readiness judgments, or computes health assessments. **The SM agent is the Scrum intelligence layer** that receives raw facts and applies Scrum domain knowledge.

Before this refactoring, Scrum judgments — readiness evaluation, risk computation, burndown series construction, velocity calculation — were computed inside the server's adapter layer and returned as pre-digested outputs. That violated Invariant 2 ("Server Returns Facts; Agent Applies Judgment").

A prior 2025 plan addressed performance (redundant board scans, payload reduction, query consolidation). Those goals are achieved. This document tracked the next phase: moving Scrum computation out of the server.

---

## 2. Architectural Invariants (preserved)

| Invariant                                      | Status                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Invariant 1 — Dependency Rule**              | ✅ `domain/` imports nothing from outer layers; `scrum/` depends only on `domain/` and ports; `adapters/` implements the port; `tools/` goes through use-cases. |
| **Invariant 2 — Server Returns Facts**         | ✅ Judgment services removed; `scrum_get_sprint_data` returns raw per-item facts with completion timestamps.                                                    |
| **Invariant 3 — PBI Boundary**                 | ✅ Only Issues and Draft Issues become domain objects.                                                                                                          |
| **Invariant 4 — StoryKind**                    | ✅ `kind: "issue" \| "draft"` only.                                                                                                                             |
| **Invariant 5 — Filter Semantic Purity**       | ✅ [`item-filter.ts`](../src/adapters/github/query-strategies/item-filter.ts) predicates on Scrum-semantic fields only.                                         |
| **Invariant 8 — Tool Surface Stability**       | ✅ All `scrum_*` tool names preserved; deprecated tools return stubs, not 404s.                                                                                 |
| **Invariant 10 — Mapper Is Platform Boundary** | ✅ [`mappers.ts`](../src/adapters/github/mappers.ts) is the sole wire→domain translation point.                                                                 |
| **Post-mutation re-reads eliminated**          | ✅ [`composeStorySnapshot`](../src/adapters/github/read-services/story-query-service.ts) merges mutation-known fields over a single lean fetch.                 |
| **Aggregate query profile**                    | ✅ [`ProjectItemsQueryBuilder`](../src/adapters/github/query-pipeline/project-items-query-builder.ts) supports `ItemContentAggregate`.                          |
| **Session-scoped board cache**                 | ✅ [`BoardScanCoordinator`](../src/adapters/github/read-services/board-scan-coordinator.ts) wraps `ProjectItemsCache`.                                          |
| **Capability system**                          | ✅ Tri-state `NATIVE \| EMULATED \| UNAVAILABLE`.                                                                                                               |

---

## 3. Completed Work

### 3.1 Port interface cleaned (Phase C)

Removed from the port:

- `getBoardHealth()`, `getAnalytics()`, `getSprintCompletion()`
- `AnalyticsPort`, `BoardHealthPort`
- `ANALYTICS_VIEWS` domain vocabulary

Added and retained:

- `SprintDataPort.getSprintData(query)` → `SprintRawData`
- Focused ports: `FindItemsPort`, `StoryPort`, `EpicPort`, `ImpedimentPort`, `SprintDataPort`, `FileReaderPort`

### 3.2 Judgment services removed (Phase C)

Deleted adapter services and related dead code:

- `analytics-service.ts`, `board-health-service.ts`, `sprint-history-service.ts`, `burndown-calculator.ts`
- Server output types: `BacklogHealth`, `AnalyticsResult`, `BurndownResponse`, `SprintSnapshot`, etc.
- Domain readiness evaluation module (DoR scoring, risk-stance thresholds)
- `computeRiskStance()` and `SprintContext.riskStance`

Deprecated tool handlers (Invariant 8 — stubs, not removal):

- `scrum_get_board_health` → `{ deprecated: true, use: "scrum_get_sprint_data" }`
- `scrum_get_analytics` → same stub

### 3.3 Raw sprint data tool (Phase A)

- `scrum_get_sprint_data` registered with contract and golden tests
- `SprintDataService` in [`read-services/sprint-data-service.ts`](../src/adapters/github/read-services/sprint-data-service.ts)
- Completion timestamps via [`infra/completion-timestamps.ts`](../src/adapters/github/infra/completion-timestamps.ts) (`completionsFromBoardItems`)

**Implemented shape** (single sprint per call):

```typescript
interface SprintDataQuery {
  sprint_ref: SprintRef; // "current" | "next" | sprint name | null
}

interface SprintRawData {
  sprint: SprintInfo;
  items: SprintRawItem[]; // flat per-item facts with completedAt
}
```

The agent calls the tool once per sprint when computing velocity or history. A multi-sprint `history_window` payload was considered in early design but not implemented — the single-sprint shape is sufficient and matches `ARCHITECTURE.MD` data-flow diagrams.

### 3.4 Adapter structure (Phase D)

The `internal/` wrapper was removed. Subfolders now sit directly under `adapters/github/` per `ARCHITECTURE.MD`:

```
src/adapters/github/
├── backend.ts, mappers.ts, bootstrap.ts, types.ts, queries.ts  # adapter root vocabulary
├── query-pipeline/     # Board-scan loop, caching, pagination
├── query-strategies/   # findItems routing + normalization
├── read-services/      # Aggregation via board-scan coordinator
├── write-services/     # Mutations only
├── infra/              # HTTP client, ref resolution, completion timestamps
└── assemblers/         # Strategy implementations (pipeline ↔ strategy bridge)
```

Dep-cruiser Rule 7c enforces import boundaries between subfolders. Composition roots (`backend.ts`, `create-backend.ts`, `factory.ts`) are exempt from the query-pipeline import restriction.

### 3.5 Use-case layer flattened

`scrum/` root is now a table of contents for the tool surface:

| Root file                                                                                        | Role                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------- |
| `ports.ts`                                                                                       | `ProjectBackend` port interface |
| `orient.ts`, `find-items.ts`, `get-item-detail.ts`, `get-sprint-data.ts`, `update-impediment.ts` | One use-case per MCP tool       |
| `config-boot.ts`, `template-resource.ts`                                                         | Server startup / MCP resources  |
| `utils/`                                                                                         | Shared helpers — not use-cases  |

Moved to `scrum/utils/`:

- `listing-mappers.ts`, `sprint-math.ts`, `sprint-context.ts`
- `fetch-location.ts`, `resolve-location.ts`, `url-rewriters.ts`
- `acceptance-criteria.ts` (AC checkbox parsing for `get-item-detail` — structural extraction, not DoR judgment)

Moved out of `domain/`:

- `sprintContextFromSprintInfo()` → `scrum/utils/sprint-context.ts`
- Readiness/risk computation removed entirely (agent-side)

`domain/` now holds types, vocabulary constants, config schema, and error taxonomy only.

### 3.6 Test infrastructure consolidated

- Fixtures: [`src/test/fixtures/`](../src/test/fixtures/) (import via `@test/fixtures/`)
- Cross-layer tests: [`src/test/tools/`](../src/test/tools/), [`src/test/support/`](../src/test/support/)
- Agent parity gate: [`src/test/evaluation/`](../src/test/evaluation/) — Phase B exit gate cleared per [`report.md`](../src/test/evaluation/report.md)

---

## 4. Phase Completion Summary

| Phase | Goal                                                            | Status                                   |
| ----- | --------------------------------------------------------------- | ---------------------------------------- |
| **A** | Add `scrum_get_sprint_data` (non-breaking)                      | ✅ Complete                              |
| **B** | Agent computes judgments from raw data; parity gate             | ✅ Gate cleared (`src/test/evaluation/`) |
| **C** | Remove server-side computation; port cleanup; deprecation stubs | ✅ Complete                              |
| **D** | Adapter subfolder contract + dep-cruiser rules                  | ✅ Complete                              |

Verification commands (all pass):

```bash
deno task test
deno task depcruise
deno lint src/
```

---

## 5. Target Architecture (achieved)

The server returns two categories of data:

1. **Per-item facts** — `scrum_find_items`: title, status, story points, sprint, assignee, labels, dependencies. No aggregation.
2. **Raw sprint data** — `scrum_get_sprint_data`: flat item list per sprint with `completedAt` timestamps. No burndown series, no health metrics.

The agent applies all aggregation, counting, evaluation, and computation on top of these sources.

### Port contract (current)

**Read:** `getPlatformState`, `getEpics`, `findItems`, `getStoryDetail`, `getSprintData`, `getSprintImpediments`, `getOrphanImpediments`, `fetchContent`

**Write:** `createStory`, `createImpediment`, `updateStory`, `setField`, `addComment`, `updateImpediment`, `addVocabulary`

### Agent responsibilities (exclusive)

| Computation          | Server input                                 | Agent logic                                     |
| -------------------- | -------------------------------------------- | ----------------------------------------------- |
| Sprint risk stance   | Sprint dates, item status counts             | Compare time elapsed % vs. completion %         |
| Burndown series      | Per-item `completedAt`, sprint dates, points | Day-by-day remaining-points calculation         |
| Ideal burndown line  | Sprint duration, committed points            | Arithmetic line from committed to zero          |
| Velocity             | Completed sprint history                     | Average over N sprints (agent chooses window)   |
| Readiness assessment | Item body, estimates, dependency flags       | Evaluate against DoR criteria from config       |
| Backlog health       | Per-item fields from `scrum_find_items`      | Count and categorize by readiness, risk signals |
| Acceptance criteria  | Story body text                              | Parse checklist from markdown                   |

---

## 6. Remaining / Follow-up Work

These items are **out of server scope** or deferred:

| Item                                                   | Owner                       | Notes                                                                                                                                            |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent skill full cutover                               | `.roo/skills/scrum-master/` | Skill has deprecation notices; primary path should be `scrum_get_sprint_data` + `scrum_find_items` for all analytics/health workflows.           |
| Hard removal of deprecated tools                       | Future release              | `scrum_get_board_health` and `scrum_get_analytics` stubs remain for Invariant 8. Remove only after confirming no active sessions reference them. |
| Multi-sprint `getSprintData` payload                   | Optional                    | Current single-sprint-per-call design is sufficient; add `history_window` only if agent round-trips become a measurable cost.                    |
| `computeSprintEndDate` in `scrum/utils/sprint-math.ts` | Low priority                | Pure date math still used by adapter mappers for sprint metadata. Not a Scrum judgment; could move to `services/` for stricter layer purity.     |
| Regenerate `docs/AUDIT.md`                             | Maintenance                 | Audit report still references pre-refactor `internal/` paths. Run `deno task audit` to refresh.                                                  |

---

## 7. Boundaries for Agent-Side Implementation

Server scope ends at raw data delivery. Agent maintainers own:

- Exact burndown algorithm (missing timestamps, partial-day completion)
- Velocity window policy (last N sprints, weighted average, trim outliers)
- Risk thresholds (time-to-completion ratio for "elevated")
- Readiness criteria weights (how many DoR criteria must pass)
- Coaching language (how findings are presented to the human)

The server provides raw data. The agent makes policy decisions.
