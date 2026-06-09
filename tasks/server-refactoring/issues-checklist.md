# Issues Creation Checklist — Server Refactoring

**Epic:** Server Refactoring — Align MCP Scrum Server to Architecture Vision **Reference:** [`tasks/server-refactoring/project-plan.md`](/tasks/server-refactoring/project-plan.md)

**Last Updated:** 2026-06-08 — Codebase review confirmed Phase B evaluation suite is complete and signed off. SB4 (evaluation suite) was incorrectly marked ❌ NOT STARTED; `src/test/evaluation/report.md` declares "✅ GATE CLEARED — Phase C may proceed" dated 2026-06-08.

---

## Implementation Status

| Phase                                          | Status             | Completed                                          | Remaining                                      |
| ---------------------------------------------- | ------------------ | -------------------------------------------------- | ---------------------------------------------- |
| **Phase A — Add `scrum_get_sprint_data` Tool** | ✅ **COMPLETED**   | SA1-SA5, EA31, EA32, TA1 (8 SP)                    | Nothing                                        |
| **Phase B — Agent Skill Update**               | ✅ **COMPLETED**   | SB1-SB4 (SKILL.md update + evaluation suite)       | Nothing                                        |
| **Phase C — Remove Server-Side Computation**   | ❌ **NOT STARTED** | Nothing                                            | SC1-SC6, TC1, TC2 (13 SP) — blocked by Phase B |
| **Phase D — Adapter Restructure**              | 🔶 **PARTIAL**     | SD1, SD3, TD1 (5 SP) — subdirs + dep-cruiser rules | SD2, SD4 (10 SP) — 30+ files unmoved           |

### Key Findings

1. **Phase A fully delivered** — all 8 issues (SA1-SA5, EA31, EA32, TA1) are implemented, tested, and wired. See [`project-plan.md §1`](/tasks/server-refactoring/project-plan.md) for the complete inventory.
2. **Phase B SKILL.md updated** — `scrum_get_sprint_data` referenced at line 148, deprecation notices on line 151, burndown guidance at lines 160-161. Playbooks updated: [`transitions.md`](/.roo/skills/scrum-master/playbooks/transitions.md), [`ceremony-backlog-transitions.md`](/.roo/skills/scrum-master/playbooks/ceremony-backlog-transitions.md), [`deadline-tracking.md`](/.roo/skills/scrum-master/playbooks/deadline-tracking.md).
3. **Phase B fully delivered** — SB1-SB4 all complete. Evaluation suite (`burndown-parity.test.ts` + `risk-parity.test.ts`) confirms agent-side computation parity with zero tolerance against server implementations. Formal sign-off in [`report.md`](/src/test/evaluation/report.md) dated 2026-06-08 declares "✅ GATE CLEARED — Phase C may proceed".
4. **Phase D subdirectories exist** — `query-pipeline/`, `query-strategies/`, `read-services/`, `write-services/`, `infra/` all created with `.gitkeep`. Dep-cruiser rules added (lines 106-166 in [`.dependency-cruiser.cjs`](/.dependency-cruiser.cjs)). Only 2 of ~32 source files moved so far: `burndown-completion.ts` → `infra/`, `sprint-data-service.ts` → `read-services/`.

### Remaining Estimation

| Phase               | Points     | Items                                                                 |
| ------------------- | ---------- | --------------------------------------------------------------------- |
| Phase B remainder   | 0          | ~~SB3 (3 SP)~~ + ~~SB4 (5 SP) — both completed via evaluation suite~~ |
| Phase C             | 13         | SC1-SC6 (21 SP) + TC1-TC2 (3 SP) = 24 SP, adjusted to 13 SP           |
| Phase D remainder   | 10         | SD2 (8 SP) + SD4 (2 SP)                                               |
| **Remaining Total** | **~31 SP** |                                                                       |

---

## Pre-Creation Preparation

### Repository Setup

- [x] Epic milestone created: `V2 Architecture Alignment` with target milestone
- [x] GitHub project board configured with Kanban columns (Backlog, Sprint Ready, In Progress, In Review, Testing, Done)
- [x] Custom fields configured: Priority (P0-P3), Value (High/Medium/Low), Component (Server/Agent-Skill/Infrastructure/Testing), Estimate (story points)
- [x] Labels created: `epic`, `feature`, `user-story`, `enabler`, `test`, `priority-critical`, `priority-high`, `priority-medium`, `priority-low`, `value-high`, `value-medium`, `value-low`, `server`, `agent-skill`, `infrastructure`, `architecture`
- [x] Automation rules defined for status transitions (e.g., PR opened → "In Review", PR merged → "Testing")
- [x] Team capacity assessed: who implements server-side (Phases A, C, D) vs. agent-side (Phase B)

### Issue Number Pre-allocation

Pre-allocate issue numbers for all issues so templates can reference each other. The following block shows the suggested numbering scheme (replace `#N` with actual numbers after creation):

```
#1   — Epic: Server Refactoring (epic)
#2   — Feature: Add scrum_get_sprint_data Tool (feature) ✅
#3   — Feature: Agent Skill Update (feature) 🔶
#4   — Feature: Remove Server-Side Computation (feature) ❌
#5   — Feature: Adapter Restructure Five-Subfolder Contract (feature) 🔶
#6   — Story SA1: Define SprintDataQuery + SprintRawData types (user-story) ✅
#7   — Story SA2: Add getSprintData to ProjectReader port (user-story) ✅
#8   — Enabler EA31: Extend ItemAggregate with completed_at field (enabler) ✅
#9   — Enabler EA32: Extract burndown-completion.ts to infra/ (enabler) ✅
#10  — Story SA3: Implement SprintDataService (user-story) ✅
#11  — Story SA4: Register scrum_get_sprint_data MCP tool (user-story) ✅
#12  — Story SA5: Add handler + use-case layer (user-story) ✅
#13  — Test TA1: Contract tests for new tool output schema (test) ✅
#14  — Story SB1: Update SKILL.md to call scrum_get_sprint_data (user-story) ✅
#15  — Story SB2: Implement agent burndown + velocity (user-story) 🔶
#16  — Story SB3: Implement agent readiness + risk (user-story) ❌
#17  — Enabler SB4: Create agent evaluation suite for output parity (enabler) ❌ **CRITICAL**
#18  — Story SC1: Port cleanup — remove 3 computation methods + redirect (user-story) ❌
#19  — Story SC2: Replace tools with deprecation stubs (user-story) ❌
#20  — Story SC3: Remove 4 adapter computation services (user-story) ❌
#21  — Story SC4: Remove dead code (historyEntryToItemListing, aggregateToBurndownInput) (user-story) ❌
#22  — Story SC5: Remove domain readiness rules + risk-stance (user-story) ❌
#23  — Story SC6: Remove output schema types (user-story) ❌
#24  — Test TC1: Regression tests for stub responses (test) ❌
#25  — Test TC2: Dep-cruiser compliance (test) ❌
#26  — Enabler SD1: Create 5 subdirectories under internal/ (enabler) ✅
#27  — Story SD2: Classify and move ~30 files to contract locations (user-story) ❌
#28  — Enabler SD3: Add dep-cruiser internal boundary rules (enabler) ✅
#29  — Story SD4: Split mixed-responsibility files (user-story) ❌
#30  — Test TD1: Dep-cruiser boundary rule tests (test) ✅
```

**Status key:** ✅ Completed | 🔶 Partial | ❌ Not Started

---

## Epic Level Issue

### Checklist for Issue #1 — Server Refactoring Epic

- [x] **Epic issue created** using template from §3.1 of project-plan.md
- [x] **Title:** `Epic: Server Refactoring — Align MCP Scrum Server to Architecture Vision`
- [ ] **Body includes:**
  - [ ] Epic description summarizing the four-phase approach
  - [x] Phase A completion status noted
  - [ ] Phase B/C/D with current status per implementation audit
  - [ ] Business value section (Invariant 2 restoration, agent transparency)
  - [ ] Epic acceptance criteria (all 10 criteria from §3.1)
  - [ ] Feature list with references to #2, #3, #4, #5
  - [ ] Definition of Done
- [ ] **Labels applied:** `epic`, `priority-critical`, `value-high`, `architecture`
- [ ] **Milestone assigned:** V2 Architecture Alignment
- [ ] **Added to project board** in "Backlog" column
- [ ] **T-shirt size:** L (remaining: ~31 SP across 3 unfinished phases)

---

## Feature Level Issues

### Checklist for Issue #2 — Feature A: Add `scrum_get_sprint_data` Tool ✅ COMPLETED

- [x] **Feature issue created** using template from §3.2 of project-plan.md
- [x] **Body includes:**
  - [x] Feature description
  - [x] User story references: #6, #7, #10, #11, #12
  - [x] Enabler references: #8, #9
  - [x] Test references: #13
  - [ ] **Blocks:** ~~#3 (Feature B)~~ — Feature A is COMPLETED, Feature B is unblocked
  - [x] **Blocked by:** Nothing
  - [x] Acceptance criteria (all 10 from §3.2)
  - [x] Definition of Done
- [x] **Labels applied:** `feature`, `priority-high`, `value-high`, `server`
- [x] **Epic:** #1
- [x] **Estimate:** 8 story points — **DELIVERED**
- [ ] **Marked as completed** on project board
- [ ] **All dependent stories and enablers created and closed** (see story-level checklist below)

### Checklist for Issue #3 — Feature B: Agent Skill Update ✅ COMPLETED

- [x] **Feature issue created** using template from §3.3 of project-plan.md
- [x] **Body includes:**
  - [x] Feature description (Phase B exit gate criticality)
  - [x] **Current status:** All stories completed — SB1-SB4 delivered
  - [x] User story references: #14, #15, #16
  - [x] Enabler references: #17
  - [x] **Blocks:** ~~#4 (Feature C)~~ — Feature B is COMPLETED, Feature C is unblocked
  - [x] **Blocked by:** ~~#2 (Feature A)~~ — Feature A is DONE
  - [x] Acceptance criteria (all 8 from §3.3)
  - [x] Definition of Done
- [x] **Labels applied:** `feature`, `priority-critical`, `value-high`, `agent-skill`
- [x] **Epic:** #1
- [x] **Estimate:** 8 story points — **DELIVERED**
- [ ] **Marked as completed** on project board

### Checklist for Issue #4 — Feature C: Remove Server-Side Computation ❌ NOT STARTED

- [ ] **Feature issue created** using template from §3.4 of project-plan.md
- [ ] **Body includes:**
  - [ ] Feature description + explicit **Phase B gate prerequisite** warning
  - [ ] **Current state:** All 4 computation services still in codebase; 2 domain modules; 6 output schema types
  - [ ] **Blocked by:** #17 (SB4 — Phase B exit gate). **DO NOT START** until SB4 sign-off.
  - [ ] User story references: #18, #19, #20, #21, #22, #23
  - [ ] Test references: #24, #25
  - [ ] **Blocks:** #5 (Feature D) — Phase C reduces file count simplifying the move
  - [ ] **Blocked by:** #3 (Feature B) — marked as HARD prerequisite
  - [ ] Acceptance criteria (all 15 from §3.4)
  - [ ] Definition of Done
  - [ ] **Explicit note:** Phase C issues must NOT be moved to "In Progress" until Phase B evaluation sign-off is documented in #17
- [ ] **Labels applied:** `feature`, `priority-critical`, `value-high`, `server`, `architecture`
- [ ] **Epic:** #1
- [ ] **Estimate:** 13 story points
- [ ] **Added to project board** in "Backlog" column
- [ ] **Gate blocker flag applied:** Add a project board status label `blocked:phase-b-gate` that is removed only when Phase B exit gate clears

### Checklist for Issue #5 — Feature D: Adapter Restructure 🔶 PARTIAL

- [ ] **Feature issue created** using template from §3.5 of project-plan.md
- [ ] **Body includes:**
  - [ ] Feature description (structural only, no functional change)
  - [ ] **Current status:** SD1, SD3, TD1 done (subdirectories + dep-cruiser rules)
  - [ ] **Remaining:** SD2 (~30 files to classify and move), SD4 (file splitting if needed)
  - [ ] Enabler references: #26, #28
  - [ ] Story references: #27, #29
  - [ ] Test references: #30
  - [ ] File classification map (the 33-row table from §3.5 — note only 2 of ~32 files moved so far)
  - [ ] Dep-cruiser rules to add (the 5 rules from §3.5 — **already implemented** in `.dependency-cruiser.cjs`)
  - [ ] **Blocks:** Nothing
  - [ ] **Blocked by:** #4 (Feature C) — tagged as "benefits from" not "requires"
  - [ ] Acceptance criteria (all 11 from §3.5)
  - [ ] Definition of Done
- [ ] **Labels applied:** `feature`, `priority-medium`, `value-medium`, `server`, `infrastructure`
- [ ] **Epic:** #1
- [ ] **Estimate:** 13 story points (5 SP delivered, 10 SP remaining for SD2 + SD4)
- [ ] **Added to project board** in appropriate column

---

## Story / Enabler Level Issues

### Phase A — Story SA1: Define SprintDataQuery + SprintRawData Types ✅ COMPLETED

- [x] **Issue created** as `user-story`
- [x] **Title:** `Story SA1: Define SprintDataQuery and SprintRawData types in port interface`
- [x] **Body includes:**
  - [x] Story statement: "As a Scrum agent, I want the server to expose a typed query interface for sprint data, so I can request raw sprint items with completion timestamps."
  - [x] Acceptance criteria — **all satisfied:**
    - [x] `SprintDataQuery` interface defined in `src/scrum/ports.ts:192`
    - [x] `SprintRawData` interface defined with `SprintInfo` + `SprintRawItem[]` at `src/scrum/ports.ts:217`
    - [x] `SprintRawItem` with `completed_at: string | null` at `src/scrum/ports.ts:200`
    - [x] Types exported from port interface
  - [x] Dependencies: none (foundation types)
  - [x] Estimate: 2 SP — **DELIVERED**
- [x] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [x] **Feature:** #2
- [x] **Assigned to epic issue:** #1
- [ ] **Marked as completed** and closed

### Phase A — Story SA2: Add getSprintData to ProjectReader Port ✅ COMPLETED

- [x] **Issue created** as `user-story`
- [x] **Title:** `Story SA2: Add getSprintData query to ProjectReader port interface`
- [x] **Body includes:**
  - [x] Story statement: "As a use-case layer, I want `ProjectReader` to declare `getSprintData(query)`, so the adapter can implement and the use case can call it."
  - [x] Acceptance criteria — **all satisfied:**
    - [x] Method signature: `getSprintData(query: SprintDataQuery): Promise<SprintRawData>` via `SprintDataPort` at `src/scrum/ports.ts:394-396`
    - [x] Added to `ProjectReader` interface (via `SprintDataPort` extends) at `src/scrum/ports.ts:419`
    - [x] All adapter implementations compile — abstract backend default throws `UnsupportedCapabilityError` at [`src/adapters/abstract-backend.ts:176-178`](/src/adapters/abstract-backend.ts)
  - [x] Dependencies: SA1 (types must exist)
  - [x] Estimate: 1 SP — **DELIVERED**
- [x] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [x] **Feature:** #2
- [ ] **Marked as completed** and closed

### Phase A — Enabler EA31: Extend ItemAggregate with completed_at ✅ COMPLETED

- [x] **Issue created** as `enabler`
- [x] **Title:** `Enabler EA31: Extend ItemAggregate type with completed_at field`
- [x] **Body includes:**
  - [x] Description: The `ItemAggregate` type at `src/scrum/ports.ts:173` now has `completed_at: string | null` at line 185.
  - [x] Acceptance criteria — **all satisfied:**
    - [x] `completed_at: string | null` added to `ItemAggregate` at `src/scrum/ports.ts:185`
    - [x] All consumers of `ItemAggregate` are audited — no breaking changes
    - [x] `mappers.ts` aggregate mapper populates `completed_at` from issue `closedAt` field
    - [x] No breaking changes to existing consumers
  - [x] User stories enabled: SA3 (SprintDataService needs it)
  - [x] Estimate: 2 SP — **DELIVERED**
- [x] **Labels applied:** `enabler`, `priority-high`, `value-medium`, `server`
- [x] **Feature:** #2
- [ ] **Marked as completed** and closed

### Phase A — Enabler EA32: Extract burndown-completion to infra/ ✅ COMPLETED

- [x] **Issue created** as `enabler`
- [x] **Title:** `Enabler EA32: Extract burndown-completion.ts to infra/ for shared use`
- [x] **Body includes:**
  - [x] Description: The `completionsFromBoardItems()` function is now at `src/adapters/github/internal/infra/burndown-completion.ts`. Both `SprintDataService` and `BurndownCalculator` import from the new location.
  - [x] **Critical note:** This was done BEFORE Phase C, so when BurndownCalculator is removed in Phase C SC3, this shared function is preserved.
  - [x] Acceptance criteria — **all satisfied:**
    - [x] `burndown-completion.ts` moved to `internal/infra/burndown-completion.ts`
    - [x] All import paths updated across adapter
    - [x] Both `SprintDataService` and `BurndownCalculator` import from new location
    - [x] No code duplication
  - [x] Estimate: 2 SP — **DELIVERED**
- [x] **Labels applied:** `enabler`, `priority-high`, `value-medium`, `server`
- [x] **Feature:** #2
- [ ] **Marked as completed** and closed

### Phase A — Story SA3: Implement SprintDataService ✅ COMPLETED

- [x] **Issue created** as `user-story`
- [x] **Title:** `Story SA3: Implement SprintDataService in adapter read-services`
- [x] **Body includes:**
  - [x] Story statement: "As a Scrum agent, I want the server to fetch sprint items with completion timestamps, so I can compute burndown and velocity from raw data."
  - [x] Acceptance criteria — **all satisfied:**
    - [x] `SprintDataService` created at `src/adapters/github/internal/read-services/sprint-data-service.ts`
    - [x] Fetches items via `BoardScanCoordinator.fetchAggregateBoard()` (already cached)
    - [x] Retrieves completion timestamps via `completionsFromBoardItems()` from infra/
    - [x] Assembles `SprintRawData`: flat item list per sprint with `completed_at`, no aggregation
    - [x] Returns sprint metadata (name, start/end dates, duration) as facts
    - [x] Reuses existing types
    - [x] No Scrum computation (no burndown, no velocity, no health analysis)
  - [x] Technical tasks — **all done:**
    - [x] Wired `SprintDataService` into the adapter composition at [`src/adapters/github/create-backend.ts:167`](/src/adapters/github/create-backend.ts)
    - [x] Implemented `getSprintData()` method in backend at [`src/adapters/github/backend.ts:281-283`](/src/adapters/github/backend.ts)
  - [x] Dependencies: SA2 (port method), EA31 (ItemAggregate extended), EA32 (burndown-completion in infra)
  - [x] Estimate: 5 SP — **DELIVERED**
- [x] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [x] **Feature:** #2
- [ ] **Marked as completed** and closed

### Phase A — Story SA4: Register scrum_get_sprint_data MCP Tool ✅ COMPLETED

- [x] **Issue created** as `user-story`
- [x] **Title:** `Story SA4: Register scrum_get_sprint_data as MCP tool`
- [x] **Body includes:**
  - [x] Story statement: "As a Scrum agent, I want a new `scrum_get_sprint_data` tool registered, so I can call it via MCP to get raw sprint data."
  - [x] Acceptance criteria — **all satisfied:**
    - [x] Tool name `scrum_get_sprint_data` added to `SCRUM_READ_TOOL_NAMES` at `src/tools/scrum-read.ts:46`
    - [x] Tool registered with `outputSchema: SprintRawDataSchema` at `src/tools/scrum-read.ts:262`
    - [x] Input schema defined (`GetSprintDataSchema` at [`src/schemas/scrum.ts:253`](/src/schemas/scrum.ts))
    - [x] Tool description documents the raw-data-only contract
    - [x] Existing tool registrations unchanged
  - [x] Dependencies: SA5 (handler must exist)
  - [x] Estimate: 1 SP — **DELIVERED**
- [x] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [x] **Feature:** #2
- [ ] **Marked as completed** and closed

### Phase A — Story SA5: Add Handler + Use-Case Layer ✅ COMPLETED

- [x] **Issue created** as `user-story`
- [x] **Title:** `Story SA5: Add getSprintData handler and use-case layer`
- [x] **Body includes:**
  - [x] Story statement: "As a tool handler, I want a thin `getSprintDataUseCase` and handler, so the tool registration delegates to the adapter properly."
  - [x] Acceptance criteria — **all satisfied:**
    - [x] Use-case file at `src/scrum/get-sprint-data.ts` — thin pass-through to `backend.getSprintData`
    - [x] Handler function at `src/tools/handlers/read.ts:73-82` — `handleGetSprintData()`
    - [x] Handler exported for contract tests (line 275 in scrum-read.ts)
    - [x] Follows same pattern as existing handlers
  - [x] Dependencies: SA2 (port method), SA3 (adapter implementation)
  - [x] Estimate: 1 SP — **DELIVERED**
- [x] **Labels applied:** `user-story`, `priority-high`, `value-high`, `server`
- [x] **Feature:** #2
- [ ] **Marked as completed** and closed

### Phase A — Test TA1: Contract Tests for New Tool ✅ COMPLETED

- [x] **Issue created** as `test`
- [x] **Title:** `Test TA1: Contract tests for scrum_get_sprint_data output schema`
- [x] **Body includes:**
  - [x] Test description: Validate that `scrum_get_sprint_data` returns schema-valid JSON.
  - [x] Acceptance criteria — **all satisfied:**
    - [x] `assertHandlerSchema` test for `handleGetSprintData` at [`src/test/tools/scrum-read.contract.test.ts:153`](/src/test/tools/scrum-read.contract.test.ts)
    - [x] Config-shaped fake backend seeded with sprint data
    - [x] Validates `SprintRawData` against its Zod schema
    - [x] Validates MCP output shape parsing at [`src/test/tools/scrum-mcp.integration.test.ts:110`](/src/test/tools/scrum-mcp.integration.test.ts)
    - [x] Golden test committed at [`src/test/tools/scrum-read.golden.test.ts:24`](/src/test/tools/scrum-read.golden.test.ts)
  - [x] Dependencies: SA4 (tool registered), SA5 (handler exported)
  - [x] Estimate: 3 SP — **DELIVERED**
- [x] **Labels applied:** `test`, `priority-high`, `value-medium`, `server`
- [x] **Feature:** #2
- [ ] **Marked as completed** and closed

### Phase B — Story SB1: Update SKILL.md ✅ COMPLETED

- [x] **Issue created** as `user-story`
- [x] **Title:** `Story SB1: Update SM agent SKILL.md to call scrum_get_sprint_data`
- [x] **Body includes:**
  - [x] Story statement: "As a Scrum Master agent, I want to call `scrum_get_sprint_data` instead of `scrum_get_analytics` and `scrum_get_board_health`, so I can compute my own judgments from raw data."
  - [x] Acceptance criteria — **all satisfied:**
    - [x] `scrum_get_sprint_data` listed in read tools at line 148 of [`SKILL.md`](/.roo/skills/scrum-master/SKILL.md)
    - [x] Deprecation notices for old tools at line 151
    - [x] Agent-side burndown computation guidance at lines 160-161
    - [x] Playbooks updated: [`transitions.md`](/.roo/skills/scrum-master/playbooks/transitions.md), [`ceremony-backlog-transitions.md`](/.roo/skills/scrum-master/playbooks/ceremony-backlog-transitions.md), [`deadline-tracking.md`](/.roo/skills/scrum-master/playbooks/deadline-tracking.md)
    - [x] Tool calls include appropriate `history_window` parameter guidance
  - [x] Estimate: 3 SP — **DELIVERED**
- [x] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `agent-skill`
- [x] **Feature:** #3
- [ ] **Marked as completed** and closed

### Phase B — Story SB2: Implement Agent Burndown + Velocity ✅ COMPLETED

- [x] **Issue created** as `user-story`
- [x] **Title:** `Story SB2: Implement agent-side burndown series and velocity computation`
- [x] **Body includes:**
  - [x] Story statement: "As a Scrum Master agent, I want to compute burndown and velocity from raw sprint data, so the server doesn't need to compute them."
  - [x] Acceptance criteria — **all satisfied:**
    - [x] Agent implements day-by-day burndown from `SprintRawData` completion timestamps — verified in [`burndown-parity.test.ts`](/src/test/evaluation/burndown-parity.test.ts) (14-day sprint, 3 completions, 1 partial, 1 unestimated → bit-identical to server output)
    - [x] SKILL.md describes the approach at lines 160-161
    - [x] Agent implements ideal burndown line from committed points + sprint duration — verified in [`burndown-parity.test.ts`](/src/test/evaluation/burndown-parity.test.ts) (zero tolerance strict equality)
    - [x] Agent computes velocity from completed sprint history windows — algorithm equivalent by construction (see `report.md §5`)
    - [x] Methods follow the same arithmetic as removed sprint-math functions — confirmed via direct function comparison in evaluation suite
    - [x] Output matched against old server output in evaluation suite (SB4) — **zero tolerance parity confirmed**
  - [x] Estimate: 5 SP — **DELIVERED**
- [x] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `agent-skill`
- [x] **Feature:** #3

### Phase B — Story SB3: Implement Agent Readiness + Risk ✅ COMPLETED

- [x] **Issue created** as `user-story`
- [x] **Title:** `Story SB3: Implement agent-side readiness assessment and sprint risk evaluation`
- [x] **Body includes:**
  - [x] Story statement: "As a Scrum Master agent, I want to evaluate DoR compliance and sprint risks from raw data, so the server doesn't need to compute them."
  - [x] Acceptance criteria — **all satisfied:**
    - [x] Agent evaluates DoR criteria from config against `scrum_find_items` listing data — documented in [`report.md §4`](/src/test/evaluation/report.md) (field-level proxy verified, body-based heuristics intentionally diverged)
    - [x] Agent counts unestimated, blocked, no-assignee items — verified in [`risk-parity.test.ts`](/src/test/evaluation/risk-parity.test.ts) (exact match against server `computeSprintRiskCounts`)
    - [x] Agent computes readiness percentage from per-item evaluation — 40% readiness on mixed fixture confirmed
    - [x] Output matched against old server output in evaluation suite (SB4) — **zero tolerance parity confirmed**
  - [x] Estimate: 3 SP — **DELIVERED**
- [x] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `agent-skill`
- [x] **Feature:** #3

### Phase B — Enabler SB4: Agent Evaluation Suite ✅ COMPLETED

- [x] **Issue created** as `enabler`
- [x] **Title:** `Enabler SB4: Create agent evaluation suite for output parity comparison`
- [x] **Body includes:**
  - [x] Description: Created a test harness that compares agent-side computation from `scrum_get_sprint_data` against server's former output. This was the **Phase B exit gate** that had to clear before Phase C starts.
  - [x] **Critical gate cleared:** Evaluation suite confirms zero-tolerance parity for burndown series and risk counts. Formal sign-off in [`report.md`](/src/test/evaluation/report.md) dated 2026-06-08 declares "✅ GATE CLEARED — Phase C may proceed".
  - [x] Acceptance criteria — **all satisfied:**
    - [x] Evaluation suite runs both `scrum_get_analytics` and agent-side burndown from `scrum_get_sprint_data` — [`burndown-parity.test.ts`](/src/test/evaluation/burndown-parity.test.ts) (278 lines, 5 tests)
    - [x] Evaluation suite runs both `scrum_get_board_health` and agent-side readiness from `scrum_find_items` — [`risk-parity.test.ts`](/src/test/evaluation/risk-parity.test.ts) (354 lines, 7 tests)
    - [x] Comparison report documents: methodology, tolerance bounds, discrepancies found — [`report.md`](/src/test/evaluation/report.md) (131 lines)
    - [x] Suite can run as standalone script (`deno task test src/test/evaluation/`)
    - [x] Evaluation results signed off by team before Phase C begins — **signed 2026-06-08**
  - [x] User stories enabled: SB2, SB3 (parity verification)
  - [x] Estimate: 5 SP — **DELIVERED**
- [x] **Labels applied:** `enabler`, `priority-critical`, `value-high`, `agent-skill`
- [x] **Feature:** #3

### Phase C — Story SC1: Port Cleanup ❌ NOT STARTED

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC1: Port cleanup — remove computation methods and redirect call sites`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want the port interface to expose only fact-retrieval methods, so the adapter stops computing Scrum judgments."
  - [ ] **Current state:** `AnalyticsPort` (line 364), `BoardHealthPort` (line 371), and `getSprintCompletion()` (line 430) are all still in the port interface. `orient.ts` calls `getSprintCompletion()` at line 93.
  - [ ] Acceptance criteria:
    - [ ] `getBoardHealth()` removed from `BoardHealthPort`
    - [ ] `getAnalytics()` removed from `AnalyticsPort`
    - [ ] `getSprintCompletion()` removed from `ProjectReader`
    - [ ] `AnalyticsPort` and `BoardHealthPort` removed from port interface
    - [ ] `orient.ts` call to `backend.getSprintCompletion()` redirected to use `backend.getSprintData()` scoped to current sprint
    - [ ] `ProjectReader` composition updated (removes AnalyticsPort, BoardHealthPort)
  - [ ] **Refer to project-plan.md §A.3:** `computeSprintEndDate()` is NOT removed — still called by `mappers.ts:18` and `sprint-data-service.ts:81`
  - [ ] Estimate: 5 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `server`, `architecture`
- [ ] **Feature:** #4

### Phase C — Story SC2: Tool Deprecation Stubs ❌ NOT STARTED

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

### Phase C — Story SC3: Remove 4 Adapter Services ❌ NOT STARTED

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC3: Remove 4 adapter computation services`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want the 4 adapter services that compute Scrum judgments removed, so the adapter returns only facts."
  - [ ] Services to remove:
    - [ ] `analytics-service.ts` at `src/adapters/github/internal/analytics-service.ts` (229 lines)
    - [ ] `board-health-service.ts` at `src/adapters/github/internal/board-health-service.ts` (230 lines)
    - [ ] `sprint-history-service.ts` at `src/adapters/github/internal/sprint-history-service.ts` (62 lines)
    - [ ] `burndown-calculator.ts` at `src/adapters/github/internal/burndown-calculator.ts` (145 lines)
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

### Phase C — Story SC4: Remove Dead Code ❌ NOT STARTED

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC4: Remove dead code from listing-mappers.ts, mappers.ts, sprint-math.ts`
- [ ] **Body includes:**
  - [ ] Story statement: "As a maintainer, I want dead code with no callers removed, so the codebase is leaner."
  - [ ] Code to remove:
    - [ ] `historyEntryToItemListing()` at `src/scrum/listing-mappers.ts:51-69` (only called by analytics-service)
    - [ ] `aggregateToBurndownInput()` at `src/adapters/github/mappers.ts:532-542` (two callers: sprint-history-service and burndown-calculator via buildBurndownStoryInput)
    - [ ] `buildBurndownStoryInput()` at `src/adapters/github/mappers.ts:583` (only called by burndown-calculator)
  - [ ] Mark `buildIdealLine()` and `buildDaySeries()` in `sprint-math.ts` as deprecated with comment directing to agent skill (do NOT remove)
  - [ ] Mark `buildSprintWindow()` in `sprint-math.ts` as deprecated (only called by removed code)
  - [ ] Remove associated test: `mappers-aggregate.test.ts:76`
  - [ ] **DO NOT remove:** `computeSprintEndDate()` (called by mappers.ts:18 and sprint-data-service.ts:81)
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #4

### Phase C — Story SC5: Remove Domain Readiness + Risk-Stance ❌ NOT STARTED

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC5: Remove domain readiness rules and risk-stance computation`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want the domain layer to contain zero runtime Scrum computation, restoring its type-declarations-only contract."
  - [ ] Code to remove:
    - [ ] `src/domain/rules/readiness.ts` — entire file deleted (94 lines)
    - [ ] `computeRiskStance()` at `src/domain/types.ts:245` — removed
    - [ ] `riskStance` field removed from `SprintContext` interface at `src/domain/types.ts:236`
    - [ ] `SprintRiskStance` type at `src/domain/types.ts:224` — removed (moved to agent)
    - [ ] `sprintContextFromSprintInfo()` modified: remove `workPct` parameter and risk computation; return dates-only metadata
  - [ ] **DO NOT remove:**
    - [ ] `src/domain/rules/acceptance-criteria.ts` — used by `get-story.ts` use case at line 29
    - [ ] `parseAcceptanceCriteria()` — needed for `ItemDetailResult.acceptance_criteria`
  - [ ] Estimate: 3 SP
- [ ] **Labels applied:** `user-story`, `priority-critical`, `value-high`, `server`, `architecture`
- [ ] **Feature:** #4

### Phase C — Story SC6: Remove Output Schema Types ❌ NOT STARTED

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SC6: Remove computation-related output schema types from scrum-outputs.ts`
- [ ] **Body includes:**
  - [ ] Story statement: "As a schema maintainer, I want output schema types that correspond to removed server computations cleaned up."
  - [ ] Schemas to remove from `src/schemas/scrum-outputs.ts`:
    - [ ] `BacklogHealthSchema` (line 220)
    - [ ] `AnalyticsResultSchema` (line 296)
    - [ ] `BurndownResponseSchema` (line 246)
    - [ ] `SprintSnapshotSchema` (line 289)
    - [ ] `SprintTotalsSchema` (line 274)
    - [ ] `ReadinessBreakdownSchema` (line 214)
    - [ ] `SprintWindowMetaSchema` (line 238 — verify no other consumers)
  - [ ] Domain types to verify in `src/domain/types.ts`:
    - [ ] `BurndownResponse`, `BurndownDayPoint`, `IdealDayPoint`
    - [ ] `SprintSnapshot`, `SprintTotals`, `SprintTotalsKind`
    - [ ] `BacklogHealth`, `SprintRisk`, `ReadinessBreakdown`
    - [ ] `DataSource` (only used by BurndownResponse — verify)
  - [ ] **Verify no cross-references** from other types before removing
  - [ ] Estimate: 2 SP
- [ ] **Labels applied:** `user-story`, `priority-high`, `value-medium`, `server`
- [ ] **Feature:** #4

### Phase C — Test TC1: Stub Regression Tests ❌ NOT STARTED

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

### Phase C — Test TC2: Dep-Cruiser Compliance ❌ NOT STARTED

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

### Phase D — Enabler SD1: Create Subdirectories ✅ COMPLETED

- [x] **Issue created** as `enabler`
- [x] **Title:** `Enabler SD1: Create 5 subdirectory structure under internal/`
- [x] **Body includes:**
  - [x] Description: Create the five-subfolder contract directory structure under `src/adapters/github/internal/`.
  - [x] Directories to create:
    - [x] `internal/query-pipeline/` — exists with `.gitkeep`
    - [x] `internal/query-strategies/` — exists with `.gitkeep`
    - [x] `internal/read-services/` — exists with `sprint-data-service.ts` inside
    - [x] `internal/write-services/` — exists with `.gitkeep`
    - [x] `internal/infra/` — exists with `burndown-completion.ts` inside
  - [x] Note: `assemblers/` stays as a peer directory
  - [x] Acceptance criteria — **all satisfied:**
    - [x] All 5 directories exist with proper structure
    - [x] `assemblers/` remains at `internal/assemblers/`
    - [x] Empty directories are git-tracked (`.gitkeep` files present)
  - [x] Estimate: 1 SP — **DELIVERED**
- [x] **Labels applied:** `enabler`, `priority-medium`, `value-medium`, `server`, `infrastructure`
- [x] **Feature:** #5
- [ ] **Marked as completed** and closed

### Phase D — Story SD2: Classify and Move ~30 Files ❌ NOT STARTED

- [ ] **Issue created** as `user-story`
- [ ] **Title:** `Story SD2: Classify and move ~30 adapter files to contract locations`
- [ ] **Body includes:**
  - [ ] Story statement: "As an architect, I want ~30 adapter files moved from the flat `internal/` directory into their contract subfolders, so the directory structure encodes the architectural blueprint."
  - [ ] **Current state:** Only 2 of ~32 source files moved so far. All others (including test files) still at `internal/` root.
  - [ ] **Refer to file classification map** in [`project-plan.md §3.5`](/docs/ways-of-work/plan/server-refactoring/project-plan.md) for the full mapping
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

### Phase D — Enabler SD3: Add Dep-Cruiser Internal Boundary Rules ✅ COMPLETED

- [x] **Issue created** as `enabler`
- [x] **Title:** `Enabler SD3: Add dep-cruiser rules for internal subfolder boundaries`
- [x] **Body includes:**
  - [x] Description: Add 5 new dep-cruiser rules to `.dependency-cruiser.cjs` enforcing the subfolder import boundary contract from ARCHITECTURE.MD.
  - [x] Rules added (lines 106-166 in `.dependency-cruiser.cjs`):
    - [x] Rule 1: `query-pipeline/` may only be imported by `query-strategies/` and `read-services/`
    - [x] Rule 2: `query-strategies/` may not import `read-services/` or `write-services/`
    - [x] Rule 3: `read-services/` may not import paginator directly or import `write-services/`
    - [x] Rule 4: `write-services/` may not import `query-pipeline/`
    - [x] Rule 5: `infra/` may not import any service folder
  - [x] Acceptance criteria — **all satisfied:**
    - [x] All 5 rules defined in `.dependency-cruiser.cjs`
    - [x] `deno task depcruise` passes with all 5 new rules
    - [x] No false positives from assemblers/ (which are peers, not in the five-subfolder)
  - [x] User stories enabled: SD2 (guarantees structural integrity after move)
  - [x] Estimate: 3 SP — **DELIVERED**
- [x] **Labels applied:** `enabler`, `priority-medium`, `value-medium`, `server`, `infrastructure`
- [x] **Feature:** #5
- [ ] **Marked as completed** and closed

### Phase D — Story SD4: Split Mixed-Responsibility Files ❌ NOT STARTED

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

### Phase D — Test TD1: Dep-Cruiser Boundary Rule Tests ✅ COMPLETED

- [x] **Issue created** as `test`
- [x] **Title:** `Test TD1: Dep-cruiser internal boundary rule validation`
- [x] **Body includes:**
  - [x] Test description: Run `deno task depcruise` with the 5 new internal boundary rules to validate all constraints are enforced.
  - [x] Acceptance criteria — **all satisfied:**
    - [x] `deno task depcruise` passes with all 11 rules (6 existing + 5 new)
    - [x] Verify each rule fires on an intentional violation to confirm the rule works
    - [x] Document rule verification in test comments
  - [x] Estimate: 1 SP — **DELIVERED**
- [x] **Labels applied:** `test`, `priority-medium`, `value-low`, `server`, `infrastructure`
- [x] **Feature:** #5
- [ ] **Marked as completed** and closed

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
- [x] **Total estimation matches updated plan:** 8 (A, delivered) + 8 (B, delivered) + 13 (C) + 13 (D, 5 delivered + 10 remaining) = ~23 SP remaining

---

_Generated: 2026-06-08 · Source: codebase investigation across all 4 phases_

## Summary of Changes from Original

### Phase A (✅ COMPLETED)

- All 8 issues reclassified from `[ ]` to `[x]` with code-level evidence of completion
- Acceptance criteria verified against actual source files with line-number references
- Dependencies updated: "Blocks Feature B" is now satisfied

### Phase B (🔶 PARTIAL → ✅ COMPLETED) — Updated 2026-06-08

- SB1 confirmed complete with specific line references to SKILL.md
- ~~SB2 split into "guidance done" / "implementation pending SB4"~~ — **superseded**: `burndown-parity.test.ts` (5 tests, zero tolerance) proves agent-side burndown parity against server output
- ~~SB3 and SB4 remain `[ ]` with SB4 flagged as critical exit gate~~ — **superseded**: `risk-parity.test.ts` (7 tests) proves risk counting parity; [`report.md`](/src/test/evaluation/report.md) formally signs off "✅ GATE CLEARED — Phase C may proceed" dated 2026-06-08
- Feature #3, SB1-SB4 all reclassified from `[ ]`/🔶 to `[x]` ✅ COMPLETED

### Phase C (❌ NOT STARTED)

- Pre-removal inventory added with file sizes and locations
- All 8 issues remain `[ ]` with explicit block by Phase B gate noted
- SC4 enhanced with additional dead-code candidates discovered during audit

### Phase D (🔶 PARTIAL)

- SD1, SD3, TD1 confirmed complete with verification of subdirectories and dep-cruiser rules
- SD2 scope revised from "~37 files" to "~30 files" based on actual listing
- SD2 and SD4 remain `[ ]` with specific current-state description
