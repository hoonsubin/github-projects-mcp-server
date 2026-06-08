# Issues Creation Checklist — Server Refactoring

**Epic:** Server Refactoring — Align MCP Scrum Server to Architecture Vision
**Reference:** [`docs/ways-of-work/plan/server-refactoring/project-plan.md`](/docs/ways-of-work/plan/server-refactoring/project-plan.md)

---

## Pre-Creation Preparation

### Repository Setup

- [ ] Epic milestone created: `V2 Architecture Alignment` with target milestone
- [ ] GitHub project board configured with Kanban columns (Backlog, Sprint Ready, In Progress, In Review, Testing, Done)
- [ ] Custom fields configured: Priority (P0-P3), Value (High/Medium/Low), Component (Server/Agent-Skill/Infrastructure/Testing), Estimate (story points)
- [ ] Labels created: `epic`, `feature`, `user-story`, `enabler`, `test`, `priority-critical`, `priority-high`, `priority-medium`, `priority-low`, `value-high`, `value-medium`, `value-low`, `server`, `agent-skill`, `infrastructure`, `architecture`
- [ ] Automation rules defined for status transitions (e.g., PR opened → "In Review", PR merged → "Testing")
- [ ] Team capacity assessed: who implements server-side (Phases A, C, D) vs. agent-side (Phase B)

### Issue Number Pre-allocation

Pre-allocate issue numbers for all issues so templates can reference each other. The following block shows the suggested numbering scheme (replace `#N` with actual numbers after creation):

```
#1   — Epic: Server Refactoring (epic)
#2   — Feature: Add scrum_get_sprint_data Tool (feature)
#3   — Feature: Agent Skill Update (feature)
#4   — Feature: Remove Server-Side Computation (feature)
#5   — Feature: Adapter Restructure Five-Subfolder Contract (feature)
#6   — Story SA1: Define SprintDataQuery + SprintRawData types (user-story)
#7   — Story SA2: Add getSprintData to ProjectReader port (user-story)
#8   — Enabler EA31: Extend ItemAggregate with completed_at field (enabler)
#9   — Enabler EA32: Extract burndown-completion.ts to infra/ (enabler)
#10  — Story SA3: Implement SprintDataService (user-story)
#11  — Story SA4: Register scrum_get_sprint_data MCP tool (user-story)
#12  — Story SA5: Add handler + use-case layer (user-story)
#13  — Test TA1: Contract tests for new tool output schema (test)
#14  — Story SB1: Update SKILL.md to call scrum_get_sprint_data (user-story)
#15  — Story SB2: Implement agent burndown + velocity (user-story)
#16  — Story SB3: Implement agent readiness + risk (user-story)
#17  — Enabler SB4: Create agent evaluation suite for output parity (enabler)
#18  — Story SC1: Port cleanup — remove 3 computation methods + redirect (user-story)
#19  — Story SC2: Replace tools with deprecation stubs (user-story)
#20  — Story SC3: Remove 4 adapter computation services (user-story)
#21  — Story SC4: Remove dead code (historyEntryToItemListing, aggregateToBurndownInput) (user-story)
#22  — Story SC5: Remove domain readiness rules + risk-stance (user-story)
#23  — Story SC6: Remove output schema types (user-story)
#24  — Test TC1: Regression tests for stub responses (test)
#25  — Test TC2: Dep-cruiser compliance (test)
#26  — Enabler SD1: Create 5 subdirectories under internal/ (enabler)
#27  — Story SD2: Classify and move ~37 files to contract locations (user-story)
#28  — Enabler SD3: Add dep-cruiser internal boundary rules (enabler)
#29  — Story SD4: Split mixed-responsibility files (user-story)
#30  — Test TD1: Dep-cruiser boundary rule tests (test)
```

---

## Epic Level Issue

### Checklist for Issue #1 — Server Refactoring Epic

- [ ] **Epic issue created** using template from §3.1 of project-plan.md
- [ ] **Title:** `Epic: Server Refactoring — Align MCP Scrum Server to Architecture Vision`
- [ ] **Body includes:**
  - [ ] Epic description summarizing the four-phase approach
  - [ ] Business value section (Invariant 2 restoration, agent transparency)
  - [ ] Epic acceptance criteria (all 10 criteria from §3.1)
  - [ ] Feature list with references to #2, #3, #4, #5
  - [ ] Definition of Done
- [ ] **Labels applied:** `epic`, `priority-critical`, `value-high`, `architecture`
- [ ] **Milestone assigned:** V2 Architecture Alignment
- [ ] **Added to project board** in "Backlog" column
- [ ] **T-shirt size:** L (20-40 SP across 4 phases)

---

## Feature Level Issues

### Checklist for Issue #2 — Feature A: Add `scrum_get_sprint_data` Tool

- [ ] **Feature issue created** using template from §3.2 of project-plan.md
- [ ] **Body includes:**
  - [ ] Feature description
  - [ ] User story references: #6, #7, #10, #11, #12
  - [ ] Enabler references: #8, #9
  - [ ] Test references: #13
  - [ ] **Blocks:** #3 (Feature B) explicitly stated
  - [ ] **Blocked by:** Nothing
  - [ ] Acceptance criteria (all 10 from §3.2)
  - [ ] Definition of Done
- [ ] **Labels applied:** `feature`, `priority-high`, `value-high`, `server`
- [ ] **Epic:** #1
- [ ] **Estimate:** 8 story points
- [ ] **Added to project board** in "Backlog" column
- [ ] **All dependent stories and enablers created** (see story-level checklist below)

### Checklist for Issue #3 — Feature B: Agent Skill Update

- [ ] **Feature issue created** using template from §3.3 of project-plan.md
- [ ] **Body includes:**
  - [ ] Feature description (Phase B exit gate criticality)
  - [ ] User story references: #14, #15, #16
  - [ ] Enabler references: #17
  - [ ] **Blocks:** #4 (Feature C) — marked as HARD EXIT GATE
  - [ ] **Blocked by:** #2 (Feature A)
  - [ ] Acceptance criteria (all 8 from §3.3)
  - [ ] Definition of Done
- [ ] **Labels applied:** `feature`, `priority-critical`, `value-high`, `agent-skill`
- [ ] **Epic:** #1
- [ ] **Estimate:** 8 story points
- [ ] **Added to project board** in "Backlog" column

### Checklist for Issue #4 — Feature C: Remove Server-Side Computation

- [ ] **Feature issue created** using template from §3.4 of project-plan.md
- [ ] **Body includes:**
  - [ ] Feature description + explicit **Phase B gate prerequisite** warning
  - [ ] User story references: #18, #19, #20, #21, #22, #23
  - [ ] Test references: #24, #25
  - [ ] **Blocks:** #5 (Feature D)
  - [ ] **Blocked by:** #3 (Feature B) — marked as HARD prerequisite
  - [ ] Acceptance criteria (all 15 from §3.4)
  - [ ] Definition of Done
  - [ ] **Explicit note:** Phase C issues must NOT be moved to "In Progress" until Phase B evaluation sign-off is documented in #17
- [ ] **Labels applied:** `feature`, `priority-critical`, `value-high`, `server`, `architecture`
- [ ] **Epic:** #1
- [ ] **Estimate:** 13 story points
- [ ] **Added to project board** in "Backlog" column
- [ ] **Gate blocker flag applied:** Add a project board status label `blocked:phase-b-gate` that is removed only when Phase B exit gate clears

### Checklist for Issue #5 — Feature D: Adapter Restructure

- [ ] **Feature issue created** using template from §3.5 of project-plan.md
- [ ] **Body includes:**
  - [ ] Feature description (structural only, no functional change)
  - [ ] Enabler references: #26, #28
  - [ ] Story references: #27, #29
  - [ ] Test references: #30
  - [ ] File classification map (the full 33-row table from §3.5)
  - [ ] Dep-cruiser rules to add (the 5 rules from §3.5)
  - [ ] **Blocks:** Nothing
  - [ ] **Blocked by:** #4 (Feature C) — tagged as "benefits from" not "requires"
  - [ ] Acceptance criteria (all 11 from §3.5)
  - [ ] Definition of Done
- [ ] **Labels applied:** `feature`, `priority-medium`, `value-medium`, `server`, `infrastructure`
- [ ] **Epic:** #1
- [ ] **Estimate:** 13 story points
- [ ] **Added to project board** in "Backlog" column

---

## Story / Enabler Level Issues

### Phase A — Story SA1: Define SprintDataQuery + SprintRawData Types

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SA1: Define SprintDataQuery and SprintRawData types in port interface`
- [ ] **Body includes:**
  - [ ] Story statement: "As a Scrum agent, I want the server to expose a typed query interface for sprint data, so I can request raw sprint items with completion timestamps."
  - [ ] Acceptance criteria:
    - [ ] `SprintDataQuery` interface defined in `src/scrum/ports.ts` with fields: `sprint_ref: "current" | "next" | string`, `history_window?: number`
    - [ ] `SprintRawData` interface defined with `active_sprint` (containing `SprintInfo` + `SprintDataItem[]`) and `completed_sprints` array
    - [ ] `SprintDataItem` extends `ItemAggregate` from `src/scrum/ports.ts` with added `completed_at: string | null`
    - [ ] Types exported from port interface for use-case layer consumption
  - [ ] Test requirements: verify type compilation
  - [ ] Dependencies: none (foundation types)
  - [ ] Estimate: 2 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [ ] **Feature:** #2
- [ ] **Assigned to epic issue:** #1

### Phase A — Story SA2: Add getSprintData to ProjectReader Port

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SA2: Add getSprintData query to ProjectReader port interface`
- [ ] **Body includes:**
  - [ ] Story statement: "As a use-case layer, I want `ProjectReader` to declare `getSprintData(query)`, so the adapter can implement and the use case can call it."
  - [ ] Acceptance criteria:
    - [ ] Method signature: `getSprintData(query: SprintDataQuery): Promise<BackendCallResult<SprintRawData>>`
    - [ ] Added to `ProjectReader` interface at `src/scrum/ports.ts`
    - [ ] All adapter implementations compile (add stub if needed in abstract backend)
  - [ ] Test requirements: compile check
  - [ ] Dependencies: SA1 (types must exist)
  - [ ] Estimate: 1 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [ ] **Feature:** #2
- [ ] **Dependencies:** Blocks SA3

### Phase A — Enabler EA31: Extend ItemAggregate with completed_at

- [ ] **Issue created** as `enabler`
- [ ] **Title:** `Enabler EA31: Extend ItemAggregate type with completed_at field`
- [ ] **Body includes:**
  - [ ] Description: The `ItemAggregate` type at `src/scrum/ports.ts:173` is the per-item projection from aggregate board scans. It needs a `completed_at: string | null` field so `SprintDataItem` can extend it without introducing a parallel type family.
  - [ ] Acceptance criteria:
    - [ ] `completed_at: string | null` added to `ItemAggregate`
    - [ ] All consumers of `ItemAggregate` are audited for impact
    - [ ] `mappers.ts` aggregate mapper populates `completed_at` from issue `closedAt` field
    - [ ] No breaking changes to existing consumers
  - [ ] User stories enabled: SA3 (SprintDataService needs it)
  - [ ] Estimate: 2 SP
- [ ] **Labels applied:** `enabler`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #2

### Phase A — Enabler EA32: Extract burndown-completion to infra/

- [ ] **Issue created** as `enabler`
- [ ] **Title:** `Enabler EA32: Extract burndown-completion.ts to infra/ for shared use`
- [ ] **Body includes:**
  - [ ] Description: The `completionsFromBoardItems()` function at `src/adapters/github/internal/burndown-completion.ts` is needed by both the new `SprintDataService` (Phase A) and the existing `BurndownCalculator` (removed in Phase C). Extract to `src/adapters/github/internal/infra/burndown-completion.ts`.
  - [ ] **Critical:** This must happen BEFORE Phase C removes BurndownCalculator, otherwise the shared function is at risk of collateral removal.
  - [ ] Acceptance criteria:
    - [ ] `burndown-completion.ts` moved to `internal/infra/burndown-completion.ts`
    - [ ] All import paths updated across adapter
    - [ ] Both `SprintDataService` and `BurndownCalculator` import from new location
    - [ ] No code duplication
  - [ ] Estimate: 2 SP
- [ ] **Labels applied:** `enabler`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #2

### Phase A — Story SA3: Implement SprintDataService

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SA3: Implement SprintDataService in adapter read-services`
- [ ] **Body includes:**
  - [ ] Story statement: "As a Scrum agent, I want the server to fetch sprint items with completion timestamps, so I can compute burndown and velocity from raw data."
  - [ ] Acceptance criteria:
    - [ ] `SprintDataService` created at `src/adapters/github/internal/read-services/sprint-data-service.ts`
    - [ ] Fetches items via `BoardScanCoordinator.fetchAggregateBoard()` (already cached)
    - [ ] Retrieves completion timestamps via `completionsFromBoardItems()` from infra/
    - [ ] Assembles `SprintRawData`: flat item list per sprint with `completed_at`, no aggregation
    - [ ] Supports optional `history_window` parameter for completed sprints
    - [ ] Returns sprint metadata (name, start/end dates, duration) as facts
    - [ ] Reuses existing `SprintInfo` and `ItemAggregate` types
    - [ ] No Scrum computation (no burndown, no velocity, no health analysis)
  - [ ] Technical tasks:
    - [ ] Wire `SprintDataService` into the adapter composition (backend.ts factory)
    - [ ] Implement `getSprintData()` method in backend
  - [ ] Dependencies: SA2 (port method), EA31 (ItemAggregate extended), EA32 (burndown-completion in infra)
  - [ ] Estimate: 5 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [ ] **Feature:** #2

### Phase A — Story SA4: Register scrum_get_sprint_data MCP Tool

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SA4: Register scrum_get_sprint_data as MCP tool`
- [ ] **Body includes:**
  - [ ] Story statement: "As a Scrum agent, I want a new `scrum_get_sprint_data` tool registered, so I can call it via MCP to get raw sprint data."
  - [ ] Acceptance criteria:
    - [ ] Tool name `scrum_get_sprint_data` added to `SCRUM_READ_TOOL_NAMES` at `src/tools/scrum-read.ts:36`
    - [ ] Tool registered with `outputSchema: SprintRawDataSchema`
    - [ ] Input schema defined (matching `SprintDataQuery`)
    - [ ] Tool description documents the raw-data-only contract
    - [ ] Existing tool registrations unchanged
  - [ ] Dependencies: SA5 (handler must exist)
  - [ ] Estimate: 1 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [ ] **Feature:** #2

### Phase A — Story SA5: Add Handler + Use-Case Layer

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SA5: Add getSprintData handler and use-case layer`
- [ ] **Body includes:**
  - [ ] Story statement: "As a tool handler, I want a thin `getSprintDataUseCase` and handler, so the tool registration delegates to the adapter properly."
  - [ ] Acceptance criteria:
    - [ ] Use-case file at `src/scrum/get-sprint-data.ts` — thin pass-through to `backend.getSprintData`
    - [ ] Handler function at `src/tools/handlers/read.ts` — `handleGetSprintData()`
    - [ ] Handler exported for contract tests
    - [ ] Follows same pattern as existing handlers (validated input → use-case → MCP text result)
  - [ ] Dependencies: SA2 (port method), SA3 (adapter implementation)
  - [ ] Estimate: 1 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [ ] **Feature:** #2

### Phase A — Test TA1: Contract Tests for New Tool

- [ ] **Issue created** as `test`
- [ ] **Title:** `Test TA1: Contract tests for scrum_get_sprint_data output schema`
- [ ] **Body includes:**
  - [ ] Test description: Validate that `scrum_get_sprint_data` returns schema-valid JSON. Follow patterns in `src/test/tools/scrum-read.contract.test.ts`.
  - [ ] Acceptance criteria:
    - [ ] `assertHandlerSchema` test for `handleGetSprintData`
    - [ ] Config-shaped fake backend seeded with sprint data
    - [ ] Validates `SprintRawData` against its Zod schema
    - [ ] Validates MCP output shape parsing
    - [ ] Test added to contract test suite
  - [ ] Dependencies: SA4 (tool registered), SA5 (handler exported)
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `test`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #2

### Phase B — Story SB1: Update SKILL.md

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SB1: Update SM agent SKILL.md to call scrum_get_sprint_data`
- [ ] **Body includes:**
  - [ ] Story statement: "As a Scrum Master agent, I want to call `scrum_get_sprint_data` instead of `scrum_get_analytics` and `scrum_get_board_health`, so I can compute my own judgments from raw data."
  - [ ] Acceptance criteria:
    - [ ] All references to `scrum_get_analytics` and `scrum_get_board_health` in `.roo/skills/scrum-master/SKILL.md` are replaced with `scrum_get_sprint_data`
    - [ ] Tool calls include appropriate `history_window` parameter
    - [ ] Agent reads `SprintRawData.completed_at` for burndown computation
    - [ ] Agent reads `SprintRawData.active_sprint` for sprint metadata
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `agent-skill`
- [ ] **Feature:** #3

### Phase B — Story SB2: Implement Agent Burndown + Velocity

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SB2: Implement agent-side burndown series and velocity computation`
- [ ] **Body includes:**
  - [ ] Story statement: "As a Scrum Master agent, I want to burndown and velocity from raw sprint data, so the server doesn't need to compute them."
  - [ ] Acceptance criteria:
    - [ ] Agent implements day-by-day burndown from `SprintRawData` completion timestamps
    - [ ] Agent implements ideal burndown line from committed points + sprint duration
    - [ ] Agent computes velocity from completed sprint history windows
    - [ ] Methods follow the same arithmetic as removed sprint-math functions
    - [ ] Output matched against old server output in evaluation suite
  - [ ] Estimate: 5 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `agent-skill`
- [ ] **Feature:** #3

### Phase B — Story SB3: Implement Agent Readiness + Risk

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SB3: Implement agent-side readiness assessment and sprint risk evaluation`
- [ ] **Body includes:**
  - [ ] Story statement: "As a Scrum Master agent, I want to evaluate DoR compliance and sprint risks from raw data, so the server doesn't need to compute them."
  - [ ] Acceptance criteria:
    - [ ] Agent evaluates DoR criteria from config against `scrum_find_items` listing data
    - [ ] Agent counts unestimated, blocked, no-assignee items
    - [ ] Agent computes readiness percentage from per-item evaluation
    - [ ] Output matched against old server output in evaluation suite
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `agent-skill`
- [ ] **Feature:** #3

### Phase B — Enabler SB4: Agent Evaluation Suite

- [ ] **Issue created** as `enabler`
- [ ] **Title:** `Enabler SB4: Create agent evaluation suite for output parity comparison`
- [ ] **Body includes:**
  - [ ] Description: Create a test harness that runs both old server tools and new `scrum_get_sprint_data` tool, comparing their outputs. This is the **Phase B exit gate** that must clear before Phase C starts.
  - [ ] **Critical:** This is the single most important dependency in the entire plan. Without this gate, Phase C has no safety net.
  - [ ] Acceptance criteria:
    - [ ] Evaluation suite runs both `scrum_get_analytics` and agent-side burndown from `scrum_get_sprint_data`
    - [ ] Evaluation suite runs both `scrum_get_board_health` and agent-side readiness from `scrum_find_items`
    - [ ] Comparison report documents: methodology, tolerance bounds, discrepancies found
    - [ ] Suite can run as standalone script (no server needed for agent side)
    - [ ] Evaluation results signed off by team before Phase C begins
  - [ ] User stories enabled: SB2, SB3 (parity verification)
  - [ ] Estimate: 5 SP
- [ ] **Labels applied:** `enabler`, `priority-critical`, `value-high`, `agent-skill`
- [ ] **Feature:** #3

### Phase C — Story SC1: Port Cleanup

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC1: Port cleanup — remove computation methods and redirect call sites`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want the port interface to expose only fact-retrieval methods, so the adapter stops computing Scrum judgments."
  - [ ] Acceptance criteria:
    - [ ] `getBoardHealth()` removed from `BoardHealthPort`
    - [ ] `getAnalytics()` removed from `AnalyticsPort`
    - [ ] `getSprintCompletion()` removed from `ProjectReader`
    - [ ] `AnalyticsPort` and `BoardHealthPort` removed from port interface
    - [ ] `orient.ts` call to `backend.getSprintCompletion()` redirected to use `backend.getSprintData()` scoped to current sprint
    - [ ] `ProjectReader` composition updated (removes AnalyticsPort, BoardHealthPort)
  - [ ] **Refer to project-plan.md §A.3:** `computeSprintEndDate()` is NOT removed — still called by `mappers.ts:18`
  - [ ] Estimate: 5 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `server`, `architecture`
- [ ] **Feature:** #4

### Phase C — Story SC2: Tool Deprecation Stubs

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC2: Replace scrum_get_board_health and scrum_get_analytics with deprecation stubs`
- [ ] **Body includes:**
  - [ ] Story statement: "As an agent, I want deprecated tools to return a migration hint, so I can migrate to `scrum_get_sprint_data` without breaking error handling."
  - [ ] Acceptance criteria:
    - [ ] `scrum_get_board_health` handler returns `{ deprecated: true, use: "scrum_get_sprint_data" }`
    - [ ] `scrum_get_analytics` handler returns `{ deprecated: true, use: "scrum_get_sprint_data" }`
    - [ ] Tool registrations remain active (Invariant 8: tool names are never removed)
    - [ ] Output schema for stubs is a simple object, not the old complex types
  - [ ] Note: Hard removal deferred until no active agent sessions reference old tool names
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `server`
- [ ] **Feature:** #4

### Phase C — Story SC3: Remove 4 Adapter Services

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC3: Remove 4 adapter computation services`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want the 4 adapter services that compute Scrum judgments removed, so the adapter returns only facts."
  - [ ] Services to remove:
    - [ ] `analytics-service.ts` at `src/adapters/github/internal/`
    - [ ] `board-health-service.ts` at `src/adapters/github/internal/`
    - [ ] `sprint-history-service.ts` at `src/adapters/github/internal/`
    - [ ] `burndown-calculator.ts` at `src/adapters/github/internal/`
  - [ ] Acceptance criteria:
    - [ ] All 4 files deleted
    - [ ] All references to these services removed from adapter composition (`backend.ts`)
    - [ ] All imports of these services removed
    - [ ] `grep -r` across `src/` confirms zero references
    - [ ] `deno task test` passes
    - [ ] **Critical:** `completionsFromBoardItems()` is preserved in infra/ (moved by EA32)
  - [ ] Estimate: 5 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `server`
- [ ] **Feature:** #4

### Phase C — Story SC4: Remove Dead Code

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC4: Remove dead code from listing-mappers.ts, mappers.ts, sprint-math.ts`
- [ ] **Body includes:**
  - [ ] Story statement: "As a maintainer, I want dead code with no callers removed, so the codebase is leaner."
  - [ ] Code to remove:
    - [ ] `historyEntryToItemListing()` at `src/scrum/listing-mappers.ts:51-69` (only called by analytics-service)
    - [ ] `aggregateToBurndownInput()` at `src/adapters/github/mappers.ts:532-542` (only called by sprint-history-service)
    - [ ] Mark `buildIdealLine()` and `buildDaySeries()` in `sprint-math.ts` as deprecated with comment directing to agent skill (do NOT remove — called by code that may still reference them; verification needed)
  - [ ] **DO NOT remove:** `computeSprintEndDate()` (called by mappers.ts:18)
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #4

### Phase C — Story SC5: Remove Domain Readiness + Risk-Stance

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC5: Remove domain readiness rules and risk-stance computation`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want the domain layer to contain zero runtime Scrum computation, restoring its type-declarations-only contract."
  - [ ] Code to remove:
    - [ ] `src/domain/rules/readiness.ts` — entire file deleted
    - [ ] `computeRiskStance()` at `src/domain/types.ts:245` — removed
    - [ ] `riskStance` field removed from `SprintContext` interface at `src/domain/types.ts:236`
    - [ ] `SprintRiskStance` type at `src/domain/types.ts:224` — removed (moved to agent)
    - [ ] `sprintContextFromSprintInfo()` modified: remove `workPct` parameter and risk computation; return dates-only metadata
  - [ ] **DO NOT remove:**
    - [ ] `src/domain/rules/acceptance-criteria.ts` — used by `get-story.ts` use case
    - [ ] `parseAcceptanceCriteria()` — needed for `ItemDetailResult.acceptance_criteria`
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `server`, `architecture`
- [ ] **Feature:** #4

### Phase C — Story SC6: Remove Output Schema Types

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC6: Remove computation-related output schema types from scrum-outputs.ts`
- [ ] **Body includes:**
  - [ ] Story statement: "As a schema maintainer, I want output schema types that correspond to removed server computations cleaned up."
  - [ ] Schemas to remove from `src/schemas/scrum-outputs.ts`:
    - [ ] `BacklogHealthSchema` (line 220)
    - [ ] `AnalyticsResultSchema` (line 296)
    - [ ] `BurndownResponseSchema` (line 246, inlined in AnalyticsResultSchema)
    - [ ] `SprintSnapshotSchema` (line 289)
    - [ ] `SprintTotalsSchema` (line 274)
    - [ ] `ReadinessBreakdownSchema` (line 214)
    - [ ] `SprintWindowMetaSchema` (line 238 — verify no other consumers)
  - [ ] Domain types to verify orphaned in `src/domain/types.ts`:
    - [ ] `BurndownResponse`, `BurndownDayPoint`, `IdealDayPoint`
    - [ ] `SprintSnapshot`, `SprintTotals`, `SprintTotalsKind`
    - [ ] `BacklogHealth`, `SprintRisk`, `ReadinessBreakdown`
    - [ ] `DataSource` (only used by BurndownResponse — verify)
  - [ ] **Verify no cross-references** from other types before removing
  - [ ] Estimate: 2 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #4

### Phase C — Test TC1: Stub Regression Tests

- [ ] **Issue created** as `test`
- [ ] **Title:** `Test TC1: Regression tests for stub tool responses`
- [ ] **Body includes:**
  - [ ] Test description: Verify deprecation stubs for `scrum_get_board_health` and `scrum_get_analytics` return correct shape and don't throw.
  - [ ] Acceptance criteria:
    - [ ] Test calls `handleGetBoardHealth` with stub backend
    - [ ] Test calls `handleGetAnalytics` with stub backend
    - [ ] Both return `{ deprecated: true, use: "scrum_get_sprint_data" }`
    - [ ] No `MissingSchemaError` or `ToolNotFoundError`
  - [ ] Estimate: 2 SP
- [ ] **Labels applied:** `test`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #4

### Phase C — Test TC2: Dep-Cruiser Compliance

- [ ] **Issue created** as `test`
- [ ] **Title:** `Test TC2: Dep-cruiser compliance check`
- [ ] **Body includes:**
  - [ ] Test description: Run `deno task depcruise` to verify no references to removed services or files.
  - [ ] Acceptance criteria:
    - [ ] `deno task depcruise` passes with zero violations
    - [ ] No references to `analytics-service`, `board-health-service`, `sprint-history-service`, `burndown-calculator` in any `src/` import
  - [ ] Estimate: 1 SP
- [ ] **Labels applied:** `test`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #4

### Phase D — Enabler SD1: Create Subdirectories

- [ ] **Issue created** as `enabler`
- [ ] **Title:** `Enabler SD1: Create 5 subdirectory structure under internal/`
- [ ] **Body includes:**
  - [ ] Description: Create the five-subfolder contract directory structure under `src/adapters/github/internal/`.
  - [ ] Directories to create:
    - [ ] `internal/query-pipeline/`
    - [ ] `internal/query-strategies/`
    - [ ] `internal/read-services/`
    - [ ] `internal/write-services/`
    - [ ] `internal/infra/`
  - [ ] Note: `assemblers/` stays as a peer directory
  - [ ] Acceptance criteria:
    - [ ] All 5 directories exist with proper structure
    - [ ] `assemblers/` remains at `internal/assemblers/`
    - [ ] Empty directories are git-tracked (add `.gitkeep` files)
  - [ ] Estimate: 1 SP
- [ ] **Labels applied:** `enabler`, `priority-medium`, `value-medium`, `server`, `infrastructure`
- [ ] **Feature:** #5

### Phase D — Story SD2: Classify and Move ~37 Files

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SD2: Classify and move ~37 adapter files to contract locations`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want ~37 adapter files moved from the flat `internal/` directory into their contract subfolders, so the directory structure encodes the architectural blueprint."
  - [ ] **Refer to file classification map** in [`project-plan.md §3.5`](/docs/ways-of-work/plan/server-refactoring/project-plan.md) for the full mapping of all 33 files
  - [ ] Acceptance criteria:
    - [ ] All files moved to their designated subfolders
    - [ ] All import paths updated across the adapter and test files
    - [ ] No broken imports (verified by `deno check src/`)
    - [ ] Classification comment added to top of each moved file documenting its role
    - [ ] `deno task test` passes after all moves
  - [ ] **Special attention:** `item-filter.ts` has mixed concerns — verify it cleanly fits in `query-strategies/` or split before moving (SD4 handles this)
  - [ ] Estimate: 8 SP
- [ ] **Labels applied:** `user-story`, `priority-medium`, `value-medium`, `server`, `infrastructure`
- [ ] **Feature:** #5

### Phase D — Enabler SD3: Add Dep-Cruiser Internal Boundary Rules

- [ ] **Issue created** as `enabler`
- [ ] **Title:** `Enabler SD3: Add dep-cruiser rules for internal subfolder boundaries`
- [ ] **Body includes:**
  - [ ] Description: Add 5 new dep-cruiser rules to `.dependency-cruiser.cjs` enforcing the subfolder import boundary contract from ARCHITECTURE.MD.
  - [ ] Rules to add:
    - [ ] Rule 1: `query-pipeline/` may only be imported by `query-strategies/` and `read-services/`
    - [ ] Rule 2: `query-strategies/` may not import `read-services/` or `write-services/`
    - [ ] Rule 3: `read-services/` may not import paginator directly or import `write-services/`
    - [ ] Rule 4: `write-services/` may not import `query-pipeline/`
    - [ ] Rule 5: `infra/` may not import any service folder
  - [ ] Acceptance criteria:
    - [ ] All 5 rules defined in `.dependency-cruiser.cjs`
    - [ ] `deno task depcruise` passes with all 5 new rules
    - [ ] No false positives from assemblers/ (which are peers, not in the five-subfolder)
  - [ ] User stories enabled: SD2 (guarantees structural integrity after move)
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `enabler`, `priority-medium`, `value-medium`, `server`, `infrastructure`
- [ ] **Feature:** #5

### Phase D — Story SD4: Split Mixed-Responsibility Files

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SD4: Split files with mixed responsibilities at function boundaries`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want files with responsibilities spanning multiple subfolder concerns split before they are moved, so the structural contract is not violated by a single file spanning multiple subfolder roles."
  - [ ] Candidate files for splitting (identify during SD2 classification):
    - [ ] `item-filter.ts` — confirm it fits in `query-strategies/` only (Scrum-semantic predicates)
    - [ ] `board-item-projection.ts` — confirm it fits in `query-strategies/` only
    - [ ] Any file whose primary classification is ambiguous
  - [ ] Acceptance criteria:
    - [ ] Files with mixed responsibilities split into separate modules per concern
    - [ ] Split follows single-responsibility principle at function level
    - [ ] Import paths update accordingly
    - [ ] `deno task test` passes
  - [ ] Estimate: 2 SP
- [ ] **Labels applied:** `user-story`, `priority-low`, `value-low`, `server`, `infrastructure`
- [ ] **Feature:** #5

### Phase D — Test TD1: Dep-Cruiser Boundary Rule Tests

- [ ] **Issue created** as `test`
- [ ] **Title:** `Test TD1: Dep-cruiser internal boundary rule validation`
- [ ] **Body includes:**
  - [ ] Test description: Run `deno task depcruise` with the 5 new internal boundary rules to validate all constraints are enforced.
  - [ ] Acceptance criteria:
    - [ ] `deno task depcruise` passes with all 11 rules (6 existing + 5 new)
    - [ ] Verify each rule fires on an intentional violation to confirm the rule works
    - [ ] Document rule verification in test comments
  - [ ] Estimate: 1 SP
- [ ] **Labels applied:** `test`, `priority-medium`, `value-low`, `server`, `infrastructure`
- [ ] **Feature:** #5

---

## Post-Creation Verification

### For All Issues

- [ ] **Title format consistent:** `{Short code}: {Descriptive title}` (e.g., `Story SA1: Define sprint data types`)
- [ ] **Labels correct** for each issue type (epic, feature, user-story, enabler, test)
- [ ] **Priority and value** assigned according to the matrix in project-plan.md §4
- [ ] **Estimates assigned** using Fibonacci scale (1, 2, 3, 5, 8, 13)
- [ ] **Dependencies referenced** using `Blocks: #N` and `Blocked by: #N`
- [ ] **Epic reference** set on every feature-level and story-level issue
- [ ] **Feature reference** set on every story, enabler, and test issue
- [ ] **Milestone assigned** for epic issue (V2 Architecture Alignment)
- [ ] **Added to project board** in appropriate column
- [ ] **Acceptance criteria are testable** (not subjective)

### Cross-Issue Verification

- [ ] **Dependency chain verified:** Phase A → B → C → D is correct and complete
- [ ] **No orphan issues:** Every issue has a parent (story → feature → epic)
- [ ] **Phase B exit gate marked** on Issue #4 (Feature C) body
- [ ] **Burndown-completion extraction** (EA32) has note about Phase C dependency
- [ ] **parseAcceptanceCriteria exception** documented on Issue #22 (SC5)
- [ ] **computeSprintEndDate exception** documented on Issue #18 (SC1) and #21 (SC4)
- [ ] **Total estimation matches plan:** 8 (A) + 8 (B) + 13 (C) + 13 (D) = 42 SP

---

*Generated: 2026-06-08 · Source: `docs/ways-of-work/plan/server-refactoring/project-plan.md`*