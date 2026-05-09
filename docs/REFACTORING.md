# Refactoring Plan: MCP Server Architecture

**Last updated:** 2026-05-09\
**Status:** Phases 1 – 2.6 complete. Phase 3 (write tools), Phase 4 (cutover), and Phase 5 (backend abstraction) pending.

This document is the authoritative source of truth for the MCP server's architecture and refactoring roadmap. It is designed to be picked up by any coding agent at any point — it describes the full intended state, the current state, and the exact steps to close the gap. Update this file whenever a phase is completed, a decision is changed, or new scope is added.

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Architecture Vision](#2-architecture-vision)
3. [Stable Tool Surface](#3-stable-tool-surface)
4. [Current Implementation State](#4-current-implementation-state)
5. [Known Quality Issues](#5-known-quality-issues)
6. [Target Directory Structure](#6-target-directory-structure)
7. [ProjectBackend Port Interface](#7-projectbackend-port-interface)
8. [Migration Ledger](#8-migration-ledger)
9. [Phase 3 — Write Tool Implementations](#9-phase-3--write-tool-implementations)
10. [Phase 4 — Cutover and Cleanup](#10-phase-4--cutover-and-cleanup)
11. [Phase 5 — Backend Abstraction Layer](#11-phase-5--backend-abstraction-layer)
12. [Recommended Execution Order](#12-recommended-execution-order)
13. [Design Decisions](#13-design-decisions)
14. [Open Questions](#14-open-questions)

---

## 1. Purpose and Scope

### Why this refactoring exists

The MCP server started as a set of GitHub-primitive tools (`github_*`) that exposed GraphQL node IDs, field IDs, and iteration IDs directly to the agent. The current refactoring replaces that surface with a Scrum-vocabulary tool surface (`scrum_*`) where the server owns all ID resolution and the agent speaks only domain concepts: `StoryRef`, `SprintRef`, status names, and vocabulary values.

### Why the architecture goes further than a rename

The Scrum tool surface (`scrum_*`) is the stable contract. The GitHub Projects v2 API is the first and current backend, but it must not be the only possible one. The architecture is designed so that swapping to a different project management platform (e.g., Linear, Trello, Notion) requires adding one new directory and changing one import in `index.ts` — no changes to the tools, use cases, domain rules, or schemas.

This property is achieved through a `ProjectBackend` interface that sits between the use-case layer and the GitHub-specific adapter layer. Nothing above the interface knows about GitHub; nothing below it knows about Scrum tools or MCP.

### What this document covers

- The three-layer target architecture and dependency rules
- The stable tool surface that must never break
- Exact current implementation state (per file, per tool)
- Known quality issues to fix before or during remaining phases
- Complete specifications for all pending phases (3, 4, 5)
- All resolved design decisions and open questions

---

## 2. Architecture Vision

### Three-layer model

The server is organised into three layers with a strict dependency rule: **dependencies flow inward only.** Outer layers depend on inner layers; inner layers never import from outer layers.

```text
┌─────────────────────────────────────────────────────────────────┐
│  FRAMEWORK LAYER   src/tools/                                   │
│  MCP tool registration; thin handlers; Zod param parsing        │
│  Depends on: use-case functions, ScrumConfigYml                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ calls use-case functions
┌───────────────────────────▼─────────────────────────────────────┐
│  USE-CASE LAYER   src/scrum/  +  src/domain/                    │
│  Scrum orchestration; domain rules; pure computation            │
│  Depends on: ProjectBackend interface (owned here), domain types│
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  interface ProjectBackend   (src/scrum/ports.ts)         │   │
│  │  The only crossing point between use cases and backends  │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ implements ↑  (Dependency Inversion)
┌───────────────────────────▼─────────────────────────────────────┐
│  ADAPTER LAYER   src/adapters/github/                           │
│  GitHubProjectBackend implements ProjectBackend                 │
│  All GraphQL queries; field-ID resolution; raw type mapping     │
│  Depends on: ProjectBackend interface + domain types + services │
└─────────────────────────────────────────────────────────────────┘
```

### The Dependency Rule applied

| What                   | May import                                                    | Must not import                                |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `src/domain/`          | Nothing (std lib only)                                        | Anything else                                  |
| `src/scrum/`           | `src/domain/`                                                 | `src/adapters/`, `src/tools/`, `src/services/` |
| `src/adapters/github/` | `src/scrum/ports.ts`, `src/domain/`, `src/services/`          | `src/tools/`, `src/scrum/*.ts` (use cases)     |
| `src/tools/`           | `src/scrum/`, `src/domain/`, `src/schemas/`                   | `src/adapters/` directly                       |
| `src/index.ts`         | Everything (Main — the only place that knows all concretions) | —                                              |

### Backend switchability

`index.ts` is the only file that knows which backend is active. Switching from GitHub to any other platform is:

1. Add `src/adapters/<platform>/backend.ts` implementing `ProjectBackend`
2. Change the import and instantiation in `index.ts`
3. Adjust environment variables

Nothing else changes. The agent prompt, Scrum skill, tool descriptions, schemas, use cases, and domain rules are backend-agnostic by design.

---

## 3. Stable Tool Surface

This is the public contract. These tool names, parameter schemas, and return shapes must not change without explicit user sign-off. Additive changes (new optional fields in responses) are non-breaking.

### Read tools (7)

| Tool                 | Purpose                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `scrum_orient`       | Current platform state + declared vocabulary — agent's entry point |
| `scrum_get_sprint`   | Sprint board: stories grouped by status with point totals          |
| `scrum_get_backlog`  | Unsprinted stories, filterable, with readiness summary             |
| `scrum_get_story`    | Full detail: comments, linked PRs, parsed acceptance criteria      |
| `scrum_get_history`  | Raw completed-sprint snapshots for velocity reasoning              |
| `scrum_get_burndown` | Day-by-day burndown series + ideal line for a sprint               |
| `scrum_get_template` | Fetch a project-configured ceremony artifact template              |

### Write tools (6)

| Tool                   | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `scrum_create_story`   | Create a story and optionally place it on the board              |
| `scrum_update_story`   | Edit story content (title, body, labels, assignees, epic)        |
| `scrum_set_field`      | Single entry point for all board-field mutations                 |
| `scrum_plan_sprint`    | Bulk-assign stories to a sprint                                  |
| `scrum_log_impediment` | Create a blocking impediment linked to an affected story         |
| `scrum_add_vocabulary` | Idempotent add of a field option or label to the platform schema |

### Deprecated (kept, not promoted)

| Tool             | Status                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `github_graphql` | Kept for diagnostic GraphQL lookups; mutations blocked; to be removed in a future cleanup pass |

---

## 4. Current Implementation State

### Per-phase summary

| Phase | Description                                            | Status        |
| ----- | ------------------------------------------------------ | ------------- |
| 1     | Domain types, Zod schemas, `loadConfig`, resolvers     | ✅ Complete   |
| 2     | All 5 original read tools in `scrum-read.ts`           | ✅ Complete   |
| 2.5   | `rest<T>()` helper + `scrum_get_burndown`              | ✅ Complete   |
| 2.6   | `scrum_get_template`                                   | ✅ Complete   |
| 3     | Write tool implementations in `scrum-write.ts`         | ⏸️ Stubs only |
| 4     | `index.ts` cutover; delete legacy tool files           | ⏸️ Pending    |
| 5     | Backend abstraction layer (`ProjectBackend` interface) | ⏸️ Pending    |

> **Critical gap:** `index.ts` currently wires only the legacy `github_*` tools (`registerProjectTools`, `registerItemTools`, `registerRepositoryTools`). **The `scrum_*` tools are fully implemented but not served.** Phase 4 cutover is required before the server exposes the new surface.

### Per-file state

| File                         | State           | Notes                                                                                                    |
| ---------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `src/index.ts`               | ⚠️ Needs update | Still registers legacy tools; Phase 4 will swap                                                          |
| `src/types.ts`               | ⚠️ Mixed        | Scrum domain types present; legacy types (`BoardConfig`, `GhFieldBase`, etc.) pending removal in Phase 4 |
| `src/schemas/scrum.ts`       | ✅ Complete     | All 13 schemas (7 read + 6 write)                                                                        |
| `src/schemas/inputs.ts`      | ⚠️ Legacy       | Old schemas; pending cleanup in Phase 4                                                                  |
| `src/services/config.ts`     | ✅ Complete     | `loadConfig()`, `RuntimeConfig`                                                                          |
| `src/services/resolver.ts`   | ✅ Complete     | `resolveSprint()`, `resolveStory()`                                                                      |
| `src/services/github.ts`     | ✅ Complete     | `graphql()`, `rest()`, `fetchRepoFile()`                                                                 |
| `src/services/pagination.ts` | ✅ Complete     | `PaginatedProjectItemFetcher`, `isBacklogItem`                                                           |
| `src/services/readiness.ts`  | ✅ Complete     | `computeStoryReadiness()`, `computeReadinessSummary()`                                                   |
| `src/services/logger.ts`     | ✅ Unchanged    | No changes needed                                                                                        |
| `src/tools/scrum-read.ts`    | ✅ Complete     | 7 tools registered; `registerScrumReadTools()` exported                                                  |
| `src/tools/scrum-write.ts`   | ⏸️ Stubs        | `registerScrumWriteTools` not yet exported; all 6 write tools are `todo` comments                        |
| `src/tools/projects.ts`      | ⚠️ Legacy       | Delete in Phase 4                                                                                        |
| `src/tools/items.ts`         | ⚠️ Legacy       | Delete in Phase 4                                                                                        |
| `src/tools/repository.ts`    | ⚠️ Legacy       | Gut in Phase 4                                                                                           |

---

## 5. Known Quality Issues

Fix these before or during Phase 3. They are small but one is a live contract bug.

### 5a. Contract bug — `scrum_get_backlog` description mismatches return shape

**Severity: High.** The tool description advertises readiness keys `sprint_ready`, `in_refinement`, `future_candidate` to the agent. The actual JSON response uses `ready`, `partially_ready`, `not_ready` (from `computeReadinessSummary` in `readiness.ts`). The agent will look for the described keys and find nothing.

**Fix:** Update the tool description in `scrum-read.ts` to match the actual keys. Do not change the return shape — the description is wrong, not the implementation.

### 5b. Dead code — `_classifyReadiness` in `scrum-read.ts`

The function `_classifyReadiness` (line ~774) is defined but never called. Actual readiness computation is delegated to `computeReadinessSummary` from `readiness.ts`. The leading underscore prefix was intended to signal "private" but the function has no callers.

**Fix:** Delete `_classifyReadiness` entirely.

### 5c. Inconsistent `yml.status` type assumptions

Two functions cast `yml.status` in incompatible ways:

- `findStatusDisplayName` (line ~482) casts it as `Record<string, string>` and reads `entry[1]` as a string.
- `findDoneStatusName` (line ~932) casts it as `Record<string, { display_name?: string }>` and reads `entry[1]?.display_name`.

Exactly one of these will silently produce the wrong result at runtime. Audit the actual `config.yml` schema, settle on one shape, and eliminate one of the functions.

**Fix:** Verify which shape `yml.status` actually uses at runtime. Consolidate to a single `resolveStatusDisplayName(config, keyHint, fallback)` helper and delete the other.

### 5d. Bootstrap boilerplate repeated in every handler

All 7 tool handlers in `scrum-read.ts` repeat the same 4-line setup block:

```typescript
const { owner, ownerType, projectNumber } = getBootstrapConfig();
const config = await loadConfig({
  github: gh,
  owner,
  ownerType,
  projectNumber,
  repo: getRepo(),
});
```

**Fix:** Extract to a single `loadRuntimeConfig()` helper returning `{ config, owner, ownerType, repo }`. Each handler becomes one expressive line. This is a prerequisite for Phase 5 — after Phase 5, the handler receives `backend` and `yml` via injection rather than constructing them inline.

---

## 6. Target Directory Structure

This is the fully-migrated state after all phases are complete.

```
src/
├── domain/                           ← Entities (no imports outside std lib)
│   ├── story.ts                      — Story, StoryRef, StoryType
│   ├── sprint.ts                     — SprintRef, SprintInfo, IterationEntry
│   ├── config.ts                     — ScrumConfigYml, ArtifactType (pure shape)
│   └── rules/
│       ├── labels.ts                 — classifyLabels()
│       ├── acceptance-criteria.ts    — parseAcceptanceCriteria()
│       └── readiness.ts              — classifyReadiness() [replaces both
│                                        _classifyReadiness and readiness.ts service]
│
├── scrum/                            ← Use cases + port contract
│   ├── ports.ts                      — interface ProjectBackend (THE CONTRACT)
│   ├── sprint-math.ts                — groupStoriesByStatus(), computeSprintTotals(),
│   │                                   buildSprintMeta(), buildSprintWindow(),
│   │                                   buildIdealLine(), buildDaySeries()
│   ├── orient.ts                     — orientUseCase(backend, yml)
│   ├── get-sprint.ts                 — getSprintUseCase(backend, yml, params)
│   ├── get-backlog.ts                — getBacklogUseCase(backend, yml, params)
│   ├── get-story.ts                  — getStoryUseCase(backend, params)
│   ├── get-history.ts                — getHistoryUseCase(backend, yml, params)
│   ├── get-burndown.ts               — getBurndownUseCase(backend, yml, params)
│   ├── get-template.ts               — getTemplateUseCase(backend, yml, params)
│   ├── create-story.ts               — createStoryUseCase(backend, yml, params)
│   ├── update-story.ts               — updateStoryUseCase(backend, params)
│   ├── set-field.ts                  — setFieldUseCase(backend, yml, params)
│   ├── plan-sprint.ts                — planSprintUseCase(backend, yml, params)
│   ├── log-impediment.ts             — logImpedimentUseCase(backend, yml, params)
│   └── add-vocabulary.ts             — addVocabularyUseCase(backend, params)
│
├── adapters/
│   └── github/                       ← GitHub implementation of ProjectBackend
│       ├── backend.ts                — GitHubProjectBackend implements ProjectBackend
│       ├── queries.ts                — all GraphQL query strings
│       ├── mappers.ts                — GitHub raw types → domain types
│       │                               (extractBoardFields, buildStoryFromRaw,
│       │                                buildEnrichedStory, buildCommentList,
│       │                                buildLinkedPrList, buildBurndownStoryInput)
│       ├── config-loader.ts          — loadConfig(), RuntimeConfig, getBootstrapConfig()
│       │                               resolveSprint(), resolveStory()
│       └── raw-types.ts              — RawItem, RawContent, GetProjectItemsResponse, etc.
│
├── services/                         ← Shared infrastructure (platform-agnostic)
│   ├── github.ts                     — graphql(), rest(), fetchRepoFile() [keep as-is]
│   ├── logger.ts                     — [keep as-is]
│   └── pagination.ts                 — PaginatedProjectItemFetcher [keep as-is]
│
├── schemas/
│   └── scrum.ts                      — Zod input schemas for all 13 tools [keep as-is]
│
├── tools/                            ← MCP framework layer
│   ├── scrum-read.ts                 — registerScrumReadTools(server, backend, yml)
│   │                                   7 thin handlers; no business logic
│   └── scrum-write.ts                — registerScrumWriteTools(server, backend, yml)
│                                        6 thin handlers + deprecated github_graphql
│
└── index.ts                          ← Main: constructs GitHubProjectBackend,
                                         wires server, registers tools
```

### What a completed handler looks like (target state after Phase 5)

Every tool handler in `scrum-read.ts` and `scrum-write.ts` should reduce to this shape — parse, delegate, format:

```typescript
server.registerTool(
  "scrum_get_sprint",
  { title: "Get Sprint Board", description: "...", inputSchema: GetSprintSchema.shape, annotations: { ... } },
  async (params: z.infer<typeof GetSprintSchema>) => {
    try {
      const result = await getSprintUseCase(backend, yml, params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
    }
  },
);
```

`backend` and `yml` are injected at server startup by `index.ts`. The handler contains no orchestration, no GitHub imports, no config loading.

---

## 7. ProjectBackend Port Interface

This interface is the entire surface area that separates Scrum policy from platform details. It lives in `src/scrum/ports.ts` and is owned by the use-case layer — implementations depend on it, not the other way around.

All types that cross this boundary are domain types defined in `src/domain/`. No GitHub field IDs, GraphQL shapes, or platform-specific primitives appear on either side of this interface.

```typescript
// src/scrum/ports.ts

import type { ArtifactType, ScrumField, SprintRef, Story, StoryRef } from "../domain/story.ts";

// ── Supporting types that cross the boundary ──────────────────────────────────

/** Lightweight sprint descriptor — no backend-internal IDs. */
export interface SprintInfo {
  name: string;
  startDate: string; // YYYY-MM-DD
  durationDays: number;
  endDate: string; // YYYY-MM-DD (computed by adapter)
}

/** What currently exists on the PM platform. Returned by orient use case. */
export interface PlatformState {
  fields: {
    status: { exists: boolean; options: string[]; missingOptions: string[] };
    sprint: { exists: boolean };
    story_points: { exists: boolean };
    priority: { exists: boolean; options: string[]; missingOptions: string[] };
  };
  labels: { existing: string[]; expected: string[]; missing: string[] };
  iterations: {
    active: SprintInfo | null;
    next: SprintInfo | null;
    completed: SprintInfo[];
    completedCount: number;
  };
}

/** Full story payload with associated data, returned by getStoryDetail. */
export interface StoryDetail {
  story: Story;
  comments: Array<{
    author: string;
    body: string;
    created_at: string;
    url: string;
  }>;
  linkedPrs: Array<{
    number: number;
    title: string;
    url: string;
    state: string;
    is_draft: boolean;
  }>;
}

/** One completed sprint's worth of data for history. */
export interface SprintHistoryEntry {
  info: SprintInfo;
  stories: Array<{
    number: number;
    title: string;
    points: number;
    status: string | null;
  }>;
}

/** Stories + sprint geometry needed to compute a burndown series. */
export interface BurndownInput {
  sprint: SprintInfo;
  stories: Array<{
    number: number;
    title: string;
    points: number;
    status: string | null;
  }>;
}

/** Completion timestamps per story number. */
export interface CompletionMap {
  completions: Map<number, string>; // issue number → ISO-8601 timestamp
  dataSource: "audit_log" | "issue_close_proxy";
  warning?: string;
}

/** Inputs for scrum_create_story. */
export interface CreateStoryInput {
  title: string;
  body: string;
  type: "feature" | "bug" | "tech_debt" | "spike";
  priority?: string;
  storyPoints?: number;
  labels?: string[];
  epic?: string;
  assignees?: string[];
  sprint?: SprintRef;
}

/** Inputs for scrum_update_story. */
export interface StoryUpdates {
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  epic?: string | null;
}

export type VocabularyKind = "status_option" | "priority_option" | "label";

// ── The interface ──────────────────────────────────────────────────────────────

export interface ProjectBackend {
  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Return what currently exists on the PM platform.
   * The adapter computes missingOptions by diffing declared vocabulary values
   * against live platform option names.
   */
  getPlatformState(declaredVocabulary: {
    statusValues: string[];
    priorityValues: string[];
  }): Promise<PlatformState>;

  /**
   * All stories assigned to a sprint, resolved from a SprintRef.
   * The adapter resolves "current" / "next" / sprint-name to its
   * internal iteration identifier.
   */
  getSprintStories(sprint: SprintRef): Promise<{
    stories: Story[];
    sprintInfo: SprintInfo | null;
  }>;

  /**
   * All stories not assigned to any sprint.
   * Client-side filtering (search, labels, priority, epic) is applied
   * by the use case after this call returns.
   */
  getBacklogStories(): Promise<Story[]>;

  /**
   * Full detail for one story: content, board fields, comments, linked PRs.
   * The adapter resolves StoryRef (number or id) to platform identifiers.
   */
  getStoryDetail(ref: StoryRef): Promise<StoryDetail>;

  /**
   * Lightweight story rows for the last `window` completed sprints,
   * most-recent-first. The adapter handles iteration discovery, ordering,
   * and any pagination needed to retrieve story data.
   */
  getCompletedSprintHistory(window: number): Promise<SprintHistoryEntry[]>;

  /**
   * Stories in a sprint shaped for burndown computation.
   * The adapter resolves the SprintRef and collects the story list.
   */
  getBurndownInput(sprint: SprintRef): Promise<BurndownInput>;

  /**
   * Resolve completion timestamps for the stories in a burndown input.
   * The adapter chooses the best available API (audit log, issue events, etc.)
   * and wraps any graceful fallback internally.
   */
  resolveCompletionTimestamps(input: BurndownInput): Promise<CompletionMap>;

  /**
   * Fetch a file from the team's repository by repo-relative path.
   * Used by scrum_get_template to retrieve custom ceremony documents.
   */
  fetchRepoFile(path: string): Promise<string>;

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Create a story and return a StoryRef.
   * The adapter creates the platform item, applies all optional fields,
   * and adds the story to the project board.
   * If item creation succeeds but a field-set fails, the adapter returns a
   * partial result so the use case can retry without duplicating the story.
   */
  createStory(input: CreateStoryInput): Promise<StoryRef>;

  /**
   * Update story content (title, body, labels, assignees, epic).
   * Resolves StoryRef internally.
   */
  updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void>;

  /**
   * Set a single board field on a story.
   * The adapter translates vocabulary values to platform option IDs.
   * If the value is not found in the platform schema, the adapter returns a
   * structured error suggesting scrum_add_vocabulary as the fix.
   */
  setField(
    ref: StoryRef,
    field: ScrumField,
    value: string | number | SprintRef | null,
  ): Promise<void>;

  /**
   * Post a comment on a story.
   * Used internally by scrum_log_impediment for cross-linking.
   */
  addComment(ref: StoryRef, body: string): Promise<void>;

  /**
   * Idempotent addition of a vocabulary entry to the platform schema.
   * - status_option / priority_option: append option to an existing field
   * - label: create a repo label (auto-colour by name hash)
   * Returns { created: false } if the entry already exists.
   * Returns a structured error if the target field does not exist
   * (structural gaps require human action in the platform UI).
   */
  addVocabulary(
    kind: VocabularyKind,
    value: string,
  ): Promise<{ created: boolean }>;
}
```

---

## 8. Migration Ledger

Where each piece of code currently lives and where it moves in Phase 5.

| Symbol                                                        | Current location        | Target location                       | Notes                                                           |
| ------------------------------------------------------------- | ----------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `extractBoardFields()`                                        | `scrum-read.ts`         | `adapters/github/mappers.ts`          | GitHub field-ID-specific; stays in adapter                      |
| `buildStoryFromRaw()`                                         | `scrum-read.ts`         | `adapters/github/mappers.ts`          |                                                                 |
| `buildEnrichedStory()`                                        | `scrum-read.ts`         | `adapters/github/mappers.ts`          |                                                                 |
| `buildCommentList()`                                          | `scrum-read.ts`         | `adapters/github/mappers.ts`          |                                                                 |
| `buildLinkedPrList()`                                         | `scrum-read.ts`         | `adapters/github/mappers.ts`          |                                                                 |
| `buildBurndownStoryInput()`                                   | `scrum-read.ts`         | `adapters/github/mappers.ts`          |                                                                 |
| `fetchAllItems()`                                             | `scrum-read.ts`         | `adapters/github/backend.ts`          | Internal to `GitHubProjectBackend`                              |
| `fetchAuditLogCompletions()`                                  | `scrum-read.ts`         | `adapters/github/backend.ts`          | Implements `resolveCompletionTimestamps`                        |
| `fetchIssueCloseCompletions()`                                | `scrum-read.ts`         | `adapters/github/backend.ts`          | Fallback path inside same method                                |
| `resolveCompletionTimestamps()`                               | `scrum-read.ts`         | `adapters/github/backend.ts`          |                                                                 |
| All GraphQL query strings                                     | `scrum-read.ts`         | `adapters/github/queries.ts`          |                                                                 |
| All raw response interfaces                                   | `scrum-read.ts`         | `adapters/github/raw-types.ts`        | `RawItem`, `RawContent`, etc.                                   |
| `loadConfig()`, `RuntimeConfig`                               | `services/config.ts`    | `adapters/github/config-loader.ts`    | GitHub-specific; platform-agnostic services stay in `services/` |
| `resolveSprint()`                                             | `services/resolver.ts`  | `adapters/github/backend.ts`          | Internal; not part of the port interface                        |
| `resolveStory()`                                              | `services/resolver.ts`  | `adapters/github/backend.ts`          | Internal; not part of the port interface                        |
| `getBootstrapConfig()`                                        | `scrum-read.ts`         | `adapters/github/config-loader.ts`    | Reads GitHub-specific env vars                                  |
| `groupStoriesByStatus()`                                      | `scrum-read.ts`         | `scrum/sprint-math.ts`                | Scrum policy, not GitHub detail                                 |
| `computeSprintTotals()`                                       | `scrum-read.ts`         | `scrum/sprint-math.ts`                |                                                                 |
| `buildSprintMeta()`                                           | `scrum-read.ts`         | `scrum/sprint-math.ts`                |                                                                 |
| `buildSprintWindow()`                                         | `scrum-read.ts`         | `scrum/sprint-math.ts`                |                                                                 |
| `buildIdealLine()`                                            | `scrum-read.ts`         | `scrum/sprint-math.ts`                |                                                                 |
| `buildDaySeries()`                                            | `scrum-read.ts`         | `scrum/sprint-math.ts`                |                                                                 |
| `extractLinkHeader()`                                         | `scrum-read.ts`         | `adapters/github/backend.ts`          | GitHub REST pagination                                          |
| `classifyLabels()`                                            | `scrum-read.ts`         | `domain/rules/labels.ts`              | Pure function, no dependencies                                  |
| `parseAcceptanceCriteria()`                                   | `scrum-read.ts`         | `domain/rules/acceptance-criteria.ts` | Pure function                                                   |
| `computeStoryReadiness()`                                     | `services/readiness.ts` | `domain/rules/readiness.ts`           |                                                                 |
| `computeReadinessSummary()`                                   | `services/readiness.ts` | `scrum/get-backlog.ts` (inlined)      | Only one caller                                                 |
| `_classifyReadiness()`                                        | `scrum-read.ts`         | **Deleted**                           | Dead code — no callers                                          |
| Handler bodies                                                | `scrum-read.ts`         | `scrum/*.ts` (one use case per file)  |                                                                 |
| `StoryReadiness` interface                                    | `types.ts`              | **Deleted or inlined**                | Awkward three-boolean shape; replace with `ReadinessLevel` enum |
| `BoardConfig`, `GhFieldBase`, etc.                            | `types.ts`              | **Deleted**                           | Legacy sync-script types                                        |
| `SprintIteration`, `MergedScrumConfig`, `ResolvedScrumFields` | `types.ts`              | **Deleted**                           | Replaced by `RuntimeConfig` in adapter                          |

---

## 9. Phase 3 — Write Tool Implementations

**Prerequisite:** Resolve quality issues 5a–5d before implementing write tools. Implement Phase 5 (backend abstraction) before Phase 3 so write tools are built on top of the `ProjectBackend` interface from the start.

All six write tools are currently stubs in `src/tools/scrum-write.ts`. Implement in the order below — each builds on the previous.

### 3a. `scrum_add_vocabulary`

Implement first: no resolver needed, simplest mutation surface.

- `kind: "status_option"` → call `updateProjectV2SingleSelectField` mutation using `statusFieldId` from config. If `statusFieldId` is null (field does not exist on the platform), return a structured error explaining that the field must be created manually in the platform UI before options can be added.
- `kind: "priority_option"` → same pattern using `priorityFieldId`.
- `kind: "label"` → call `createLabel` mutation on the repo. Auto-assign a colour by hashing the label name against a fixed palette for determinism. Return `{ created: false }` if the label already exists.
- Idempotent: all three paths return `{ created: false }` rather than an error if the entry already exists.
- Return shape: `{ created: boolean, kind, value }`.

### 3b. `scrum_set_field`

Implement second: this is the primitive that all other write tools depend on internally.

| `field`        | `value`                         | Operation                                                                                                                                                                                |
| -------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | vocabulary display name         | Resolve name → option ID via `statusOptions`; call `updateProjectV2ItemFieldValue` with `singleSelectOptionId`. Return structured error if value not found: hint `scrum_add_vocabulary`. |
| `sprint`       | `SprintRef`                     | Call `resolveSprint` → iteration ID or null; set or clear the iteration field via `updateProjectV2ItemFieldValue`.                                                                       |
| `story_points` | number or null                  | Set or clear the number field via `updateProjectV2ItemFieldValue`.                                                                                                                       |
| `priority`     | vocabulary display name or null | Resolve name → option ID via `priorityOptions`; set or clear.                                                                                                                            |
| `assignee`     | GitHub login or null            | Resolve login → user node ID via a `GetUserNodeId` lookup; set via `updateIssue` mutation (not a project field). null → pass empty array to clear all assignees.                         |

After mutation: fetch current field state via `GET_ITEM_FIELDS_QUERY` and return the updated `Story`.

### 3c. `scrum_update_story`

- Call `resolveStory` to get `itemId` and `issueId`.
- Call `updateIssue` mutation for any of: `title`, `body`, `assignees` (resolve logins → node IDs), `labels` (resolve label names → node IDs via repo labels query).
- `epic`: resolve Milestone title → milestone node ID; call `updateIssue` with `milestoneId`. Pass `null` to detach (set `milestoneId: null`). Create the Milestone if title is provided but not found.
- Return the updated `Story` (re-fetch fields after mutation).

### 3d. `scrum_create_story`

- Resolve type label → label node ID. Create the label if not found (reuse `scrum_add_vocabulary` label logic as an internal helper, not the registered tool).
- Call `createIssue` mutation with `title`, `body`, `labelIds`, `assigneeIds`.
- Call `addProjectV2ItemById` to add the new issue to the project board.
- For each optional field provided (`priority`, `story_points`, `sprint`): apply `scrum_set_field` logic inline via the internal helper — do not call the registered tool to avoid double resolver overhead.
- Partial failure handling: if issue creation succeeds but a subsequent field-set fails, return a structured error containing the partial `StoryRef` (`{ number, id }`). The agent can retry the failing field-sets without duplicating the story.
- Return the newly created `Story`.

### 3e. `scrum_plan_sprint`

- If `replace: true`: fetch all items currently in the target sprint, call the sprint field-set logic on each to clear the sprint assignment. Collect failures without aborting.
- For each `StoryRef` in `stories`: call `resolveStory`, then apply sprint field-set logic.
- Collect `assigned: StoryRef[]` (succeeded) and `skipped: Array<{ ref, reason }>` (failed).
- Return the partial-success report: `{ sprint, assigned, skipped }`.

### 3f. `scrum_log_impediment`

Composes earlier primitives:

1. Call `createStory` internally with:
   - `type: "spike"` (there is no `"impediment"` StoryType)
   - `labels: ["impediment"]` (create label if missing via `addVocabulary` label path)
   - initial `status`: the "Blocked" display name from vocabulary
   - `priority`: `raised_by` param, falling back to the configured Scrum Master's highest priority tier from `config.yml`
2. Call `addComment` on the **affected** story: `"Impediment #N opened against this story."`.
3. Call `addComment` on the **new impediment** story: `"This impediment affects story #M."`.

`addComment` uses the `addComment` GraphQL mutation directly — it is a shared internal primitive, not an agent-callable tool.

Return: `{ impediment: Story, linked_to: StoryRef }`.

---

## 10. Phase 4 — Cutover and Cleanup

**Prerequisite:** Phase 3 complete and all write tools verified.

### `src/index.ts` swap

```typescript
// Remove these three lines:
registerProjectTools(server);
registerItemTools(server);
registerRepositoryTools(server);

// Add these two (after Phase 5, backend and yml come from the wiring block):
registerScrumReadTools(server, backend, yml);
registerScrumWriteTools(server, backend, yml); // includes deprecated github_graphql
```

### Files to delete

| File                      | Action                                                       |
| ------------------------- | ------------------------------------------------------------ |
| `src/tools/projects.ts`   | Delete entirely                                              |
| `src/tools/items.ts`      | Delete entirely                                              |
| `src/tools/repository.ts` | Gut all tool registrations; delete file if no helpers remain |

### Schemas cleanup — `src/schemas/inputs.ts`

**Remove:** `GetSprintStatusSchema`, `GetVelocitySchema` (old version), `GetBacklogItemsSchema`, `BulkUpdateItemFieldSchema`, `CloseSprintSchema`, `GenerateSprintReportSchema`.

**Keep temporarily:** `GetIssueNodeIdSchema`, `GetUserNodeIdSchema`, `GraphQLQuerySchema`, `GetRepoFileSchema` — these may still be used by write tool internals or the deprecated `github_graphql` tool. Delete once confirmed unused.

### Types cleanup — `src/types.ts`

After Phase 5 moves types to `src/domain/`:

**Delete from `types.ts`:**

- `BoardConfig`, `GhFieldBase`, `GhSingleSelectField`, `GhSingleSelectOption`, `GhIterationField`, `GhIterationConfig`, `GhField`, `GhProjectResponse` — sync-script types, sync script is retired
- `MergedScrumConfig`, `ResolvedScrumFields` — replaced by `RuntimeConfig` in adapter
- `SprintIteration` — replaced by `IterationEntry` used internally in adapter
- `SprintStatusResult`, `BulkUpdateResult`, `IterationVelocity` — implementation details that leaked into shared types

**Keep until confirmed migrated:**

- `Story`, `StoryRef`, `SprintRef`, `ScrumField`, `StoryType` → move to `src/domain/story.ts`
- `IterationEntry`, `DefinitionCriteria` → move to `src/domain/sprint.ts`
- `ScrumConfigYml`, `ArtifactType` → move to `src/domain/config.ts`
- `SprintHistoryResponse`, `SprintSnapshot`, `SprintStory`, `SprintSummary` → inline in `scrum/get-history.ts` (only one consumer)
- `GetBacklogResult` → inline in `scrum/get-backlog.ts`
- `BurndownResponse`, `BurndownSprintMeta`, `BurndownDayPoint`, `IdealDayPoint`, `BurndownStory` → inline in `scrum/get-burndown.ts`
- `TemplateResponse` → inline in `scrum/get-template.ts`
- `StoryReadiness` → replace with `type ReadinessLevel = "ready" | "partially_ready" | "not_ready"` in `domain/rules/readiness.ts`

### `github_graphql` deprecation marker

Ensure the tool description reads:

> **DEPRECATED.** Preserved for ad-hoc diagnostic GraphQL lookups only. Will be removed in a future version. Prefer the `scrum_*` tools for all agent workflows. Mutations are blocked.

---

## 11. Phase 5 — Backend Abstraction Layer

**Recommended timing:** Before Phase 3. Implementing write tools against the `ProjectBackend` interface from the start avoids a second round of refactoring.

Phase 5 uses the Strangler Fig pattern: each step leaves the server in a working state. No half-finished migrations. Each step is independently type-checkable and committable.

### Step 5.1 — Fix quality issues (pre-condition)

Fix all four issues from §5 before structural work begins. These are small, safe commits that tighten the codebase.

- 5a: Fix `scrum_get_backlog` tool description readiness key names
- 5b: Delete `_classifyReadiness`
- 5c: Consolidate `findStatusDisplayName` / `findDoneStatusName`
- 5d: Extract `loadRuntimeConfig()` bootstrap helper

Verify: `deno check src/index.ts` passes. No behaviour change.

### Step 5.2 — Extract pure domain rules

Create `src/domain/rules/`. Move three pure functions — no behaviour change, only file moves.

```
src/domain/rules/labels.ts              ← classifyLabels()           from scrum-read.ts
src/domain/rules/acceptance-criteria.ts ← parseAcceptanceCriteria()  from scrum-read.ts
src/domain/rules/readiness.ts           ← computeStoryReadiness()    from services/readiness.ts
                                           (delete StoryReadiness interface; use ReadinessLevel)
```

The moved functions have no imports outside the standard library. Add re-exports from `scrum-read.ts` temporarily so existing tests pass without modification.

Verify: `deno check src/index.ts` passes. All tests pass.

### Step 5.3 — Extract sprint-math helpers

Create `src/scrum/sprint-math.ts`. Move six pure computation functions from `scrum-read.ts`:

```typescript
export { groupStoriesByStatus } from "./sprint-math.ts";
export { computeSprintTotals } from "./sprint-math.ts";
export { buildSprintMeta } from "./sprint-math.ts";
export { buildSprintWindow } from "./sprint-math.ts";
export { buildIdealLine } from "./sprint-math.ts";
export { buildDaySeries } from "./sprint-math.ts";
```

These functions depend only on domain types and `RuntimeConfig` fields. After Phase 5 completes, they will depend only on domain types and the `SprintInfo` shape from `ports.ts`.

Verify: `deno check src/index.ts` passes. All tests pass.

### Step 5.4 — Extract GitHub raw types and queries

Create:

- `src/adapters/github/raw-types.ts` — all `interface Raw*` and `interface Get*Response` types currently in `scrum-read.ts`
- `src/adapters/github/queries.ts` — all `const GET_*_QUERY` GraphQL strings

These are pure declarations. No logic moves. Import them back into `scrum-read.ts` while the refactor is in progress.

Verify: `deno check src/index.ts` passes.

### Step 5.5 — Extract mappers

Create `src/adapters/github/mappers.ts`. Move:

```typescript
export { extractBoardFields };
export { buildStoryFromRaw };
export { buildEnrichedStory };
export { buildCommentList };
export { buildLinkedPrList };
export { buildBurndownStoryInput };
```

These are pure functions that take GitHub raw types and return domain types. They stay exported for tests. Update import sites in `scrum-read.ts`.

Verify: `deno check src/index.ts` passes. All tests pass.

### Step 5.6 — Define the port and write `GitHubProjectBackend`

This is the structural inflection point. After this step, the boundary physically exists.

1. Create `src/scrum/ports.ts` with the full `ProjectBackend` interface from §7.
2. Create `src/adapters/github/config-loader.ts` — move `loadConfig`, `RuntimeConfig`, `getBootstrapConfig`, `getRepo` from their current locations.
3. Create `src/adapters/github/backend.ts` — implement `GitHubProjectBackend` with all read methods. The write methods (`createStory`, `updateStory`, `setField`, `addComment`, `addVocabulary`) can be stubs that throw `"not yet implemented"` until Phase 3.

`GitHubProjectBackend` constructor:

```typescript
export class GitHubProjectBackend implements ProjectBackend {
  constructor(
    private readonly config: RuntimeConfig, // from config-loader
    private readonly gh: { graphql: typeof graphql; rest: typeof rest },
    private readonly owner: string,
    private readonly ownerType: "user" | "org",
    private readonly repo: string,
  ) {}

  // All read methods pull from this.config and call this.gh.graphql / this.gh.rest
  // resolveSprint and resolveStory become private methods on this class
}
```

Update `index.ts` to construct `GitHubProjectBackend` and pass it to `registerScrumReadTools` and `registerScrumWriteTools`.

Verify: server starts. All 7 read tools respond correctly. Write stubs return "not yet implemented".

### Step 5.7 — Extract use cases, one per file

For each of the 7 read tools, extract the handler body into a standalone use-case function. The function receives `backend: ProjectBackend` and `yml: ScrumConfigYml` rather than constructing them internally.

Suggested order (simplest to most complex):

1. `scrum/get-template.ts` — `getTemplateUseCase(backend, yml, params)` — one file fetch, no computation
2. `scrum/orient.ts` — `orientUseCase(backend, yml)` — one backend call + gap computation
3. `scrum/get-story.ts` — `getStoryUseCase(backend, params)` — one backend call + AC parsing
4. `scrum/get-sprint.ts` — `getSprintUseCase(backend, yml, params)` — backend call + sprint-math
5. `scrum/get-backlog.ts` — `getBacklogUseCase(backend, yml, params)` — backend call + filters + readiness
6. `scrum/get-history.ts` — `getHistoryUseCase(backend, yml, params)` — backend call + summary computation
7. `scrum/get-burndown.ts` — `getBurndownUseCase(backend, yml, params)` — backend call + series computation

For each use case:

- The function takes typed params matching the Zod schema output (not the raw MCP params).
- It calls `backend.*` methods for all I/O.
- It calls domain-rule functions (`classifyLabels`, `parseAcceptanceCriteria`, etc.) for pure computation.
- It calls sprint-math functions from `scrum/sprint-math.ts` for aggregation.
- It returns a typed result object (not JSON string — the handler stringifies).
- It throws on error — the handler catches.

After each use case is extracted, update the corresponding handler in `scrum-read.ts` to delegate to it. Verify after each one.

### Step 5.8 — Verify and stabilise

After all 7 use cases are extracted:

- `scrum-read.ts` contains only `registerScrumReadTools(server, backend, yml)` and 7 thin handlers matching the target shape in §6.
- No handler imports `graphql`, `rest`, `loadConfig`, `resolveSprint`, or any GitHub raw type.
- `src/adapters/github/backend.ts` imports no MCP SDK types.
- `src/scrum/*.ts` imports no adapter types.
- `deno check src/index.ts` passes clean.
- Run all tests. Write at least one new unit test per use case that stubs `ProjectBackend` with a fake implementation.

---

## 12. Recommended Execution Order

Phases are not strictly sequential — Phase 5 should precede Phase 3 to avoid building write tools on the old architecture. The recommended order:

```
Fix quality issues (§5)
       ↓
Phase 5 — Backend abstraction (steps 5.1 – 5.8)
       ↓
Phase 3 — Write tool implementations (on top of ProjectBackend)
       ↓
Phase 4 — Cutover, delete legacy, cleanup types
```

Within Phase 5, steps 5.2–5.5 can be done as a batch (they are pure file moves). Step 5.6 is the critical structural step and should be its own commit. Steps 5.7 and 5.8 can proceed one use case at a time.

---

## 13. Design Decisions

All decisions below are resolved. Do not re-open without explicit sign-off from the project owner.

| Topic                                  | Decision                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Epic field**                         | Maps to GitHub `Milestone` type. `epic` field in `Story` is the Milestone title. `scrum_update_story` creates the Milestone if the provided title is not found.                                                                |
| **Assignee writes**                    | Use `updateIssue` mutation only — not a separate project field. Setting `null` → empty array to clear all assignees.                                                                                                           |
| **Sprint "next" resolution**           | "Next" = the scheduled iteration immediately after the active one, by iteration order in the GitHub Projects API response. The server reports what exists; the agent informs the user if no next sprint is scheduled.          |
| **Sync script**                        | Retired. All information is retrievable via GraphQL API or the pre-fetched schema. `BoardConfig` and sync-script types are removed in Phase 4.                                                                                 |
| **`github_graphql` tool**              | Kept, deprecated. Registered in `scrum-write.ts`. Mutations blocked at the tool level (reject any query string containing the word "mutation").                                                                                |
| **Config file location**               | `.github/scrum/config.yml` in the repo — fetched via GitHub API at invocation time.                                                                                                                                            |
| **Caching**                            | No server-side config cache in v1. Each tool invocation calls `loadConfig`. A short-lived in-process TTL cache (≤ 60 s) may be added if latency becomes a problem.                                                             |
| **Stateless server**                   | All tool handlers call `loadConfig` at invocation time. No shared mutable state in the server process.                                                                                                                         |
| **Org-owned projects**                 | Not supported in v1. `getBootstrapConfig` rejects `GITHUB_OWNER_TYPE=org` with a clear error message. Org support tracked as a future extension — the `ownerType` parameter is already plumbed through for when this is added. |
| **`scrum_post_note` tool**             | Removed from the tool surface. Ceremony records belong in the team's ceremony backend, not as story comments. `scrum_log_impediment` uses `addComment` as a shared internal primitive directly.                                |
| **Backend decoupling mode**            | Source-level (single Deno process). `ProjectBackend` is an interface enforced by TypeScript, not a network boundary. `index.ts` is the only file that knows which concrete implementation is wired.                            |
| **Backend config format**              | Per-adapter configuration lives in adapter-specific env vars (e.g., `GITHUB_TOKEN`, `GITHUB_PROJECT_NUMBER`). The `config.yml` carries Scrum-vocabulary config only; no backend-specific fields appear there.                  |
| **`StoryReadiness` interface**         | To be replaced with `type ReadinessLevel = "ready" \| "partially_ready" \| "not_ready"` in Phase 5 (the three-boolean struct is an awkward encoding of a three-state enum).                                                    |
| **`scrum_get_backlog` readiness keys** | Wire format uses `ready`, `partially_ready`, `not_ready`. The tool description currently says `sprint_ready`, `in_refinement`, `future_candidate` — this is a bug to fix in step 5.1.                                          |

---

## 14. Open Questions

| Question                                                                                                                                      | Status                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Does `projects_v2_item.field_value_updated` exist in the GitHub Enterprise Cloud Audit Log?                                                   | Unverified against live schema — inferred from GitHub changelog. Verify before claiming audit-log path works on GHEC.              |
| Should `scrum_get_burndown` skip non-working days in the series?                                                                              | Deferred. v1 includes all calendar days.                                                                                           |
| Should the burndown ideal line use team capacity (from `velocity_window`) rather than a straight line?                                        | Deferred. Straight line is the Scrum standard. Capacity-adjusted ideal is a v2 option.                                             |
| Should `scrum_get_history` support iteration by date range rather than just count?                                                            | Deferred. `window` (count) is sufficient for v1.                                                                                   |
| When an org-backend is added, should `resolveSprint` / `resolveStory` be promoted to the `ProjectBackend` interface or stay adapter-internal? | Deferred. Current design: adapter-internal. Revisit if a second backend needs to expose iteration or story resolution differently. |
