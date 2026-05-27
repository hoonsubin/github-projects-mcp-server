# Adapter Layer Refactoring Strategy

> **Scope:** GitHub backend internal architecture — no changes to port interfaces, use-case functions, or tool handlers. **Goal:** Make the adapter a pure assembly layer whose only responsibility is composing the right API fragments to satisfy a port contract, so future use-case or framework changes never require internal re-architecture — only re-assembly.

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

1. **What to ask for** — which fields, which item types, which API surface (project items vs. search API)
2. **How to fetch it** — pagination, cursor management, error handling
3. **How to normalize it** — mapping raw shapes to domain types

Because these are entangled, any change in what the use-case needs — a new field in `BacklogItemListing`, a new filter dimension, a different execution path — ripples all the way from the query string up through the mapper. The adapter has to consider _how_ to restructure itself, not just _what_ to produce.

The `custom_fields` field in `BacklogItemListing` exists in the domain type but is sparsely populated. Non-canonical project fields (deadlines, custom scores, non-standard flags) are silently dropped in the mapping layer because the query and mapper are coupled to only the four canonical fields.

---

## Target Architecture

### Design Principles

**The adapter is an assembly layer, not a service layer.**

The GitHub adapter's sole internal responsibility is: given a port method call with a typed input, assemble the right API building blocks and return the result in the right domain shape. It does not contain query logic, filter logic, or mapping logic as fixed implementations — it contains _declarative components_ that are composed on demand.

This means:

- A use-case requirement change (new field, new filter, new return shape) = extend the fragment library and update the assembly rule. Nothing else changes.
- A new execution path (search API, REST fallback) = add a new assembler variant. Existing assemblers are untouched.
- A new backend (Notion, Trello) = implement the same fragment-assembler-normalizer contract for that API. The port and use-case layers see no difference.

### Internal Layer Breakdown

The adapter's internal structure separates into three layers:

**Layer 1 — Fragment Library**

Atomic, reusable GraphQL field selections with no query logic. Each fragment describes a specific data shape: issue content, project field values, sprint iteration fields, dependency edges, label sets, etc. Fragments are the vocabulary; they do not know how or when they are used.

Fragments are composed into query documents by the assembler. A fragment change (adding a field to the issue content shape) propagates automatically to every query that includes it.

**Layer 2 — Query Assembler**

Takes a typed request from the port method (e.g., `ResolvedItemFilter`) and produces a complete, executable query document by selecting and composing the right fragments. This is where execution strategy lives.

The assembler has a routing step: given the filter, determine the most appropriate GitHub API surface:

| Filter profile                                                | Execution path                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `keys` present                                                | `node(id)` or `issue(number)` — direct lookup, no scan needed                          |
| `search`, `labels`, `assignee` only — no board fields         | `search(type: ISSUE)` — server-side filtering                                          |
| `status`, `sprint`, `priority`, `type` — board fields present | `projectV2.items()` — project item pagination                                          |
| Mixed (board fields + text/labels)                            | `projectV2.items()` + post-filter — board fields are not searchable via the search API |

The assembler also decides field selection: if `include_dependencies` is false, the `blockedBy` fragment is excluded from the query. If `estimated` is the only filter, only the story points field is needed in `fieldValues`. This is where over-fetching is eliminated without touching any other layer.

**Layer 3 — Execution Engine + Result Normalizer**

The execution engine takes any assembled query document and handles the HTTP/GraphQL interaction: pagination cursor management, rate limit handling, partial failure recovery. It has no knowledge of what it is fetching — it only knows how to fetch and iterate.

The result normalizer maps any raw response shape to `BacklogItemListing[]`. It is responsible for populating `custom_fields` with **all** field values from the response, not just the canonical four. Non-canonical metadata passes through untouched — the normalizer does not filter it. The agent receives it; the agent decides whether it is meaningful.

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

**Constraint:** board-level fields (status, sprint iteration, priority, type) are project V2 custom fields and are not indexed by the GitHub search engine. Any filter that includes these dimensions must use the `projectV2.items()` path. The assembler enforces this routing rule — the use-case does not need to know.

**Constraint:** Draft Issues are not GitHub Issues and do not appear in search results. The search path returns only issues. If the filter scope must include draft items, the assembler falls back to the project items path.

### CapabilityMap and Error Surfacing

`AbstractProjectBackend.getCapabilities()` returns a `CapabilityMap` declaring which operations are available for a given backend configuration. When a port method is called that the backend has declared unsupported, it throws a `CapabilityError` rather than returning empty data or silently failing.

Use-case functions catch `CapabilityError` and surface it as a string entry in `UseCaseResult.warnings[]`. The tool handler includes these warnings in the tool response. The agent receives a factual statement of what was possible and what was not — no silent degradation.

This means the tool server's responsibility is bounded: it ensures the minimum viable fields and item types exist (or can be created via `scrum_add_vocabulary`), and it reports accurately on everything else. Extensions, non-canonical fields, and platform-specific capabilities are not hidden — they are declared and surfaced transparently.

---

## Phased Refactoring

### Phase 1 — Separate query building from pagination infrastructure

Extract `buildItemsQuery()` from `PaginatedProjectItemFetcher` into a standalone `ProjectItemsQueryBuilder`. The fetcher becomes pure pagination infrastructure: it accepts a pre-built query document and handles cursor iteration. No behavior change; this is a responsibility reallocation that makes the next phases possible.

**Outcome:** The fetcher no longer knows what it is fetching. The query assembler concept exists as an explicit, injectable component.

### Phase 2 — Fragment library extraction

Identify the recurring field selections in `operations.graphql` and `pagination.ts` and extract them into named, composable fragments. Establish the convention: fragments live in a dedicated fragment registry; query documents are assembled from the registry, never hand-written inline.

Update `queries.ts` to serve as the fragment registry surface, not just a string-export module.

**Outcome:** A field addition (e.g., adding `createdAt` to every listing) is a one-line fragment change. The `custom_fields` passthrough is implemented here by extending the `ItemFieldValues` fragment to include all field types without filtering.

### Phase 3 — Query assembler + strategy router

Introduce `FilterStrategyRouter` as the explicit routing decision point inside `findItems`. Introduce assembler classes (one per execution path) that take a `ResolvedItemFilter` and emit a query document + variables. Wire these into `GitHubProjectBackend.findItems()` replacing the direct `StoryQueryService` delegation.

**Outcome:** The adapter facade becomes the assembly coordinator. Adding a new execution path is adding a new assembler class and a routing rule — no changes to existing assemblers, services, or the port interface.

### Phase 4 — Search API integration

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
