# Adapter Layer Refactoring Strategy

## Background & Motivation

The GitHub adapter currently treats “fetch data from GitHub” as a monolithic operation, collapsing three responsibilities—what to request, how to fetch it, and how to normalize results—into a single code path. This tight coupling makes any change in requirements ripple through query construction, pagination, and mapping logic.

## Core Problem

The adapter’s `PaginatedProjectItemFetcher` embeds query building inside pagination infrastructure, preventing reuse of fragments and causing over‑fetching. Changes to fields or filters force modifications across the entire fetch‑process, violating the assembly‑layer principle.

## Objectives

1. **Make the adapter a pure assembly layer** – its sole job is to compose the correct GraphQL fragments for a given port call, without embedding query logic, filter logic, or mapping logic.
2. **Introduce declarative components**: a Fragment Library, a Query Assembler, and an Execution Engine + Result Normalizer that together handle fragment selection, request assembly, execution, and domain‑type normalization while preserving all `custom_fields`.
3. **Enable future extensibility** – new use‑case needs, new execution paths (e.g., GitHub Search API), or new backends can be added by extending these layers without touching existing code.

## Target Architecture (high‑level)

| Layer                             | Responsibility                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fragment Library**              | Reusable GraphQL field selections; no query logic.                                                                                                |
| **Query Assembler**               | Takes a typed filter, decides the appropriate GitHub API surface and selects/composes fragments to eliminate over‑fetching.                       |
| **Execution Engine + Normalizer** | Executes assembled requests, handles pagination/cursors, rate limits, and maps raw responses to `BacklogItemListing[]` with full `custom_fields`. |

## Implementation Scope

This refactoring touches only the files listed in Phase 0 (config‑loader.ts, backend.ts, FieldValueMutator, mappers.ts, operations.graphql). It does not modify port interfaces, use‑case functions, tool handlers, Zod schemas, or domain types.

---

## Completed Work

### ContentLocation Portability Refactoring (shipped)

The config loading, template resolution, and file reading pipeline has been unified around a [`ContentLocation`](src/domain/content-location.ts) discriminated union (`kind: "file" | "url" | "inline"`). This replaced raw `string` path parameters throughout the system:

- [`resolveLocation()`](src/scrum/resolve-location.ts) — converts raw strings from CLI args or config YAML into typed `ContentLocation` values
- [`fetchContent()`](src/scrum/fetch-location.ts) — dispatches on `ContentLocation.kind` to fetch content (local file, remote URL, or inline data)
- [`FileReaderPort.fetchContent()`](src/scrum/ports.ts) — port method signature updated from `fetchRepoFile(path: string)` to `fetchContent(location: ContentLocation)`
- [`GitHubFileReader`](src/adapters/github/internal/file-reader.ts) — intercepts `github.com` blob URLs, validates owner/repo match, fetches via `raw.githubusercontent.com` with auth; delegates all other locations to the use-case `fetchContent()`
- `contents.ts` deleted — its sole consumer (`file-reader.ts`) was rewritten
- `--root` / `-r` CLI flag removed — replaced by `projRoot` in the config YAML (relative to the config file's directory)
- Template paths in `type_mapping` now accept full `https://` URLs in addition to local paths

### Port Interface Decomposition (shipped)

The [`ProjectBackend`](src/scrum/ports.ts) interface is composed of focused sub-interfaces:

| Sub-interface                           | Responsibility                      |
| --------------------------------------- | ----------------------------------- |
| [`StoryPort`](src/scrum/ports.ts)       | Single-story detail fetch           |
| [`FindItemsPort`](src/scrum/ports.ts)   | Unified item search across all PBIs |
| [`AnalyticsPort`](src/scrum/ports.ts)   | Burndown + velocity history         |
| [`BoardHealthPort`](src/scrum/ports.ts) | Aggregated board metrics            |
| [`ImpedimentPort`](src/scrum/ports.ts)  | Impediment CRUD                     |
| [`FileReaderPort`](src/scrum/ports.ts)  | Template/config content fetch       |

New use-case code imports specific ports rather than the monolithic [`ProjectBackend`](src/scrum/ports.ts).

### Fragment Library Foundation (shipped, partial)

The [`operations.graphql`](src/adapters/github/operations.graphql) file defines named GraphQL fragments ([`ProjectCore`](src/adapters/github/operations.graphql:48), [`ItemContent`](src/adapters/github/operations.graphql:89), [`ItemFieldValues`](src/adapters/github/operations.graphql:121)) that are parsed at module init by [`queries.ts`](src/adapters/github/queries.ts) and bundled into operation documents automatically. The operations registered in `queries.ts` use these fragments.

**Gap:** [`buildItemsQuery()`](src/adapters/github/internal/pagination.ts:94) in [`pagination.ts`](src/adapters/github/internal/pagination.ts) still constructs GraphQL strings inline and does not use the fragment registry. Phase 2 addresses this.

### AbstractProjectBackend (shipped)

[`AbstractProjectBackend`](src/adapters/abstract-backend.ts) provides:

- Default throwing implementations for optional methods (`createImpediment`, `updateImpediment`) via [`UnsupportedCapabilityError`](src/adapters/abstract-backend.ts:50)
- A `protected resolveRef()` helper for converting `{ number }` refs to `{ id }` refs
- Declares `abstract readonly capabilities: PlatformCapabilities`

---

## Current Architecture

The following call chain shows how a tool request flows through the adapter today:

```
Tool Handler
  → use-case function (e.g., findItemsUseCase)
    → port method call (backend.findItems(filter))
      → GitHubProjectBackend.findItems(filter)        ← thin facade delegation
        → StoryQueryService.findItems(filter)
          → fetchAllItems()                            ← always a full board scan
            → PaginatedProjectItemFetcher               ← owns query building + pagination
              → buildItemsQuery(ownerType, config)      ← constructs GraphQL in-line (NOT using fragment registry)
              → cursor-paginated GitHub API calls
            → client-side filter chain (scope, keys, search, labels, assignee, …)
          → buildStoryFromRaw() per item               ← raw → Story
          → toItemListing() per story                  ← Story → BacklogItemListing
        → ItemSearchResult
```

The backend facade ([`GitHubProjectBackend`](src/adapters/github/backend.ts)) is a thin delegation layer. The real query logic lives in [`StoryQueryService`](src/adapters/github/internal/story-query-service.ts), but query construction is embedded inside [`PaginatedProjectItemFetcher`](src/adapters/github/internal/pagination.ts), which is supposed to be pagination infrastructure.

---

## Internal Layer Breakdown

The target adapter structure separates into three layers:

### Fragment Library

Atomic, reusable GraphQL field selections with no query logic. Each fragment describes a specific data shape: issue content, project field values, sprint iteration fields, dependency edges, label sets, etc. Fragments are the vocabulary; they do not know how or when they are used.

Fragments are composed into query documents by the assembler. A fragment change (adding a field to the issue content shape) propagates automatically to every query that includes it.

### Query Assembler

Takes a typed request from the port method (e.g., `ResolvedItemFilter`) and produces a complete, executable query document by selecting and composing the right fragments. This is where execution strategy lives.

The assembler has a routing step: given the filter, determine the most appropriate GitHub API surface:

| Filter profile                                                | Execution path                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `keys` present                                                | `node(id)` or `issue(number)` - direct lookup, no scan needed                          |
| `search`, `labels`, `assignee` only - no board fields         | `search(type: ISSUE)` - server-side filtering                                          |
| `status`, `sprint`, `priority`, `type` - board fields present | `projectV2.items()` - project item pagination                                          |
| Mixed (board fields + text/labels)                            | `projectV2.items()` + post-filter - board fields are not searchable via the search API |

The assembler also decides field selection: if `include_dependencies` is false, the `blockedBy` fragment is excluded from the query. If `estimated` is the only filter, only the story points field is needed in `fieldValues`. This is where over-fetching is eliminated without touching any other layer.

### Execution Engine + Result Normalizer

The execution engine takes any assembled query document and handles the HTTP/GraphQL interaction: pagination cursor management, rate limit handling, partial failure recovery. It has no knowledge of what it is fetching - it only knows how to fetch and iterate.

The result normalizer maps any raw response shape to `BacklogItemListing[]`. It is responsible for populating `custom_fields` with **all** field values from the response, not just the canonical four. Non-canonical metadata passes through untouched - the normalizer does not filter it. The agent receives it; the agent decides whether it is meaningful.

**Content Type vs Semantic Item Type:** The normalizer must preserve the distinction between two orthogonal type dimensions that exist in GitHub's data model:

| Dimension              | Source                                  | Values                                        | Meaning                                                                                         |
| ---------------------- | --------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Content Type**       | GraphQL `__typename` on the node        | `Issue`, `PullRequest`, `DraftIssue`          | The underlying GitHub object kind — determines available fields and API                         |
| **Semantic Item Type** | Project board field (or org issue type) | `Bug`, `Feature`, `Spike`, `User Story`, etc. | The Scrum classification — set by the team, stored in a board custom field or `issue.issueType` |

Both must survive normalization. Content type is structural (it determines which fields are populated and which are null; a `DraftIssue` has no `assignees`, a `PullRequest` has no `state` but has `merged`). Semantic item type is business-level metadata surfaced in [`BacklogItemListing.type`](src/domain/types.ts). The normalizer extracts semantic type from the appropriate source (board field or `issue.issueType`, per `typeResolution.source`) and passes content type through as a `custom_fields` entry (`__typename`) so the agent and use-case layer can distinguish structural shapes without hardcoding assumptions about the underlying object kind.

### GitHub Search API Integration

The search API path enables true server-side filtering for issue-native properties. The query shape for this path follows the GitHub search syntax, composing the search string from the filter at assembly time:

```graphql
query SearchIssues($query: String!, $first: Int!, $after: String) {
  search(query: $query, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        id number title body url state
        assignees(first: 5)  { nodes { login } }
        labels(first: 10)    { nodes { name color } }
        milestone            { id title dueOn }
        blockedBy(first: 10) { nodes { id number title } }
        projectItems(first: 5) {
          nodes {
            project { id title }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field { ... on ProjectV2FieldCommon { name } }
                }
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2FieldCommon { name } }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title id duration startDate
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  field { ... on ProjectV2FieldCommon { name } }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

The search string is assembled by the query assembler from the filter inputs:

```
repo:{owner}/{repo} is:issue is:open
  {search terms} in:title,body       ← from filter.search
  label:{name}                        ← one per filter.labels entry (AND semantics)
  assignee:{login}                    ← from filter.assignee
  milestone:{title}                   ← resolved from filter.epic_id
```

**Constraint:** board-level fields (status, sprint iteration, priority, type) are project V2 custom fields and are not indexed by the GitHub search engine. Any filter that includes these dimensions must use the `projectV2.items()` path. The assembler enforces this routing rule - the use-case does not need to know.

**Constraint:** Draft Issues are not GitHub Issues and do not appear in search results. The search path returns only issues. If the filter scope must include draft items, the assembler falls back to the project items path.

### Capability Error Surfacing (aspirational)

> **Note:** The [`CapabilityMap`](src/scrum/ports.ts) return type and use-case-layer `CapabilityError` catching described here are aspirational — they do not exist in the current codebase. Currently, [`PlatformCapabilities`](src/adapters/capabilities.ts) uses boolean flags and is consumed only by the composition root for gating optional behavior (template registration, etc.). Adapters throw [`UnsupportedCapabilityError`](src/adapters/abstract-backend.ts:50) for unimplemented optional methods.

The target design: `AbstractProjectBackend.getCapabilities()` returns a `CapabilityMap` declaring which operations are available for a given backend configuration. When a port method is called that the backend has declared unsupported, it throws a `CapabilityError` rather than returning empty data or silently failing.

Use-case functions catch `CapabilityError` and surface it as a string entry in `UseCaseResult.warnings[]`. The tool handler includes these warnings in the tool response. The agent receives a factual statement of what was possible and what was not - no silent degradation.

---

## Phased Refactoring

### Phase 0 - Org project support (GitHub Issue Types)

> **Prerequisite for Phases 1–4.** This phase touches only `config-loader.ts`, `backend.ts`, `FieldValueMutator`, `mappers.ts`, and `operations.graphql`. It is self-contained and can ship independently.
>
> **Status: NOT STARTED.** The [`config-loader.ts`](src/adapters/github/config-loader.ts) still throws a hard error on missing `typeFieldId` (line 234–242). There is no `typeResolution` field, no `GetOrgIssueTypesBootstrap` query, and no `SetIssueType` mutation.

GitHub introduced org-level **Issue Types** and **Issue Fields** as organization-scoped entities. For org-owned projects these replace the project board's single-select type field - the item type lives directly on the issue (`issue.issueType`) and is set via a dedicated mutation, not via `updateProjectV2ItemFieldValue`.

**Confirmed behaviour from live probe against TeamSTEP / Project Meltdown (#6):**

- `projectV2.fields` contains no single-select type field. There is no `PVTSSF_*` node for item type.
- `organization.issueTypes` returns the canonical type vocabulary (`User Story`, `Bug`, `Spike`, `Tech Debt`, `Impediment`) with stable `IT_kw…` IDs.
- On individual issues, `issue.issueType { id name }` is set (or null) at the issue level - not inside `fieldValues`.
- `Story Points` (NUMBER) and `Status` (SINGLE_SELECT) still appear as normal project board fields and resolve exactly as today. No change needed for those fields.
- `org.issueFields` returns field schemas (IssueFieldSingleSelect, IssueFieldDate × 2, IssueFieldNumber) that are mirrored onto the board as regular board fields. The board copy is the canonical source; the org endpoint is schema-only and does not need to be queried by the adapter.
- `Priority` exists as a board SINGLE_SELECT field but with `options: []` on this project. That is a separate gap, addressed by `scrum_add_vocabulary` - not in scope here.

**Changes required:**

1. **`operations.graphql`** - Add `GetOrgIssueTypesBootstrap` query:

   ```graphql
   query GetOrgIssueTypesBootstrap($login: String!) {
     organization(login: $login) {
       issueTypes(first: 50) {
         nodes {
           id
           name
           isEnabled
         }
       }
     }
   }
   ```

   Add `SetIssueType` mutation:

   ```graphql
   mutation SetIssueType($issueId: ID!, $issueTypeId: ID!) {
     updateIssue(input: { id: $issueId, issueTypeId: $issueTypeId }) {
       issue { id }
     }
   }
   ```

   Add `issueType { id name }` to the issue content fragment so it is populated for every item fetch and listing query.
   > **Why this matters:** Adding `issueType { id name }` to the fragment is the single change that enables seamless transition between content type and semantic type in later phases. Once this field is present on every fetched item, the normalizer (Phase 3) can read it to populate `BacklogItemListing.type` for org-owned projects without any further query changes. The underlying `__typename` (content type: `Issue`, `PullRequest`, `DraftIssue`) and the org-level `issueType.name` (semantic type: `Bug`, `Feature`, `Spike`) travel side-by-side in the raw response, giving the normalizer both dimensions to work with.

2. **`config-loader.ts`** - Remove the hard throw on missing `typeFieldId`. Replace with a `typeResolution` field on `RuntimeConfig`:

   ```typescript
   typeResolution: {
     source: "board_field" | "org_issue_type";
     fieldId: string | null; // non-null only when source === "board_field"
   }
   ```

   Resolution logic in `loadConfig()`:

   ```
   if fields.typeFieldId is non-null  → source: "board_field"   (existing path, no change)
   else if ownerType === "org"        → source: "org_issue_type" (fire GetOrgIssueTypesBootstrap,
                                                                    build typeOptions from issueType IDs)
   else                               → throw  (user project with item_type declared but field
                                                  not found - existing config error, unchanged)
   ```

   When `source === "org_issue_type"`, `typeOptions` is populated by matching `type_mapping[key].display` against `issueType.name` and storing the `issueType.id` as the value. The map shape (`Record<canonicalKey, id>`) is identical to the board-field path.

3. **`backend.ts` (`getPlatformState`)** - Update `type.exists` and `type.configured` checks:

   ```typescript
   type: {
     exists: this.deps.config.typeResolution !== null,
     configured: Object.keys(this.deps.config.typeOptions).length > 0,
   }
   ```

4. **`FieldValueMutator`** - Branch on `typeResolution.source` for type field writes:

   ```typescript
   if (field === "type" && config.typeResolution.source === "org_issue_type") {
     return gh.graphql(SET_ISSUE_TYPE_MUTATION, { issueId, issueTypeId: value });
   }
   // existing updateProjectV2ItemFieldValue path for all other fields
   ```

5. **`mappers.ts` (`extractBoardFields`)** - Branch on `typeResolution.source` when extracting item type:

   ```typescript
   const typeValue = config.typeResolution.source === "board_field"
     ? extractFieldValue(fieldValues, config.typeResolution.fieldId)
     : raw.issueType?.name ?? null;
   ```

**Files touched:** `operations.graphql`, `queries.ts`, `config-loader.ts`, `backend.ts`, `field-value-mutator.ts`, `mappers.ts`.

**Files not touched:** Port interfaces, use-case functions, tool handlers, Zod schemas, domain types.

**Outcome:** Org-owned projects with issue types boot and operate correctly. The `typeResolution.source` field acts as a seam that Phase 3's assembler absorbs cleanly - `assembleFieldWrite()` will replace the mutator branch, and `normalizeItemList()` will replace the mapper branch, with no further changes to `RuntimeConfig`.

---

### Phase 1 - Separate query building from pagination infrastructure

> **Status: NOT STARTED.** [`buildItemsQuery()`](src/adapters/github/internal/pagination.ts:94) is still embedded inside [`PaginatedProjectItemFetcher`](src/adapters/github/internal/pagination.ts:227).

Extract `buildItemsQuery()` from `PaginatedProjectItemFetcher` into a standalone `ProjectItemsQueryBuilder`. The fetcher becomes pure pagination infrastructure: it accepts a pre-built query document and handles cursor iteration. No behavior change; this is a responsibility reallocation that makes the next phases possible.

**Outcome:** The fetcher no longer knows what it is fetching. The query assembler concept exists as an explicit, injectable component.

### Phase 2 - Complete fragment library migration

> **Status: PARTIALLY COMPLETE.** [`operations.graphql`](src/adapters/github/operations.graphql) defines `ProjectCore`, `ItemContent`, and `ItemFieldValues` fragments. [`queries.ts`](src/adapters/github/queries.ts) auto-parses and bundles them for registered operations. However, [`buildItemsQuery()`](src/adapters/github/internal/pagination.ts:94) in `pagination.ts` constructs GraphQL inline and does not use the fragment registry.
>
> **Clarification:** Fragments are already defined and actively used by several registered operations ([`GetOrgProjectItems`](src/adapters/github/operations.graphql), [`GetProjectItems`](src/adapters/github/operations.graphql), [`GetStory`](src/adapters/github/operations.graphql)), but the main item-fetching path ([`PaginatedProjectItemFetcher`](src/adapters/github/internal/pagination.ts:227)) bypasses both the fragment registry and the registered operations entirely — it constructs raw GraphQL strings inline in [`buildItemsQuery()`](src/adapters/github/internal/pagination.ts:94). Migrating the fetcher to compose queries from the fragment registry is therefore the primary goal of this phase: it unifies all query construction under one mechanism, eliminates the duplicate inline field definitions, and ensures that a change to a fragment automatically propagates to the listing path.

The remaining work:

1. **Migrate `buildItemsQuery()` to use the fragment registry.** Instead of constructing inline `... on Issue { id number title ... }` strings, it should reference `ItemContent` and `ItemFieldValues` from the parsed fragment library. This makes the paginated fetcher's query consistent with the named operations in `operations.graphql`.

2. **Add `issueType { id name }` to `ItemContent` fragment** (once Phase 0 is complete) so it propagates to all listing and detail queries.

3. **Implement `custom_fields` passthrough** by extending the `ItemFieldValues` fragment (or normalizer) to include all field types without filtering. Non-canonical field values pass through to `BacklogItemListing.custom_fields` rather than being dropped.

**Outcome:** A field addition (e.g., adding `createdAt` to every listing) is a one-line fragment change. Every query path that uses the fragment registry picks it up automatically.

### Phase 3 - Query assembler + strategy router

> **Status: NOT STARTED.**

Introduce `FilterStrategyRouter` as the explicit routing decision point inside `findItems`. Introduce assembler classes (one per execution path) that take a `ResolvedItemFilter` and emit a query document + variables. Wire these into `GitHubProjectBackend.findItems()` replacing the direct `StoryQueryService` delegation.

The `typeResolution.source` field introduced in Phase 0 migrates into the assembler at this point: `assembleFieldWrite()` reads it to select the correct mutation, and `normalizeItemList()` reads it to select the correct type extraction path. The branches in `FieldValueMutator` and `mappers.ts` added in Phase 0 are removed and replaced by the assembler implementations.

**Outcome:** The adapter facade becomes the assembly coordinator. Adding a new execution path is adding a new assembler class and a routing rule - no changes to existing assemblers, services, or the port interface.

### Phase 4 - Search API integration

> **Status: NOT STARTED.** No search-related code exists in the adapter.

Implement `SearchQueryBuilder` using the query shape above. Implement `SearchResultNormalizer` to map the inverted response shape (issue with nested `projectItems`) into `BacklogItemListing[]`. Wire into the strategy router as the `SEARCH_API` path.

**Outcome:** Text search, label filter, and assignee filter no longer require a full board scan. The use-case and tool handler are unchanged.

---

## What Does Not Change

- [`ProjectBackend`](src/scrum/ports.ts) interface and all port sub-interfaces
- Use-case functions (`findItemsUseCase`, `getStoryUseCase`, etc.)
- Tool handlers and Zod schemas
- Domain types (`BacklogItemListing`, `ItemSearchResult`, `Story`, etc.)
- [`PlatformCapabilities`](src/adapters/capabilities.ts) structure (boolean flags remain; tri-state migration is deferred)
- Agent-facing tool descriptions

---

## Multi-Backend Abstract Design

> **Note:** This entire section is aspirational. None of the types or classes described below exist in the current codebase. It describes the target state after all phases (0–4) are complete and a second backend adapter has been implemented.

This section extends the assembly-layer pattern to cover any backend, not just GitHub. The goal is a single abstract contract that makes adding a new backend (Notion, Trello, Linear, etc.) a matter of filling in assembly methods - not redesigning the data flow.

---

### Capability Status Taxonomy

The current [`PlatformCapabilities`](src/adapters/capabilities.ts) type uses boolean flags (`canCreateSprints: boolean`). Booleans are insufficient: many operations are possible but require emulation - they work, but with limitations the agent should know about. Replace boolean flags with a three-value enum:

```
NATIVE      - operation maps directly to a platform API call; full fidelity guaranteed
EMULATED    - operation is supported by encoding scrum semantics onto available primitives
               (e.g., item type stored as a special label); some constraints apply
UNAVAILABLE - operation cannot be expressed on this platform at all
```

Every field in `PlatformCapabilities` becomes `CapabilityStatus` instead of `boolean`. The abstract base class derives the `CapabilityMap` it returns from `getCapabilities()` directly from these statuses.

Operations with `EMULATED` status must document their emulation contract - specifically the encoding convention the adapter uses, so that the agent's warning message contains enough context to understand what it is getting (or not getting).

### Platform Vocabulary Map

Each backend implementation defines a `PlatformVocabularyMap` that describes how Scrum domain concepts translate to and from the platform's native primitives. This map is the adapter's internal contract - the use-case layer never sees it.

```
PlatformVocabularyMap
  For each Scrum concept (type, status, sprint, priority, story_points, epic, blocked_by, labels):
    support: CapabilityStatus
    encode(ScrumValue) → PlatformValue     // used when writing: scrum → platform
    decode(PlatformValue) → ScrumValue     // used when reading: platform → scrum
    constraint?: string                    // optional note on limits (e.g., "AND semantics only for label filters")

  isSpecialLabel(platformLabel: string) → boolean
    // Returns true if this label encodes scrum metadata (should not pass through as a user label)
    // e.g., returns true for "[scrum:type:feature]", false for "artwork"

  extractUserLabels(allPlatformLabels: string[]) → string[]
    // Strips special labels, returns only the ones that belong in BacklogItemListing.labels
```

The vocabulary map is constructed once per backend configuration and injected into the assembler. When the normalizer maps a raw platform response into a `BacklogItemListing`, it uses `decode()` for each field and `extractUserLabels()` to separate platform metadata from user-facing labels.

### Abstract Assembler Contract

The assembler is the assembly layer's entry point. Each backend provides one concrete assembler. The abstract class defines what must be implemented - the concrete class only fills in the platform-specific request building and response normalization.

```
AbstractAssembler
  // -- Query assembly (abstract) --
  assembleItemSearch(filter: ResolvedItemFilter) → PlatformRequest[]
  assembleItemFetch(id: string) → PlatformRequest
  assembleItemCreate(draft: ItemDraft) → PlatformRequest[]
  assembleFieldWrite(id: string, field: string, value: FieldValue) → PlatformRequest[]
  assembleSprintFetch(sprintRef: string) → PlatformRequest[]
  assembleAnalyticsFetch(range: AnalyticsRange) → PlatformRequest[]

  // -- Normalization (abstract) --
  normalizeItemList(rawResponses: PlatformResponse[]) → BacklogItemListing[]
  normalizeSingleItem(rawResponse: PlatformResponse) → Story
  normalizeSprintPayload(rawResponses: PlatformResponse[]) → SprintData

  // -- Port method defaults (concrete, provided by abstract class) --
  //    Each port method calls the corresponding assemble* + normalize* pair.
  //    Subclasses do NOT override port methods - only assembly and normalization.
  async findItems(filter: ResolvedItemFilter): Promise<ItemSearchResult>
  async getStory(id: string): Promise<Story>
  async createItem(draft: ItemDraft): Promise<Story>
  async setField(id: string, field: string, value: FieldValue): Promise<void>
  async getSprint(ref: string): Promise<SprintData>
  async getAnalytics(range: AnalyticsRange): Promise<AnalyticsData>
```

`PlatformRequest` is a thin wrapper: `{ method, endpoint, body?, variables? }` - generic enough to represent a GraphQL query, a REST call, or a batch of REST calls. The execution engine (part of each backend's internal infrastructure) handles authentication, rate limiting, and retry - it only knows how to execute `PlatformRequest[]`, not what they mean.

The port method defaults in the abstract class follow this pattern:

```
findItems(filter):
  1. requests = this.assembleItemSearch(filter)
  2. responses = await this.execute(requests)        // execution engine
  3. items = this.normalizeItemList(responses)
  4. return { items, scope_summary, warnings: [] }
```

If any capability required by the operation has status `UNAVAILABLE`, the abstract class throws a `CapabilityUnavailableError` before assembly begins. If the capability is `EMULATED`, it proceeds but appends an emulation notice to `warnings[]`.

### Error Decoration Hierarchy

> **Note:** Only [`AdapterError`](src/domain/errors.ts) and [`UnsupportedCapabilityError`](src/adapters/abstract-backend.ts:50) exist in the current codebase. The error subclasses below are aspirational.

All backend errors extend a common base that carries agent-interpretable metadata alongside the technical message. The agent receives these via `UseCaseResult.warnings[]` (for non-fatal) or as a structured error string in the tool response (for fatal). The agent never sees a raw stack trace.

```
BackendError (base)
  capability: string          // which port operation triggered this (e.g., "findItems")
  platform: string            // backend name (e.g., "trello", "github")
  recoverySuggestion: string  // what the agent should try or tell the user
  platformContext?: object    // raw platform error code/message for debugging

BackendAuthError extends BackendError
  // Token missing, expired, or lacks scope
  // recoverySuggestion: instructs agent to check SCRUM_GITHUB_TOKEN or equivalent env var

CapabilityUnavailableError extends BackendError
  // Operation cannot be expressed on this platform
  // recoverySuggestion: describes what the agent can do instead
  // Example: "Trello does not support burndown data. Use scrum_get_analytics with
  //           scope=sprint instead, and present velocity from completed item counts."

CapabilityEmulationWarning extends BackendError (non-fatal, surfaces in warnings[])
  encodingConvention: string  // how the emulation works, for agent transparency
  // Example: "Item type is stored as a Trello label with prefix [scrum:type:].
  //           Type filter applied client-side after fetch."

PlatformConstraintError extends BackendError
  // Operation succeeded partially or with reduced fidelity
  // Example: "Trello label filters use OR semantics. Multiple label filters were
  //           applied as a post-fetch client-side AND filter."

BackendRateLimitError extends BackendError
  retryAfterMs?: number
  // recoverySuggestion: "Rate limit reached. Retry in X seconds or reduce query scope."
```

The abstract class catches raw HTTP/GraphQL errors from the execution engine and re-throws them as decorated `BackendError` subclasses. Concrete assemblers do not need to handle raw errors - they only produce requests. The execution engine emits raw failures; the abstract class's `execute()` wrapper translates them.

### Trello: Concrete Vocabulary Mapping

Trello has no native Scrum concepts. The adapter maps everything onto Trello's four primitives: cards, lists, labels, and custom fields.

| Scrum Concept   | Trello Primitive       | Status              | Encoding Convention                                                        |
| --------------- | ---------------------- | ------------------- | -------------------------------------------------------------------------- |
| `type`          | Label with prefix      | EMULATED            | `[scrum:type:user_story]`, `[scrum:type:bug]`, etc. One per card; required |
| `status`        | List (column) position | NATIVE              | List name maps to status name; configured in `scrum_config.yaml`           |
| `sprint`        | Dropdown custom field  | NATIVE (with setup) | Field named "Sprint"; created by `scrum_add_vocabulary` if absent          |
| `priority`      | Dropdown custom field  | NATIVE (with setup) | Field named "Priority"; values must match configured priorities            |
| `story_points`  | Number custom field    | NATIVE (with setup) | Field named "Story Points"                                                 |
| `epic`          | Text custom field      | EMULATED            | Field named "Epic"; stores epic card ID as string                          |
| `blocked_by`    | Checklist item         | EMULATED            | Checklist named "Blocked By"; each item is a card short link               |
| `labels` (user) | Non-special labels     | NATIVE              | Any label not matching `[scrum:*]` prefix passes through unchanged         |
| Burndown        | -                      | UNAVAILABLE         | No date-ranged completion data in Trello API                               |
| Comments        | Card comments          | NATIVE              | Direct mapping                                                             |
| Attachments     | Card attachments       | NATIVE              | Direct mapping                                                             |

**Label separation:** `isSpecialLabel(label)` returns true for any label whose name matches `/^\[scrum:[a-z]+:[a-z_]+\]$/`. `extractUserLabels()` strips these and returns the remainder. When writing, the assembler sets exactly one `[scrum:type:X]` label and leaves user labels untouched.

**Status mapping:** The Trello adapter's vocabulary map holds a `listNameToStatus` table populated from `scrum_config.yaml`. `decode(listName)` returns the canonical status string. Lists not in the table are treated as unknown status and passed through in `custom_fields` rather than dropped.

**Sprint/priority/story_points:** These require custom fields to exist on the board. The assembler checks for their presence during initialization. If any are missing, `getCapabilities()` returns `UNAVAILABLE` for those operations and `CapabilityUnavailableError.recoverySuggestion` instructs the agent to call `scrum_add_vocabulary` to create them.

**Dependency tracking:** The checklist emulation is write-capable but has no integrity guarantees - if the linked card is deleted, the checklist item becomes a dead reference. The assembler surfaces this via `CapabilityEmulationWarning` on any call that reads or writes `blocked_by`.

### What a New Backend Must Implement

To add a backend, a developer implements one concrete class and one vocabulary map. Nothing else changes.

**Required:**

1. A concrete `PlatformVocabularyMap` implementation - maps all Scrum concepts to platform primitives, implements `isSpecialLabel()` and `extractUserLabels()`.

2. A concrete `Assembler` extending `AbstractAssembler` - implements all `assemble*` methods (producing `PlatformRequest[]`) and all `normalize*` methods (consuming `PlatformResponse[]` and returning domain types). Uses the vocabulary map for all encode/decode calls.

3. An execution engine - takes `PlatformRequest[]`, handles auth, pagination, and rate limiting for that platform, returns `PlatformResponse[]`. Emits raw platform errors that the abstract class's `execute()` wrapper translates into `BackendError` subclasses.

4. A `getCapabilities()` implementation - returns the `CapabilityMap` reflecting the concrete vocabulary map's support statuses.

**Not required:** Port interface changes, use-case changes, tool handler changes, Zod schema changes, domain type changes. The use-case layer calls `backend.findItems(filter)` and receives `ItemSearchResult` - it has no visibility into whether the backend is GitHub, Trello, or anything else.

3. An execution engine - takes `PlatformRequest[]`, handles auth, pagination, and rate limiting for that platform, returns `PlatformResponse[]`. Emits raw platform errors that the abstract class's `execute()` wrapper translates into
