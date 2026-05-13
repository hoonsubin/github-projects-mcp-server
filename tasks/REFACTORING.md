# Refactoring Plan: MCP Server Architecture

This document is the authoritative source of truth for the MCP server's architecture, known problems, and open work. Update it when a phase completes, a decision is made, or new scope is identified.

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Architecture Vision](#2-architecture-vision)
3. [Stable Tool Surface](#3-stable-tool-surface)
4. [Current Implementation State](#4-current-implementation-state)
5. [Architectural Debt](#5-architectural-debt)
6. [Pending Work](#6-pending-work)
7. [Design Decisions](#7-design-decisions)
8. [Open Questions](#8-open-questions)
9. [Agent Layer Fixes](#6h-agent-layer-fixes) ← subsection of §6

---

## 1. Purpose and Scope

The MCP server exposes a Scrum-vocabulary tool surface (`scrum_*`) where the server owns all ID resolution and the agent speaks only domain concepts: `StoryRef`, `SprintRef`, status names, and vocabulary values.

The architecture is designed so that swapping to a different project management platform requires adding one new adapter directory and changing one import in `index.ts` — no changes to tools, use cases, domain rules, or schemas. This property is achieved through a `ProjectBackend` interface that sits between the use-case layer and the GitHub-specific adapter. Nothing above that interface knows about GitHub; nothing below it knows about Scrum tools or MCP.

---

## 2. Architecture Vision

### Three-layer model

```mermaid
flowchart TD

  subgraph Framework["FRAMEWORK LAYER\nsrc/tools/"]
    direction TB
    FW["MCP tool registration\nthin handlers\nZod param parsing"]
  end

  subgraph UseCase["USE-CASE LAYER\nsrc/scrum/ + src/domain/"]
    direction TB
    UC["Scrum orchestration\ndomain rules\npure computation"]
    PB["interface ProjectBackend\n(src/scrum/ports.ts)"]
  end

  subgraph Adapter["ADAPTER LAYER\nsrc/adapters/github/"]
    direction TB
    AD["GitHubProjectBackend implements ProjectBackend"]
  end

  FW -->|calls use-case functions| UC
  UC -->|depends on| PB
  AD -.->|implements\nDependency Inversion| PB
```

### Dependency Rules

| What                   | May import                                                    | Must not import                                |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `src/domain/`          | Nothing (std lib only)                                        | Anything else                                  |
| `src/scrum/`           | `src/domain/`, `src/types.ts`                                 | `src/adapters/`, `src/tools/`, `src/services/` |
| `src/adapters/github/` | `src/scrum/ports.ts`, `src/domain/`, `src/services/`          | `src/tools/`, `src/scrum/*.ts` (use cases)     |
| `src/tools/`           | `src/scrum/`, `src/domain/`, `src/schemas/`                   | `src/adapters/` directly                       |
| `src/index.ts`         | Everything (Main — the only place that knows all concretions) | —                                              |

---

## 3. Stable Tool Surface

### Read tools (7)

| Tool                 | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `scrum_orient`       | Current platform state + declared vocabulary — agent's entry point  |
| `scrum_get_sprint`   | Sprint snapshot(s): lightweight item listing grouped by sprint      |
| `scrum_get_backlog`  | Unsprinted active stories, filterable, with readiness summary       |
| `scrum_get_story`    | Full detail: body, comments, linked PRs, parsed acceptance criteria |
| `scrum_get_history`  | Completed-sprint snapshots in the same shape as `scrum_get_sprint`  |
| `scrum_get_burndown` | Day-by-day burndown series + ideal line for a sprint                |
| `scrum_get_template` | Fetch a project-configured ceremony artifact template               |

### Write tools (7)

| Tool                      | Purpose                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `scrum_create_story`      | Create a story and optionally place it on the board                                        |
| `scrum_update_story`      | Edit story content (title, body, labels, assignees, epic)                                  |
| `scrum_set_field`         | Single entry point for all board-field mutations                                           |
| `scrum_plan_sprint`       | Bulk-assign stories to a sprint                                                            |
| `scrum_log_impediment`    | Create an impediment; optionally link it to an affected story or sprint (or log as orphan) |
| `scrum_update_impediment` | Advance an impediment lifecycle: `open → in_progress → resolved`                           |
| `scrum_add_vocabulary`    | Idempotent add of a field option or label to the platform schema                           |

### Deprecated

| Tool             | Status                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `github_graphql` | Kept for diagnostic GraphQL lookups; mutations blocked; to be removed in a future cleanup pass |

---

## 4. Current Implementation State

All backend abstraction (Phase 5), tool extraction (Phase 2), write tools (Phase 3), and dead-code cleanup (Phase 4) are complete. The server is fully on the `scrum_*` surface. `index.ts` wires `registerScrumReadTools` and `registerScrumWriteTools` against `GitHubProjectBackend`.

**Type restructure complete (Phases A / B / C):** Types now live at their correct architectural layer: `src/domain/types.ts` (domain entities), `src/domain/config.ts` (`ScrumConfig`), `src/adapters/github/types.ts`. `raw-types.ts` has been deleted. `src/types.ts` is a tombstone comment file awaiting `rm`.

**Sprint listing redesign complete:** `SprintSnapshot`, `StoryListing`, and `ImpedimentListing` are defined in `src/scrum/ports.ts`. `scrum_get_sprint` (including `"all"` support) and `scrum_get_history` return the aligned shape. `scrum_get_backlog` returns `StoryListing[]` with active-item filtering and an `orphan_impediments` field; `getOrphanImpediments()` is declared on `ProjectBackend` but the backend implementation is a stub returning `[]`. `SprintSnapshot.impediments` is hardcoded to `[]` in all listing tools pending Phase 7 enrichment.

Remaining open work lives in §5 (architectural debt) and §6 (pending feature work).

| File                             | State      | Notes                                                                                    |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `src/scrum/get-backlog.ts`       | 🟡 Partial | Use case done; `getOrphanImpediments()` backend query is a stub — see §6b                |
| `src/tools/scrum-write.ts`       | 🟡 Pending | `scrum_log_impediment` signature + priority fix; add `scrum_update_impediment` — see §6b |
| `src/adapters/github/backend.ts` | 🟡 Debt    | 1042 lines; `getOrphanImpediments()` is a TODO stub — see §6a, §6d                       |
| `src/types.ts`                   | 🔴 Delete  | Tombstoned. Run `rm src/types.ts`.                                                       |

---

## 5. Architectural Debt

These are structural problems identified by architecture audit against Clean Architecture principles. They are not crashes or functional bugs — they are constraints that will increase the cost of change as the system grows. Ordered by severity.

---

### P1 — `ProjectBackend` violates Interface Segregation

`ProjectBackend` in `ports.ts` defines 12 methods (8 read + 4 write). Every use case receives the full interface, but each use case calls at most 1–3 methods:

- `getBacklogUseCase` calls `getBacklogStories()` only
- `getSprintUseCase` calls `getSprintStories()` only
- `getTemplateUseCase` calls `fetchRepoFile()` only
- `getBurndownUseCase` calls `getBurndownInput()` + `resolveCompletionTimestamps()`

The Interface Segregation Principle states that clients must not depend on methods they do not use. A use case forced to accept a 12-method interface cannot be tested with a minimal stub — the test double must implement the entire surface even for the 10 methods not under test. It also means any signature change anywhere in `ProjectBackend` propagates as a type-check failure to every use case, coupling unrelated concerns at compile time.

---

### P1 — `services/pagination.ts` and `services/resolver.ts` are misplaced

Both files are tightly coupled to GitHub's internals:

- `pagination.ts` constructs GitHub-specific GraphQL queries parameterized by `owner`, `ownerType`, and `projectNumber`, and its `PaginatedProjectItemFetcher` consumes raw GitHub project item node shapes.
- `resolver.ts` operates on `PVTI_` project item node IDs and maps GitHub's internal item model to `ResolvedStory`.

Both belong in `adapters/github/` alongside `backend.ts`, `mappers.ts`, `config-loader.ts`, `queries.ts`, and `raw-types.ts` — the cohesive unit of all GitHub-specific adapter code.

The `services/` folder is currently a mixed bag: the HTTP client (`github.ts`), a pure cross-cutting utility (`logger.ts`), a pure validator (`mutation-validator.ts`), and these two GitHub-specific adapter helpers. Lumping adapter internals with infrastructure services obscures the layer boundaries that the architecture diagram correctly describes.

---

### P1 — `GitHubProjectBackend` violates Single Responsibility

`GitHubProjectBackend` is 1042 lines and handles sprint resolution, paginated item fetching, field ID resolution, story mapping, label creation, milestone management, config state inspection, burndown completion fetching, and both GraphQL and REST execution. Each of these is a distinct reason for the class to change.

The Single Responsibility Principle defines responsibility as "a reason to change" — the class should have only one. Under the current design, a change to how burndown completion timestamps are fetched, a change to how labels are resolved, and a change to how sprint iterations are enumerated all require editing the same class. This makes changes harder to isolate, test, and review.

The class's own inline comment acknowledges this: `//todo: this class is way too massive. It should be broken down even further and separate reusable logic outside of the class`.

**Target:** Split into 6 cohesive services (§6d below). Target backend size: ~200 lines.

---

### P1 — `github.ts` conflates unrelated concerns (partially resolved)

`GitHubApiError` and `enrichError()` have been extracted: errors now live in `src/adapters/github/errors.ts` and `src/services/error-enrichment.ts` respectively. `src/services/github.ts` is now ~338 lines.

The remaining concern is HTTP transport and the GitHub Contents API still bundled together. `scrum-write.ts` also imports `graphql` directly from `services/github.ts` — only used by the deprecated `github_graphql` tool. Remaining splits are tracked in §6e.

---

## 6. Pending Work

### 6a. Backend Code Quality — `src/adapters/github/backend.ts`

**Why:** `backend.ts` has grown to 1042 lines with accumulated smells that increase the cost of the §6d split and ongoing feature work. Address these before or alongside the split.

1. **Label creation duplicated** — `resolveLabelNodeIds`, `resolveOrCreateLabel`, `addLabel`, and `resolveOrCreateMilestoneNodeId` all implement the same fetch-or-create pattern against the repo labels API (`resolveOrCreateLabel` is called 6 times). Extract a single canonical `resolveOrCreateLabel(name): Promise<string>` collaborator.

2. **String interpolation in GraphQL mutations** — `setFieldStatus`, `setFieldSprint`, `setFieldStoryPoints`, `setFieldPriority`, and `clearField` use template literals (`${itemId}`, `${fieldId}`, `${optionId}`) directly in mutation strings. Replace with parameterized GraphQL variables to eliminate injection risk.

3. **`createStory` is 119 lines** — handles six distinct concerns (draft creation, label resolution, milestone resolution, field assignment, comment posting, result projection). Extract helpers or delegate to §6d services.

4. **`getOrphanImpediments()` is a TODO stub** — declared on `ProjectBackend` and called by the `get-backlog` use case but the implementation returns nothing. Needs a real query: fetch issues labeled `"impediment"` from `tracked_repos` and filter to those whose comment bodies contain no `PVTI_` project item ID (i.e., not linked to any story or sprint). Project to `ImpedimentListing`.

5. **`fetchAllItems` duplicates `PaginatedProjectItemFetcher`** — two independent pagination implementations cover the same query. Remove one.

### 6b. Tool Surface Improvements

#### `getOrphanImpediments()` — backend implementation

**Why:** The `get-backlog` use case calls `backend.getOrphanImpediments()`, which is declared on `ProjectBackend` but returns `[]` in `GitHubProjectBackend`. Every `scrum_get_backlog` response has an empty `orphan_impediments` field, making project-level impediments invisible to the agent.

**Changes:** Implement `getOrphanImpediments()` in `backend.ts`: query issues labeled `"impediment"` across `tracked_repos`; filter out any issue whose comment bodies contain a `PVTI_` project item ID (those are already linked to a story or sprint); project each remaining issue to `ImpedimentListing`.

**Files:** `src/adapters/github/backend.ts`

**Acceptance criteria:**

- Unlinked impediment issues appear in `scrum_get_backlog.orphan_impediments`
- Issues with a `PVTI_` reference in any comment are excluded
- An empty array (not an error) is returned when no orphans exist

---

#### `SprintSnapshot.impediments` — enrichment (Phase 7)

**Why:** `scrum_get_sprint` and `scrum_get_history` both return `SprintSnapshot` with `impediments: []` hardcoded. Sprint-level impediment context is invisible to the agent when reviewing sprint state or history.

**Changes:** Add `getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]>` to `ProjectBackend`. Implement in `backend.ts`: query issues labeled `"impediment"` whose bodies or comments reference the sprint's iteration name. In `get-sprint.ts` and `get-history.ts`, replace the hardcoded `[]` with a call to this method.

**Files:** `src/scrum/ports.ts`, `src/scrum/get-sprint.ts`, `src/scrum/get-history.ts`, `src/adapters/github/backend.ts`

**Acceptance criteria:**

- `SprintSnapshot.impediments` contains all impediments associated with the sprint
- An empty array is returned when no impediments exist for the sprint

---

#### Hardcoded terminal status detection

**Why:** `get-backlog.ts` and `get-history.ts` both use `.toLowerCase() === "done"` to identify terminal items. This silently breaks for any team that renames their done column. The canonical terminal status is already declared in `config.yml` (`scrum.status.<key>.terminal: true`). The `_scrumConfig` parameter in `get-history.ts` is passed but unused; `get-backlog.ts` receives `scrumConfig` but does not use it for this check.

**Changes:** In both files, replace the hardcoded `"done"` comparison with a lookup: find the status key where `terminal: true` in `scrumConfig.scrum.status`, then compare against its `status_display` value from the backend config. Activate `_scrumConfig` → `scrumConfig` in `get-history.ts`.

**Files:** `src/scrum/get-backlog.ts`, `src/scrum/get-history.ts`

**Acceptance criteria:**

- Active-item filter uses the config-declared terminal status, not a hardcoded string
- Renaming the done status in `config.yml` correctly affects filtering without code changes

---

#### `scrum_log_impediment` — optional `affects` and priority fix

**Why:** `affects` is a required `StoryRef` — a project-level impediment not attributable to a single story cannot be logged. The handler also hardcodes `"Must"` as the default priority, violating the vocabulary rule: display labels must always be derived from config, never hardcoded.

**Changes:**

- Make `affects` optional in `LogImpedimentSchema`: `affects?: { story?: StoryRef; sprint?: SprintRef }`. At most one sub-field. Omitting logs a project-level orphan.
- Update return shape: `{ impediment: ImpedimentListing; affects: { story: StoryRef } | { sprint: SprintRef } | null }`
- In `registerScrumWriteTools`, rename `_scrumConfig` → `scrumConfig` and derive the p0 display label from `scrumConfig` at runtime.

**Files:** `src/schemas/scrum.ts`, `src/tools/scrum-write.ts`

**Acceptance criteria:**

- `scrum_log_impediment` succeeds with no `affects` field; return includes `affects: null`
- Default priority resolves to the p0 label from `config.yml`, not a hardcoded string

---

#### `scrum_update_impediment` — new write tool

**Why:** The impediment lifecycle (`open → in_progress → resolved`) is declared in §3 and §7 but no tool exists to advance it. The agent can log impediments but never close them.

**Changes:** Add `scrum_update_impediment`:

```typescript
// Arguments
{ ref: ImpedimentRef; status: "open" | "in_progress" | "resolved"; resolution_notes?: string }
// Returns: ImpedimentListing
```

Add `UpdateImpedimentSchema` to schemas. Create `src/scrum/update-impediment.ts` use case. Add `updateImpediment(ref, status, notes?): Promise<ImpedimentListing>` to `ProjectBackend`. Implement in `backend.ts` (update label + append resolution comment). Register in `scrum-write.ts`.

**Files:** `src/schemas/scrum.ts`, `src/scrum/update-impediment.ts` (new), `src/scrum/ports.ts`, `src/adapters/github/backend.ts`, `src/tools/scrum-write.ts`

**Acceptance criteria:**

- `scrum_update_impediment` with `status: "resolved"` updates the label and posts `resolution_notes` as a comment
- Returns `ImpedimentListing` with the updated status
- Tool appears in `scrum_orient`'s tool surface listing

---

#### `scrum_orient` — response shape correctness

**Why:** The agent's session-start rules extract `vocabulary.status`, `vocabulary.priority`, `vocabulary.dor`, `vocabulary.dod`, `vocabulary.team`, `vocabulary.autonomy`, and `platform_state.missing_options` from `scrum_orient`. The actual response uses `declared_vocabulary` as the top-level key, `definition_of_ready`/`definition_of_done` as field names, two nested `missing_options` arrays under each field, and omits `autonomy`. Every agent session starts with silent field-path mismatches that break vocabulary-dependent logic.

**Changes:**

- Rename `declared_vocabulary` → `vocabulary` in `OrientResult` and `orientUseCase`
- Rename `vocabulary.definition_of_ready` → `vocabulary.dor` and `vocabulary.definition_of_done` → `vocabulary.dod`
- Add `vocabulary.autonomy: { require_confirmation_above_n_items: number }` sourced from `scrumConfig.project.agent.autonomy`
- Flatten `platform_state.fields.status.missing_options` and `platform_state.fields.priority.missing_options` into a single `platform_state.missing_options: string[]`

**Files:** `src/scrum/orient.ts`

**Acceptance criteria:**

- `scrum_orient` returns `vocabulary` (not `declared_vocabulary`) at the top level
- `vocabulary.dor`, `vocabulary.dod`, `vocabulary.autonomy` are present with correct values from `config.yml`
- `platform_state.missing_options` is a flat string array merging all field gaps

---

#### `scrum_update_story` — comment field

**Why:** The conduct rule `prefer_comments_over_body_edits` instructs the agent to use `scrum_update_story` with a `comment` field for ceremony notes and progress updates. `UpdateStorySchema` has no `comment` field, making the rule unenforceable. `backend.addComment()` already exists on `ProjectBackend`.

**Changes:**

- Add optional `comment: string` to `UpdateStorySchema`
- Handler calls `backend.addComment(ref, comment)` after content updates when `comment` is provided
- `comment` and content fields (`title`, `body`, etc.) can be combined in one call

**Files:** `src/schemas/scrum.ts`, `src/tools/scrum-write.ts`

**Acceptance criteria:**

- `scrum_update_story` with only `{ ref, comment }` posts a comment and leaves all other fields unchanged
- Return is the updated `Story` object (same as existing behavior)
- `UpdateStorySchema` remains `.strict()`

---

#### `scrum_plan_sprint` — sprint goal

**Why:** The sprint planning ceremony calls `scrum_plan_sprint` with the agreed sprint goal. `PlanSprintSchema` has no `goal` field, so the goal is silently dropped — the sprint starts with no documented goal, which is a core ceremony failure.

**Changes:**

- Add optional `goal: string` to `PlanSprintSchema`
- Echo `goal` in the response alongside `sprint`, `assigned`, `skipped`
- The server echoes the goal back; the agent records it in the sprint planning ceremony artifact (see §6h.4)

**Files:** `src/schemas/scrum.ts`, `src/tools/scrum-write.ts`

**Acceptance criteria:**

- `scrum_plan_sprint` accepts an optional `goal` and echoes it in the response
- Existing calls without `goal` remain valid (no breaking change)

---

### 6c. Unit Tests for Use Cases

One test file exists (`src/scrum/get-backlog.test.ts`) but coverage is minimal. No other use-case unit tests exist. Phase 5 specified at least one unit test per use case with a stubbed `ProjectBackend`. Low priority until coverage becomes a concern.

---

### 6d. Backend Split — `GitHubProjectBackend` → 6 Cohesive Services

**Problem:** The class has 1042 lines and 10+ responsibilities. Each `setField*` method duplicates the same GraphQL mutation pattern. Label resolution fetches the same `GET_REPO_LABELS_QUERY` independently multiple times. `createStory()` is 119 lines handling 6 distinct concerns.

**Split plan:**

| Service                 | Extracted From                                                                                              | Lines Removed |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| `LabelResolver`         | `resolveLabelNodeIds`, `resolveOrCreateLabel`, `addLabel`, `hashToColor`, `fetchRepoNodeId`                 | ~130          |
| `FieldValueMutator`     | `clearField`, `setFieldStatus`, `setFieldSprint`, `setFieldStoryPoints`, `setFieldPriority`                 | ~80           |
| `BurndownCalculator`    | `getBurndownInput`, `resolveCompletionTimestamps`, `fetchAuditLogCompletions`, `fetchIssueCloseCompletions` | ~170          |
| `SprintHistoryService`  | `getCompletedSprintHistory`                                                                                 | ~50           |
| `VocabularyManager`     | `addVocabulary`, `addStatusOption`, `addPriorityOption`, `addSingleSelectOption`                            | ~75           |
| `UserMilestoneResolver` | `resolveUserNodeId`, `resolveUserNodeIds`, `resolveOrCreateMilestoneNodeId`                                 | ~85           |

**Result:** `GitHubProjectBackend` becomes a ~200-line coordinator that delegates to injected services (DIP). All services live in `adapters/github/internal/`.

### 6e. `github.ts` Split — Remaining Extractions

**Why:** `GitHubApiError` and `enrichError()` have already been extracted (`adapters/github/errors.ts` and `services/error-enrichment.ts`). `services/github.ts` (~338 lines) still bundles HTTP transport and the GitHub Contents API in one file. `scrum-write.ts` also imports `graphql` directly from it — only for the deprecated `github_graphql` tool — leaving a `tools → services/github.ts` dependency path that bypasses `ProjectBackend`.

**Remaining splits:**

| Extract from `services/github.ts`                           | Target                           |
| ----------------------------------------------------------- | -------------------------------- |
| `graphql()`, `rest()` — HTTP transport                      | `adapters/github/http-client.ts` |
| `fetchRepoFile()`, `decodeRepoFileContent()` — Contents API | `adapters/github/contents.ts`    |

Remove the `graphql` import from `scrum-write.ts` when the deprecated `github_graphql` tool is removed or redirected to `http-client.ts`.

**Acceptance criteria:**

- No file outside `adapters/github/` imports from `services/github.ts`
- `services/github.ts` can be deleted without breaking any import

### 6f. `ProjectBackend` Port Pollution

**Problem:** The `ProjectBackend` interface (the clean port) leaks GitHub-specific details:

- `fetchRepoFile(path)` — GitHub Contents API method on a platform-agnostic interface
- `VocabularyKind = "status_option" \| "priority_option" \| "label"` — GitHub terminology
- `addVocabulary(kind, value)` — GitHub-specific vocabulary management

**Impact:** A Jira or Azure DevOps backend must implement `fetchRepoFile()`, understand GitHub label terminology, and implement vocabulary management that may not map to the target platform.

**Fix:** Remove `fetchRepoFile()` from `ProjectBackend` (handle in tool handlers directly). Generalize `VocabularyKind` or move `addVocabulary` to an extended `ProjectWriter` interface. Keep `setField()` field names — they are domain-neutral scrum concepts.

### 6g. `services/pagination.ts` and `services/resolver.ts` Misplacement

**Problem:** Both files are 100% GitHub-specific but live in `services/` alongside generic infrastructure. `pagination.ts` constructs GitHub GraphQL queries and consumes raw GitHub project item node shapes. `resolver.ts` operates on `PVTI_` project item node IDs.

**Fix:** Move both to `adapters/github/internal/`. The `services/` folder should contain only truly generic utilities (logger, mutation validator).

---

### 6h. Agent Layer Fixes

Changes to `.roo/rules-scrum-master/*.xml` and `.roo/skills/scrum-master/SKILL.md`. No TypeScript files are touched.

**Execution dependency:** 6h.2 must follow the §6b `scrum_orient` response fix. 6h.1 (item 4) must follow the §6b `scrum_update_story` comment field addition. All other items are independent.

---

#### 6h.1 Wrong tool references in ceremony rules

**Why:** Four places in the rules reference tools for operations those tools do not support. The agent will fail silently or perform an unintended action.

**Changes:**

`4_transitions.xml` — board_catchup Phase 2 and stale_recovery Phase 4:

- "Mark as Done via `scrum_update_story`" → call `scrum_set_field` with `field: "status"` and value from `vocabulary.status.done`. Status is a board field; `scrum_update_story` handles content only.

`3_sm_stance.xml` — `dod_lowered_for_deadline` dysfunction signal:

- "Create a tech-debt story immediately via `scrum_update_story`" → `scrum_create_story` with `type: "tech_debt"`. `scrum_update_story` edits existing stories; creating a new one requires `scrum_create_story`.

`1_workflow.xml` — sprint_planning ceremony Step 5:

- Remove "capacity" from the `scrum_plan_sprint` call description. Capacity is agent-computed from `scrum_get_sprint`; it is not a tool parameter.
- State that the agreed `goal` is passed as the `goal` parameter.

`2_conduct.xml` — `prefer_comments_over_body_edits` rule:

- Clarify that this works because `scrum_update_story` now accepts a `comment` field (§6b). No logic change — confirm the mechanism so the rule is self-explanatory.

**Acceptance criteria:**

- No rule in any file references `scrum_update_story` for a status change
- No rule references `scrum_update_story` for creating a new story
- Sprint planning Step 5 mentions `goal` as a parameter and does not mention `capacity` as one

---

#### 6h.2 `scrum_orient` field paths in `1_workflow.xml` Step 1

**Why:** After the §6b `scrum_orient` response fix, Step 1's extraction list must match the actual response shape or every session will fail to extract the vocabulary it depends on.

**Changes (`1_workflow.xml` Step 1 only):**

- `vocabulary.status`, `vocabulary.priority`, `vocabulary.dor`, `vocabulary.dod`, `vocabulary.team` are now correct (the rename makes them match)
- Replace `config.autonomy` → `vocabulary.autonomy.require_confirmation_above_n_items`
- Replace the `missing_options` reference with `platform_state.missing_options` (the flat merged array)

**Acceptance criteria:**

- Every field path listed in Step 1 exists as a key in a real `scrum_orient` response
- No reference to `declared_vocabulary`, `config.autonomy`, or nested `fields.*.missing_options` remains in Step 1

---

#### 6h.3 Impediment de-duplication guidance

**Why:** The session-start health check (`1_workflow.xml` Step 3) tells the agent to call `scrum_log_impediment` for every blocked item with no logged impediment. There is no guidance on how to determine "no logged impediment," causing the agent to create duplicate impediment stories on every session start.

**Change (`1_workflow.xml` Step 3):**

- Before the `scrum_log_impediment` call, add: "Call `scrum_get_backlog` with `labels: ['impediment']` first. Only call `scrum_log_impediment` for blocked stories that have no matching open entry in that result."

**Acceptance criteria:**

- The health check step describes the de-duplication check before logging
- Duplicate impediment creation across sessions is not possible by following the rule

---

#### 6h.4 Ceremony template delivery path

**Why:** Every ceremony playbook ends with "Call `scrum_get_template` when a ceremony record is needed" but none say what to do with the returned markdown. `config.yml` declares `ceremony_records.backend: github_discussions` and `ceremony_records.discussion_category: Ceremonies`, but no rule instructs the agent to post there. Ceremony documents are fetched and discarded.

**Change (`1_workflow.xml` — add final step to each ceremony's `tool_sequence`):**

- "Fill in the blank sections with session data. Post the completed document to GitHub Discussions under the `ceremony_records.discussion_category` from `config.yml` using `gh discussion create` via `execute_command`."

**Acceptance criteria:**

- Each of the five ceremony playbooks (sprint_planning, daily_standup, backlog_refinement, sprint_review, retrospective) has an explicit final step naming the delivery target and command

---

#### 6h.5 SKILL.md — tool-grounded coaching pattern

**Why:** The routing table correctly points to reference files for coaching topics, but the reference files contain illustrative example data (sample velocity figures, hypothetical dysfunction patterns). When `scrum_*` tools are available, the agent may reason from these examples instead of actual board data, undermining coaching quality.

**Change (`.roo/skills/scrum-master/SKILL.md` — add a section before the routing table):**

- Title: "When `scrum_*` tools are available"
- Rule: For any coaching response that references project metrics, call the relevant read tool first. Reference files provide frameworks, never data.
  - Velocity, completion trends, retro history → `scrum_get_history` first
  - Burndown or sprint progress → `scrum_get_burndown` / `scrum_get_sprint` first
  - Current sprint state → `scrum_get_sprint` first
- Keep the section to ≤8 lines.

**Acceptance criteria:**

- Section is present and precedes the routing table
- It does not duplicate any routing table entry

---

## 7. Design Decisions

| Topic                                         | Decision                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Epic field**                                | Maps to GitHub `Milestone`. `scrum_update_story` creates the Milestone if not found.                                                                                                                                                                                                       |
| **Assignee writes**                           | Use `updateIssue` mutation only — not a separate project field.                                                                                                                                                                                                                            |
| **Sprint "next" resolution**                  | The scheduled iteration immediately after the active one, by iteration order.                                                                                                                                                                                                              |
| **Sprint "all" resolution**                   | Every iteration not in `config.iterations.completed` at call time.                                                                                                                                                                                                                         |
| **`github_graphql` tool**                     | Kept, deprecated. Mutations blocked at the tool level.                                                                                                                                                                                                                                     |
| **Config file location**                      | `.github/scrum/config.yml` in the repo — fetched via GitHub API at invocation time.                                                                                                                                                                                                        |
| **Caching**                                   | No server-side config cache in v1. Each tool invocation calls `loadConfig`.                                                                                                                                                                                                                |
| **Stateless server**                          | No shared mutable state. All handlers call `loadConfig` at invocation time.                                                                                                                                                                                                                |
| **Backend decoupling mode**                   | Source-level (single Deno process). `index.ts` is the only file that knows the concrete implementation.                                                                                                                                                                                    |
| **Listing tools return `StoryListing`**       | Full `Story` (body, AC, comments, linked PRs) is only returned by `scrum_get_story`. All listing tools return `StoryListing`.                                                                                                                                                              |
| **`statusOptions` map shape**                 | `{ displayName → optionId }` — keys are display names (what the agent passes), values are GitHub internal option IDs (what mutations need).                                                                                                                                                |
| **Active item filter**                        | Listing tools silently exclude archived items and items in terminal status belonging to completed sprints. No parameter needed; history is the only window into completed work.                                                                                                            |
| **`scrum_get_history` shape parity**          | Returns `SprintSnapshot[]` — same structure as `scrum_get_sprint("all")`. History-specific stats are additions within `SprintSnapshot.totals`.                                                                                                                                             |
| **`StoryRef` id-only model**                  | `StoryRef` contains a single field: `id: string` (opaque `PVTI_...` handle). `Story.key` is display-only (human-readable issue number, null for Draft Issues). Lookup-by-key (`scrum_find_story`) is out of scope for v1.                                                                  |
| **Draft Issues in `StoryRef`**                | `resolveStory` handles Draft Issues: `issueId` and `issueNumber` return `null`. Write operations requiring a real Issue throw a clear error prompting conversion.                                                                                                                          |
| **Impediment as first-class artifact**        | `impediment` is NOT a `StoryType`. Impediments are a separate artifact with `ImpedimentRef`, `ImpedimentListing`, and a 3-state lifecycle (`open → in_progress → resolved`). Surface: `scrum_get_story.impediments`, `SprintSnapshot.impediments`, `scrum_get_backlog.orphan_impediments`. |
| **`scrum_log_impediment.affects`**            | Optional `{ story?: StoryRef; sprint?: SprintRef }`. At most one sub-field. Omit to log a project-level orphan. Bidirectional cross-reference created atomically.                                                                                                                          |
| **Impediment lifecycle writes**               | Dedicated `scrum_update_impediment` tool handles `open → in_progress → resolved`. `scrum_set_field` is not overloaded — story and impediment artifacts remain distinct at the tool surface.                                                                                                |
| **`ScrumConfig` (was `ScrumConfigYml`)**      | Renamed in Phase C. All use-case signatures receive `scrumConfig: ScrumConfig`. Adapter accesses GitHub fields via `as GitHubBackendConfig`; use-case layer uses inline `type GhDisplay` shape cast.                                                                                       |
| **`src/types.ts` and `raw-types.ts` removal** | Tombstoned in Phases B/C. Physical `rm` required locally. All types live at their architectural layer.                                                                                                                                                                                     |
| **Sprint goal storage**                       | `scrum_plan_sprint` echoes the `goal` string in its response but does not persist it to GitHub. The agent records the sprint goal in the sprint planning ceremony artifact (GitHub Discussions via `execute_command`). Server-side goal persistence is out of scope for v1.                |

---

## 8. Open Questions

| Question                                                                           | Status                                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Should `scrum_get_burndown` skip non-working days in the series?                   | Deferred. v1 includes all calendar days.                                                                     |
| Should the burndown ideal line use team capacity rather than a straight line?      | Deferred. Straight line is the Scrum standard.                                                               |
| Should `scrum_get_history` support iteration by date range rather than just count? | Deferred. `window` (count) is sufficient for v1.                                                             |
| Should `scrum_get_sprint("all")` include iterations with zero assigned items?      | Yes — an empty sprint is visible information. But the agent skill should account for what to do in this case |
