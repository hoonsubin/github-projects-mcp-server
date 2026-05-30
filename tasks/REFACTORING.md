# Adapter Layer Refactoring Strategy

> **Scope:** GitHub backend internal architecture - no changes to port interfaces, use-case functions, or tool handlers. **Goal:** Make the adapter a pure assembly layer whose only responsibility is composing the right API fragments to satisfy a port contract, so future use-case or framework changes never require internal re-architecture - only re-assembly.

---

## Current State

### Adapter-to-Use-Case Plugging (High Level)

The current plugging chain looks like this:

```
Tool Handler
  → use-case function (e.g., findItemsUseCase)
    → port method call (backend.findItems(filter))
      → GitHubProjectBackend.findItems(filter)
        → StoryQueryService.findItems(filter)
          → fetchAllItems()                       ← always a full board scan
            → PaginatedProjectItemFetcher          ← owns query building + pagination
              → buildItemsQuery(ownerType, config) ← constructs GraphQL in-line
              → cursor-paginated GitHub API calls
            → client-side filter chain (scope, keys, search, labels, assignee, …)
          → buildStoryFromRaw() per item          ← raw → Story
          → toItemListing() per story             ← Story → BacklogItemListing
        → ItemSearchResult
```

The backend facade (`GitHubProjectBackend`) is a thin delegation layer. The real logic lives in `StoryQueryService`, but the query construction is embedded inside `PaginatedProjectItemFetcher`, which is supposed to be pagination infrastructure.

### The Core Problem

The current model treats "fetch data from GitHub" as a single, monolithic operation: always fetch all project items, always filter client-side, always using the same query shape. This works but collapses three distinct responsibilities into one code path:

1. **What to ask for** - which fields, which item types, which API surface (project items vs. search API)
2. **How to fetch it** - pagination, cursor management, error handling
3. **How to normalize it** - mapping raw shapes to domain types

Because these are entangled, any change in what the use-case needs - a new field in `BacklogItemListing`, a new filter dimension, a different execution path - ripples all the way from the query string up through the mapper. The adapter has to consider _how_ to restructure itself, not just _what_ to produce.

The `custom_fields` field in `BacklogItemListing` exists in the domain type but is sparsely populated. Non-canonical project fields (deadlines, custom scores, non-standard flags) are silently dropped in the mapping layer because the query and mapper are coupled to only the four canonical fields.

---

## Target Architecture

### Design Principles

**The adapter is an assembly layer, not a service layer.**

The GitHub adapter's sole internal responsibility is: given a port method call with a typed input, assemble the right API building blocks and return the result in the right domain shape. It does not contain query logic, filter logic, or mapping logic as fixed implementations - it contains _declarative components_ that are composed on demand.

This means:

- A use-case requirement change (new field, new filter, new return shape) = extend the fragment library and update the assembly rule. Nothing else changes.
- A new execution path (search API, REST fallback) = add a new assembler variant. Existing assemblers are untouched.
- A new backend (Notion, Trello) = implement the same fragment-assembler-normalizer contract for that API. The port and use-case layers see no difference.

### Internal Layer Breakdown

The adapter's internal structure separates into three layers:

**Layer 1 - Fragment Library**

Atomic, reusable GraphQL field selections with no query logic. Each fragment describes a specific data shape: issue content, project field values, sprint iteration fields, dependency edges, label sets, etc. Fragments are the vocabulary; they do not know how or when they are used.

Fragments are composed into query documents by the assembler. A fragment change (adding a field to the issue content shape) propagates automatically to every query that includes it.

**Layer 2 - Query Assembler**

Takes a typed request from the port method (e.g., `ResolvedItemFilter`) and produces a complete, executable query document by selecting and composing the right fragments. This is where execution strategy lives.

The assembler has a routing step: given the filter, determine the most appropriate GitHub API surface:

| Filter profile                                                | Execution path                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `keys` present                                                | `node(id)` or `issue(number)` - direct lookup, no scan needed                          |
| `search`, `labels`, `assignee` only - no board fields         | `search(type: ISSUE)` - server-side filtering                                          |
| `status`, `sprint`, `priority`, `type` - board fields present | `projectV2.items()` - project item pagination                                          |
| Mixed (board fields + text/labels)                            | `projectV2.items()` + post-filter - board fields are not searchable via the search API |

The assembler also decides field selection: if `include_dependencies` is false, the `blockedBy` fragment is excluded from the query. If `estimated` is the only filter, only the story points field is needed in `fieldValues`. This is where over-fetching is eliminated without touching any other layer.

**Layer 3 - Execution Engine + Result Normalizer**

The execution engine takes any assembled query document and handles the HTTP/GraphQL interaction: pagination cursor management, rate limit handling, partial failure recovery. It has no knowledge of what it is fetching - it only knows how to fetch and iterate.

The result normalizer maps any raw response shape to `BacklogItemListing[]`. It is responsible for populating `custom_fields` with **all** field values from the response, not just the canonical four. Non-canonical metadata passes through untouched - the normalizer does not filter it. The agent receives it; the agent decides whether it is meaningful.

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

### CapabilityMap and Error Surfacing

`AbstractProjectBackend.getCapabilities()` returns a `CapabilityMap` declaring which operations are available for a given backend configuration. When a port method is called that the backend has declared unsupported, it throws a `CapabilityError` rather than returning empty data or silently failing.

Use-case functions catch `CapabilityError` and surface it as a string entry in `UseCaseResult.warnings[]`. The tool handler includes these warnings in the tool response. The agent receives a factual statement of what was possible and what was not - no silent degradation.

This means the tool server's responsibility is bounded: it ensures the minimum viable fields and item types exist (or can be created via `scrum_add_vocabulary`), and it reports accurately on everything else. Extensions, non-canonical fields, and platform-specific capabilities are not hidden - they are declared and surfaced transparently.

---

## Phased Refactoring

### Phase 0 - Org project support (GitHub Issue Types)

> **Prerequisite for Phases 1–4.** This phase touches only `config-loader.ts`, `backend.ts`, `FieldValueMutator`, and `operations.graphql`. It is self-contained and can ship independently.

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

5. **`StoryQueryService` / normalizer** - Branch on `typeResolution.source` when extracting item type from a raw API response:

   ```typescript
   const typeValue = config.typeResolution.source === "board_field"
     ? extractFieldValue(fieldValues, config.typeResolution.fieldId)
     : raw.issueType?.name ?? null;
   ```

**Files touched:** `operations.graphql`, `queries.ts`, `config-loader.ts`, `backend.ts`, `field-value-mutator.ts`, `story-query-service.ts` (normalizer path only).

**Files not touched:** Port interfaces, use-case functions, tool handlers, Zod schemas, domain types.

**Outcome:** Org-owned projects with issue types boot and operate correctly. The `typeResolution.source` field acts as a seam that Phase 3's assembler absorbs cleanly - `assembleFieldWrite()` will replace the mutator branch, and `normalizeItemList()` will replace the query-service branch, with no further changes to `RuntimeConfig`.

---

### Phase 1 - Separate query building from pagination infrastructure

Extract `buildItemsQuery()` from `PaginatedProjectItemFetcher` into a standalone `ProjectItemsQueryBuilder`. The fetcher becomes pure pagination infrastructure: it accepts a pre-built query document and handles cursor iteration. No behavior change; this is a responsibility reallocation that makes the next phases possible.

**Outcome:** The fetcher no longer knows what it is fetching. The query assembler concept exists as an explicit, injectable component.

### Phase 2 - Fragment library extraction

Identify the recurring field selections in `operations.graphql` and `pagination.ts` and extract them into named, composable fragments. Establish the convention: fragments live in a dedicated fragment registry; query documents are assembled from the registry, never hand-written inline.

Update `queries.ts` to serve as the fragment registry surface, not just a string-export module.

**Outcome:** A field addition (e.g., adding `createdAt` to every listing) is a one-line fragment change. The `custom_fields` passthrough is implemented here by extending the `ItemFieldValues` fragment to include all field types without filtering. The `issueType { id name }` selection added in Phase 0 becomes part of the canonical issue content fragment here.

### Phase 3 - Query assembler + strategy router

Introduce `FilterStrategyRouter` as the explicit routing decision point inside `findItems`. Introduce assembler classes (one per execution path) that take a `ResolvedItemFilter` and emit a query document + variables. Wire these into `GitHubProjectBackend.findItems()` replacing the direct `StoryQueryService` delegation.

The `typeResolution.source` field introduced in Phase 0 migrates into the assembler at this point: `assembleFieldWrite()` reads it to select the correct mutation, and `normalizeItemList()` reads it to select the correct type extraction path. The branches in `FieldValueMutator` and `StoryQueryService` added in Phase 0 are removed and replaced by the assembler implementations.

**Outcome:** The adapter facade becomes the assembly coordinator. Adding a new execution path is adding a new assembler class and a routing rule - no changes to existing assemblers, services, or the port interface.

### Phase 4 - Search API integration

Implement `SearchQueryBuilder` using the query shape above. Implement `SearchResultNormalizer` to map the inverted response shape (issue with nested `projectItems`) into `BacklogItemListing[]`. Wire into the strategy router as the `SEARCH_API` path.

**Outcome:** Text search, label filter, and assignee filter no longer require a full board scan. The use-case and tool handler are unchanged.

---

## What Does Not Change

- `ProjectBackend` interface and all port sub-interfaces
- Use-case functions (`findItemsUseCase`, `getStoryUseCase`, etc.)
- Tool handlers and Zod schemas
- Domain types (`BacklogItemListing`, `ItemSearchResult`, `Story`, etc.)
- `CapabilityMap` structure and `CapabilityError` semantics
- Agent-facing tool descriptions (except the `scope_summary` shape correction)

---

## Multi-Backend Abstract Design

This section extends the assembly-layer pattern to cover any backend, not just GitHub. The goal is a single abstract contract that makes adding a new backend (Notion, Trello, Linear, etc.) a matter of filling in assembly methods - not redesigning the data flow.

---

### Capability Status Taxonomy

The current `PlatformCapabilities` type uses boolean flags (`canCreateSprints: boolean`). Booleans are insufficient: many operations are possible but require emulation - they work, but with limitations the agent should know about. Replace boolean flags with a three-value enum:

```
NATIVE      - operation maps directly to a platform API call; full fidelity guaranteed
EMULATED    - operation is supported by encoding scrum semantics onto available primitives
              (e.g., item type stored as a special label); some constraints apply
UNAVAILABLE - operation cannot be expressed on this platform at all
```

Every field in `PlatformCapabilities` becomes `CapabilityStatus` instead of `boolean`. The abstract base class derives the `CapabilityMap` it returns from `getCapabilities()` directly from these statuses.

Operations with `EMULATED` status must document their emulation contract - specifically the encoding convention the adapter uses, so that the agent's warning message contains enough context to understand what it is getting (or not getting).

---

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

---

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

---

### Error Decoration Hierarchy

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

---

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

---

### What a New Backend Must Implement

To add a backend, a developer implements one concrete class and one vocabulary map. Nothing else changes.

**Required:**

1. A concrete `PlatformVocabularyMap` implementation - maps all Scrum concepts to platform primitives, implements `isSpecialLabel()` and `extractUserLabels()`.

2. A concrete `Assembler` extending `AbstractAssembler` - implements all `assemble*` methods (producing `PlatformRequest[]`) and all `normalize*` methods (consuming `PlatformResponse[]` and returning domain types). Uses the vocabulary map for all encode/decode calls.

3. An execution engine - takes `PlatformRequest[]`, handles auth, pagination, and rate limiting for that platform, returns `PlatformResponse[]`. Emits raw platform errors that the abstract class's `execute()` wrapper translates into `BackendError` subclasses.

4. A `getCapabilities()` implementation - returns the `CapabilityMap` reflecting the concrete vocabulary map's support statuses.

**Not required:** Port interface changes, use-case changes, tool handler changes, Zod schema changes, domain type changes. The use-case layer calls `backend.findItems(filter)` and receives `ItemSearchResult` - it has no visibility into whether the backend is GitHub, Trello, or anything else.
