# Adapter Layer Refactoring Strategy

## Background & Motivation

The GitHub adapter currently treats "fetch data from GitHub" as a monolithic operation, collapsing three responsibilities—what to request, how to fetch it, and how to normalize results—into a single code path. This tight coupling makes any change in requirements ripple through query construction, pagination, and mapping logic.

## Core Problem

The adapter's `PaginatedProjectItemFetcher` embeds query building inside pagination infrastructure, preventing reuse of fragments and causing over‑fetching. Changes to fields or filters force modifications across the entire fetch‑process, violating the assembly‑layer principle.

## Objectives

1. **Make the adapter a pure assembly layer** – its sole job is to compose the correct GraphQL fragments for a given port call, without embedding query logic, filter logic, or mapping logic.
2. **Introduce declarative components**: a Fragment Library, a Query Assembler, and an Execution Engine + Result Normalizer that together handle fragment selection, request assembly, execution, and domain‑type normalization while preserving all `custom_fields`.
3. **Enable future extensibility** – new use‑case needs, new execution paths (e.g., GitHub Search API), or new backends can be added by extending these layers without touching existing code.

## Target Architecture (high‑level)

| Layer                             | Responsibility                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fragment Library**              | Reusable GraphQL field selections; no query logic.                                                                                                |
| **Query Assembler**               | Takes a typed filter, decides the appropriate GitHub API surface and selects/composes fragments to eliminate over‑fetching.                       |
| **Execution Engine + Normalizer** | Executes assembled requests, handles pagination/cursors, rate limits, and maps raw responses to `BacklogItemListing[]` with full `custom_fields`. |

## Implementation Scope

This refactoring touches only the adapter layer. It does not modify port interfaces, use‑case functions, tool handlers, Zod schemas, or domain types.

---

## Completed Work

### ContentLocation Portability Refactoring

The config loading, template resolution, and file reading pipeline has been unified around a [`ContentLocation`](src/domain/content-location.ts) discriminated union (`kind: "file" | "url" | "inline"`). This replaced raw `string` path parameters throughout the system:

- [`resolveLocation()`](src/scrum/resolve-location.ts) — converts raw strings from CLI args or config YAML into typed `ContentLocation` values
- [`fetchContent()`](src/scrum/fetch-location.ts) — dispatches on `ContentLocation.kind` to fetch content (local file, remote URL, or inline data)
- [`FileReaderPort.fetchContent()`](src/scrum/ports.ts) — port method signature updated from `fetchRepoFile(path: string)` to `fetchContent(location: ContentLocation)`
- [`GitHubFileReader`](src/adapters/github/internal/file-reader.ts) — intercepts `github.com` blob URLs, validates owner/repo match, fetches via `raw.githubusercontent.com` with auth; delegates all other locations to the use-case `fetchContent()`
- `contents.ts` deleted — its sole consumer (`file-reader.ts`) was rewritten
- `--root` / `-r` CLI flag removed — replaced by `projRoot` in the config YAML (relative to the config file's directory)
- Template paths in `type_mapping` now accept full `https://` URLs in addition to local paths

### Port Interface Decomposition

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

### Fragment Library Foundation (Phase 2 — complete)

The [`operations.graphql`](src/adapters/github/operations.graphql) file defines named GraphQL fragments ([`ProjectCore`](src/adapters/github/operations.graphql), [`ItemContent`](src/adapters/github/operations.graphql), [`ItemFieldValues`](src/adapters/github/operations.graphql)) that are parsed at module init by [`queries.ts`](src/adapters/github/queries.ts) and bundled into operation documents automatically.

[`ProjectItemsQueryBuilder`](src/adapters/github/internal/project-items-query-builder.ts) constructs the paginated items query by calling `getFragmentSource("ItemContent")` and `getFragmentSource("ItemFieldValues")` from the fragment registry. The inline `buildItemsQuery()` that previously lived inside `PaginatedProjectItemFetcher` has been deleted. A field addition to any fragment in `operations.graphql` now propagates automatically to every query path that uses the registry.

### Query Assembler + Strategy Router (Phase 1 & 3 — complete)

`buildItemsQuery()` has been extracted from `PaginatedProjectItemFetcher` into [`ProjectItemsQueryBuilder`](src/adapters/github/internal/project-items-query-builder.ts). The fetcher is now pure cursor-iteration infrastructure; it accepts a pre-built query document and handles paging.

[`classifyFilter()`](src/adapters/github/internal/filter-strategy-router.ts) classifies any `ResolvedItemFilter` into exactly one `FilterProfile`. [`GitHubProjectBackend.findItems()`](src/adapters/github/backend.ts) dispatches on the profile via a switch to the matching assembler:

| Profile         | Assembler                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `direct_lookup` | [`DirectLookupAssembler`](src/adapters/github/internal/assemblers/direct-lookup-assembler.ts)       |
| `search_api`    | [`SearchApiAssembler`](src/adapters/github/internal/assemblers/search-api-assembler.ts) (shell)     |
| `project_items` | [`ProjectItemsAssembler`](src/adapters/github/internal/assemblers/project-items-assembler.ts)       |
| `mixed`         | [`MixedAssembler`](src/adapters/github/internal/assemblers/mixed-assembler.ts) → delegates to above |

All assemblers currently delegate to `StoryQueryService.findItems()`. Phase 4b replaces this delegation with real `PlatformRequest[]` production and `ExecutionEngine` consumption.

### Execution Engine + Result Normalizer (Phase 4a — complete)

[`ExecutionEngine`](src/adapters/github/internal/execution-engine.ts) is the Humble Object that calls the GitHub GraphQL API for paginated queries. It accepts a `PlatformRequest` (document + variables) and a `PageExtractor<T>` callback that navigates the response shape. It knows nothing about what it fetches — it only handles cursor iteration up to `PaginationPolicy.maxPages`. Returns a `PaginationResult` with raw `nodes[]`.

[`ResultNormalizer`](src/adapters/github/internal/result-normalizer.ts) provides two entry points:

- `normalize(result, filterFn, options)` — full pipeline from `PaginationResult` to `AssemblerOutput`: casts nodes → `buildStoryFromRaw()` → client-side filter → `resolveDependencyRefs()` → `toItemListing()` → `custom_fields` enrichment + `__typename` passthrough. **Not yet wired into assemblers** (Phase 4b).
- `enrichListings(listings, projectItems)` — enrichment only. Currently wired into `StoryQueryService.findItems()` after its own filter chain so that all `findItems()` results carry `custom_fields` (all field values + `__typename`).

### AbstractProjectBackend

[`AbstractProjectBackend`](src/adapters/abstract-backend.ts) provides:

- Default throwing implementations for optional methods (`createImpediment`, `updateImpediment`) via [`UnsupportedCapabilityError`](src/adapters/abstract-backend.ts)
- A `protected resolveRef()` helper for converting `{ number }` refs to `{ id }` refs
- Declares `abstract readonly capabilities: PlatformCapabilities`

---

## Current Architecture

The following call chain shows how a `findItems` request flows through the adapter today (post Phase 3 / Phase 4a):

```
Tool Handler
  → use-case function (findItemsUseCase)
    → port method (backend.findItems(filter))
      → GitHubProjectBackend.findItems(filter)
        → classifyFilter(filter)                ← pure fn, produces FilterProfile
          switch profile.kind:
            "direct_lookup" → DirectLookupAssembler.assemble(profile)
            "search_api"    → SearchApiAssembler.assemble(profile)  ← shell: empty + warning
            "project_items" → ProjectItemsAssembler.assemble(filter)
            "mixed"         → MixedAssembler.assemble(filter)

          (all three non-search paths delegate to:)
            → StoryQueryService.findItems(filter)
              → fetchAllItems()                         ← always a full board scan
                → PaginatedProjectItemFetcher           ← pure cursor iteration
                  → ProjectItemsQueryBuilder.buildQuery() ← fragment registry
                  → cursor-paginated GitHub API calls
              → client-side filter chain (scope, keys, search, labels, assignee, …)
              → buildStoryFromRaw() per item           ← raw → Story
              → toItemListing() per story              ← Story → BacklogItemListing
              → ResultNormalizer.enrichListings()      ← custom_fields + __typename
            → ItemSearchResult
```

**Gap:** Assemblers still delegate to `StoryQueryService` instead of producing `PlatformRequest[]` for `ExecutionEngine`. Phase 4b closes this gap. When Phase 4b is complete, `StoryQueryService.findItems()` will be replaced by the assembler → engine → normalizer pipeline, and `enrichListings()` will no longer be needed as a separate step.

---

## Internal Layer Breakdown

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

Both must survive normalization. Content type is structural. Semantic item type is business-level metadata surfaced in [`BacklogItemListing.type`](src/domain/types.ts). The normalizer extracts semantic type from the appropriate source (board field or `issue.issueType`, per `typeResolution.source`) and passes content type through as a `custom_fields` entry (`__typename`).

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

**Constraint:** board-level fields (status, sprint iteration, priority, type) are project V2 custom fields and are not indexed by the GitHub search engine. Any filter that includes these dimensions must use the `projectV2.items()` path. The assembler enforces this routing rule.

**Constraint:** Draft Issues are not GitHub Issues and do not appear in search results. If the filter scope must include draft items, the assembler falls back to the project items path.

---

## Phased Refactoring

### Phase 0 — Org project support (GitHub Issue Types)

> **Status: NOT STARTED.**
>
> **Self-contained.** Touches only `operations.graphql`, `queries.ts`, `bootstrap.ts`, `backend.ts`, `field-value-mutator.ts`, and `mappers.ts`. Does not modify port interfaces, use-case functions, tool handlers, Zod schemas, or domain types.
>
> **Prerequisite for Phase 4b normalizer.** `normalizeItemList()` reads `typeResolution.source` to decide how to extract semantic type. Adding `typeResolution` to `GitHubBootState` now ensures Phase 4b's normalizer compiles without further changes to the config type.

GitHub org-level **Issue Types** are organization-scoped entities that replace the project board's single-select type field for org-owned projects. The item type lives directly on the issue (`issue.issueType`) and is set via a dedicated mutation, not via `updateProjectV2ItemFieldValue`.

**Confirmed behaviour from live probe (TeamSTEP / Project Meltdown #6):**

- `projectV2.fields` contains no single-select type field for org projects.
- `organization.issueTypes` returns the canonical type vocabulary (`User Story`, `Bug`, `Spike`, `Tech Debt`, `Impediment`) with stable `IT_kw…` IDs.
- `issue.issueType { id name }` is set at the issue level — not inside `fieldValues`.
- `Story Points` (NUMBER) and `Status` (SINGLE_SELECT) still appear as normal project board fields.

**Problem today:** `bootstrap.ts` lines 164–172 unconditionally throw when `typeFieldId` is null (i.e., no matching single-select type field found in the project). This prevents org-owned projects from booting.

#### Implementation Instructions

**Step 1 — `operations.graphql`: add `GetOrgIssueTypesBootstrap` query and `SetIssueType` mutation**

Add these two operations anywhere after the existing queries:

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

mutation SetIssueType($issueId: ID!, $issueTypeId: ID!) {
  updateIssue(input: { id: $issueId, issueTypeId: $issueTypeId }) {
    issue { id }
  }
}
```

Also add `issueType { id name }` to the `ItemContent` fragment so it is populated for every item fetch and listing query. Find the `fragment ItemContent on ProjectV2Item` block in `operations.graphql` and add the field inside the `... on Issue` inline fragment:

```graphql
... on Issue {
  # ... existing fields ...
  issueType { id name }   # add this line
}
```

**Step 2 — `queries.ts`: register the new operations**

`queries.ts` auto-parses `operations.graphql` at module init. Verify that `GET_ORG_ISSUE_TYPES_BOOTSTRAP_QUERY` and `SET_ISSUE_TYPE_MUTATION` are exported as named constants following the existing pattern (e.g., `export const GET_ORG_ISSUE_TYPES_BOOTSTRAP_QUERY = getQuery("GetOrgIssueTypesBootstrap")`). Add them if missing.

**Step 3 — `bootstrap.ts`: replace the hard throw with `typeResolution` branching**

`GitHubBootState` (the shape returned by `loadBootstrapConfig()`) currently has:

```typescript
typeFieldId: string | null;
typeOptions: Record<string, string>;
```

Replace `typeFieldId` with a discriminated `typeResolution` field:

```typescript
typeResolution: {
  source: "board_field" | "org_issue_type";
  fieldId: string | null; // non-null only when source === "board_field"
}
typeOptions: Record<string, string>;
```

> **Why discriminated union, not two optional fields?** A discriminated union makes illegal states unrepresentable: `source === "board_field"` implies `fieldId` is non-null; `source === "org_issue_type"` implies `fieldId` is null. Callers can exhaustively switch on `source` without null checks.

In `loadBootstrapConfig()` (the function that builds `GitHubBootState`), replace the block that throws on missing `typeFieldId` with this logic:

```typescript
// Existing: typeFieldId is resolved from field_mapping.item_type match
// New resolution logic:
let typeResolution: GitHubBootState["typeResolution"];

if (typeFieldId !== null) {
  // Board has a matching single-select type field — existing path, no change needed
  typeResolution = { source: "board_field", fieldId: typeFieldId };
} else if (ownerType === "org") {
  // Org project without a board type field → fetch org issue types
  const response = await gh.graphql<
    {
      organization: {
        issueTypes: { nodes: Array<{ id: string; name: string; isEnabled: boolean }> };
      };
    }
  >(
    GET_ORG_ISSUE_TYPES_BOOTSTRAP_QUERY,
    { login: owner },
  );
  const orgIssueTypes = response.organization.issueTypes.nodes.filter((t) => t.isEnabled);

  // Build typeOptions: canonicalKey → issueType.id
  // Match by comparing type_mapping[key].display against issueType.name (case-insensitive)
  for (const [canonicalKey, mapping] of Object.entries(ghConfig.type_mapping ?? {})) {
    const match = orgIssueTypes.find(
      (t) => t.name.toLowerCase() === (mapping.display ?? canonicalKey).toLowerCase(),
    );
    if (match) {
      typeOptions[canonicalKey] = match.id;
    }
  }

  typeResolution = { source: "org_issue_type", fieldId: null };
} else {
  // User project with item_type declared but field not found — existing config error, unchanged
  throw new Error(
    `Type field '${ghConfig.field_mapping.item_type ?? "(not configured)"}' not found ` +
      `in project #${projectNumber}. Update backends.github.field_mapping.item_type in ` +
      `${configDesc} to match the exact SINGLE_SELECT field name in GitHub Projects.`,
  );
}
```

Then replace `typeFieldId` with `typeResolution` in the returned `GitHubBootState` object.

**Step 4 — `backend.ts` (`getPlatformState`)**: update the `type.exists` and `type.configured` checks to use `typeResolution` instead of `typeFieldId`:

```typescript
type: {
  exists: this.deps.config.live.typeResolution !== null,
  configured: Object.keys(this.deps.config.live.typeOptions).length > 0,
}
```

**Step 5 — `field-value-mutator.ts`**: the mutator currently reads `this.ctx.config.live.fields.typeFieldId` to determine the field ID for type writes. Add a branch on `typeResolution.source`:

```typescript
// In the method that handles field="type" writes:
if (field === "type") {
  const { typeResolution, typeOptions } = this.ctx.config.live;
  const optionId = typeOptions[value];
  if (!optionId) {
    throw new AdapterError(
      `Unknown type value '${value}'. Known types: ${Object.keys(typeOptions).join(", ")}`,
    );
  }
  if (typeResolution.source === "org_issue_type") {
    // Use the SetIssueType mutation on the issue node (not the project item)
    // issueId comes from resolving the project item's content node ID
    const issueId = await this.resolveIssueNodeId(itemId); // existing resolver
    return this.ctx.gh.graphql(SET_ISSUE_TYPE_MUTATION, { issueId, issueTypeId: optionId });
  }
  // source === "board_field": existing updateProjectV2ItemFieldValue path
  return this.ctx.gh.graphql(UPDATE_PROJECT_ITEM_FIELD_MUTATION, {
    projectId: this.ctx.config.live.projectId,
    itemId,
    fieldId: typeResolution.fieldId,
    value: { singleSelectOptionId: optionId },
  });
}
```

> **Note:** If `resolveIssueNodeId` doesn't already exist as a helper, look for how the existing mutator resolves item → content node references (the project item's `content.id` field carries the issue node ID). Reuse that pattern.

**Step 6 — `mappers.ts` (`extractBoardFields` or equivalent)**: the function that extracts `type` from a raw project item currently matches against `fields.typeFieldId`. Add a branch on `typeResolution.source`:

```typescript
// In the type extraction section of buildStoryFromRaw() or extractBoardFields():
const typeValue = config.typeResolution.source === "board_field"
  ? extractFieldValue(item.fieldValues.nodes, config.typeResolution.fieldId!)
  : item.content?.issueType?.name ?? null; // org issue type — read from the content node
```

The `item.content?.issueType?.name` field is only populated after Step 1 adds `issueType { id name }` to the `ItemContent` fragment.

**Files touched:** `operations.graphql`, `queries.ts`, `bootstrap.ts`, `backend.ts`, `field-value-mutator.ts`, `mappers.ts`.

**Files not touched:** Port interfaces, use-case functions, tool handlers, Zod schemas, domain types, assemblers, `ExecutionEngine`, `ResultNormalizer`.

**Outcome:** Org-owned projects with issue types boot and operate correctly. The `typeResolution.source` seam is ready for Phase 4b — the assembler's `normalizeItemList()` will read it to select the correct type extraction path without any further changes to `GitHubBootState`.

---

### Phase 4b — Wire assemblers to ExecutionEngine + ResultNormalizer

> **Status: NOT STARTED.**
>
> **Depends on Phase 0** only for the `typeResolution` field. If Phase 0 has not shipped, apply just the `typeResolution` type addition to `GitHubBootState` as a mechanical prerequisite (the org issue types logic can remain stubbed as `"board_field"` until Phase 0 is complete).
>
> **Goal:** Replace `StoryQueryService.findItems()` delegation in `ProjectItemsAssembler` and `DirectLookupAssembler` with a real `PlatformRequest[]` + `ExecutionEngine.execute()` + `ResultNormalizer.normalize()` pipeline. After this phase, `StoryQueryService` is no longer called from the assembler path; the `StoryQueryService.enrichListings()` wiring becomes redundant and is removed.

#### What exists today

- [`ExecutionEngine`](src/adapters/github/internal/execution-engine.ts) — accepts `PlatformRequest` + `PageExtractor<T>`, returns `PaginationResult`. **Ready to use.**
- [`ResultNormalizer.normalize()`](src/adapters/github/internal/result-normalizer.ts) — accepts `PaginationResult`, a `filterFn: (story: Story) => boolean`, and `options` (dependency builder, all project items). Returns `AssemblerOutput`. **Ready to use.** The dependency builder injectable is `buildDependencyMap` from `story-query-service.ts`.
- [`ProjectItemsQueryBuilder`](src/adapters/github/internal/project-items-query-builder.ts) — `buildQuery()` returns a complete GraphQL document using fragment registry. **Ready to use.**
- [`PaginationResult`](src/adapters/github/internal/execution-engine.ts) interface — `nodes`, `totalCount`, `pagesConsumed`, `truncated`. The `nodes` are raw `unknown[]`; `ResultNormalizer.normalize()` casts them to `ProjectItem[]`.

#### What needs to be built

**1. `ProjectItemsQueryBuilder` → `PlatformRequest` adapter**

`ProjectItemsQueryBuilder.buildQuery()` returns a `string` (the document). Wrap it into a `PlatformRequest` at the call site:

```typescript
const document = this.projectItemsQueryBuilder.buildQuery();
const request: PlatformRequest = {
  document,
  variables: {
    login: config.owner,
    number: config.projectNumber,
    // cursor is added by ExecutionEngine per page
  },
  operationName: "ProjectItems",
};
```

**2. `PageExtractor<T>` for the project items response shape**

`ExecutionEngine.execute<T>()` requires a `PageExtractor<T>` callback. Define one that navigates `ProjectItemsResponse`:

```typescript
import type { ProjectItemsResponse } from "./project-items-query-builder.ts";

const projectItemsExtractor: PageExtractor<ProjectItemsResponse> = (response) => {
  const projectV2 = response.user?.projectV2 ?? response.organization?.projectV2;
  if (!projectV2) throw new GitHubApiError("Project not found");
  const { nodes, pageInfo, totalCount } = projectV2.items;
  return { nodes: nodes ?? [], pageInfo, totalCount };
};
```

Place this function as a module-level constant in `project-items-assembler.ts` or in a shared internal file (e.g., `assemblers/extractors.ts`).

**3. Rewrite `ProjectItemsAssembler`**

The current implementation:

```typescript
async assemble(filter: ResolvedItemFilter): Promise<AssemblerOutput> {
  const result = await this.storyQueryService.findItems(filter);
  // … maps ItemSearchResult → AssemblerOutput
}
```

Replace with:

```typescript
export class ProjectItemsAssembler {
  constructor(
    private readonly engine: ExecutionEngine,
    private readonly normalizer: ResultNormalizer,
    private readonly queryBuilder: ProjectItemsQueryBuilder,
    private readonly config: GitHubBootState, // for owner/projectNumber variables
    private readonly filterBuilder: ItemFilterChain, // see below
  ) {}

  async assemble(filter: ResolvedItemFilter): Promise<AssemblerOutput> {
    const document = this.queryBuilder.buildQuery();
    const request: PlatformRequest = {
      document,
      variables: { login: this.config.owner, number: this.config.projectNumber },
    };

    const result = await this.engine.execute<ProjectItemsResponse>(
      request,
      projectItemsExtractor,
    );

    // Build a post-filter function from the ResolvedItemFilter.
    // This replicates the filter chain that StoryQueryService.findItems() applies.
    const filterFn = this.filterBuilder.build(filter);

    return this.normalizer.normalize(result, filterFn, {
      allItems: result.nodes as ProjectItem[],
      includeDependencies: filter.include_dependencies,
      buildDependencyMap,
    });
  }
}
```

**4. Extract the client-side filter chain as `ItemFilterChain`**

`StoryQueryService.findItems()` applies filters in a fixed order (scope → sprint → epic → assignee → labels → types → statuses → priority → search → estimated → limit). This logic must be preserved as a `(story: Story) => boolean` predicate. Two options:

- **Option A (preferred):** Extract the filter logic from `StoryQueryService.findItems()` into a pure function `buildItemFilterFn(filter: ResolvedItemFilter, config: GitHubBootState): (story: Story) => boolean` in a new file `internal/item-filter.ts`. Inject it into `ProjectItemsAssembler` as `filterBuilder.build(filter)`.
- **Option B:** Inline the filter predicate directly in `ProjectItemsAssembler.assemble()`. Acceptable if the filter logic is short; prefer Option A for testability.

The filter order is defined in `StoryQueryService.findItems()`. Study that method before extracting to ensure no filter step is lost.

**5. Rewrite `DirectLookupAssembler` similarly**

The direct lookup path uses `node(id)` or `issue(number)` queries rather than a full board scan. `StoryQueryService.getStoryDetail()` already does this for single items. For a `keys`-only filter the simplest approach is:

- For each key in `profile.keys`, call `GET_ISSUE_DETAILS_QUERY` (already in `queries.ts`) to fetch the item detail.
- Map each response through `buildStoryFromRaw()` and `toItemListing()` individually.
- Return the assembled `AssemblerOutput`.

This avoids a full board scan entirely, which is the primary objective of the `direct_lookup` profile.

**6. Update `GitHubProjectBackend` factory wiring**

In [`factory.ts`](src/adapters/github/factory.ts) (or wherever the backend deps are constructed), update the assembler constructors to inject `ExecutionEngine`, `ResultNormalizer`, and `ProjectItemsQueryBuilder` instead of `StoryQueryService`.

After this wiring is complete:

- Remove `ResultNormalizer.enrichListings()` call from `StoryQueryService.findItems()`
- Remove `StoryQueryService` from `ProjectItemsAssembler` and `DirectLookupAssembler` constructors

**7. Verify `MixedAssembler` still works**

`MixedAssembler` delegates to `ProjectItemsAssembler`. Once `ProjectItemsAssembler` is rewritten, `MixedAssembler` automatically benefits — no changes needed. Verify by running a `findItems` with a mixed filter (board field + search term) and confirming results.

**Files touched:** `assemblers/project-items-assembler.ts`, `assemblers/direct-lookup-assembler.ts`, new `internal/item-filter.ts`, `factory.ts`, `internal/story-query-service.ts` (remove `enrichListings` call).

**Files not touched:** `ExecutionEngine`, `ResultNormalizer`, `ProjectItemsQueryBuilder`, `filter-strategy-router.ts`, `backend.ts` (dispatch switch unchanged), port interfaces, use-case functions.

**Outcome:** The full assembler → engine → normalizer pipeline is live for `project_items`, `direct_lookup`, and `mixed` profiles. `StoryQueryService.findItems()` is no longer on the call path for these profiles. `custom_fields` passthrough is handled entirely within `ResultNormalizer.normalize()`.

---

### Phase 4c — Search API integration

> **Status: NOT STARTED.** [`SearchApiAssembler`](src/adapters/github/internal/assemblers/search-api-assembler.ts) is currently a shell that returns an empty result set with a warning. No search-related query code exists in the adapter.
>
> **Depends on Phase 4b.** The real `SearchApiAssembler` will use `ExecutionEngine` and a new `SearchResultNormalizer` (or a new entry point on `ResultNormalizer`) — the same infrastructure Phase 4b establishes for the project items path.

Implement `SearchApiAssembler` using the query shape defined in the [GitHub Search API Integration](#github-search-api-integration) section above. Implement a `SearchResultNormalizer` to map the inverted response shape (issue with nested `projectItems`) into `BacklogItemListing[]`. Wire into the strategy router as the `search_api` path.

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

> **Note:** This entire section is aspirational. None of the types or classes described below exist in the current codebase. It describes the target state after all phases (0, 4b, 4c) are complete and a second backend adapter has been implemented.

### Capability Status Taxonomy

The current [`PlatformCapabilities`](src/adapters/capabilities.ts) type uses boolean flags (`canCreateSprints: boolean`). Booleans are insufficient: many operations are possible but require emulation. Replace boolean flags with a three-value enum:

```
NATIVE      - operation maps directly to a platform API call; full fidelity guaranteed
EMULATED    - operation is supported by encoding scrum semantics onto available primitives;
               some constraints apply
UNAVAILABLE - operation cannot be expressed on this platform at all
```

Every field in `PlatformCapabilities` becomes `CapabilityStatus` instead of `boolean`. Operations with `EMULATED` status must document their emulation contract so that agent warning messages contain enough context.

### Platform Vocabulary Map

Each backend implementation defines a `PlatformVocabularyMap` that describes how Scrum domain concepts translate to and from the platform's native primitives. This map is the adapter's internal contract — the use-case layer never sees it.

```
PlatformVocabularyMap
  For each Scrum concept (type, status, sprint, priority, story_points, epic, blocked_by, labels):
    support: CapabilityStatus
    encode(ScrumValue) → PlatformValue
    decode(PlatformValue) → ScrumValue
    constraint?: string

  isSpecialLabel(platformLabel: string) → boolean
  extractUserLabels(allPlatformLabels: string[]) → string[]
```

### Abstract Assembler Contract

```
AbstractAssembler
  assembleItemSearch(filter: ResolvedItemFilter) → PlatformRequest[]
  assembleItemFetch(id: string) → PlatformRequest
  assembleItemCreate(draft: ItemDraft) → PlatformRequest[]
  assembleFieldWrite(id: string, field: string, value: FieldValue) → PlatformRequest[]
  assembleSprintFetch(sprintRef: string) → PlatformRequest[]
  assembleAnalyticsFetch(range: AnalyticsRange) → PlatformRequest[]

  normalizeItemList(rawResponses: PlatformResponse[]) → BacklogItemListing[]
  normalizeSingleItem(rawResponse: PlatformResponse) → Story
  normalizeSprintPayload(rawResponses: PlatformResponse[]) → SprintData

  // Port method defaults — concrete, provided by abstract class.
  // Subclasses implement only assemble* and normalize*; never override port methods.
  async findItems(filter: ResolvedItemFilter): Promise<ItemSearchResult>
  async getStory(id: string): Promise<Story>
  async createItem(draft: ItemDraft): Promise<Story>
  async setField(id: string, field: string, value: FieldValue): Promise<void>
```

### Error Decoration Hierarchy

> **Note:** Only [`AdapterError`](src/domain/errors.ts) and [`UnsupportedCapabilityError`](src/adapters/abstract-backend.ts) exist today. The subclasses below are aspirational.

```
BackendError (base)
  capability: string          // e.g., "findItems"
  platform: string            // e.g., "github"
  recoverySuggestion: string
  platformContext?: object

BackendAuthError extends BackendError
CapabilityUnavailableError extends BackendError
CapabilityEmulationWarning extends BackendError  // non-fatal, surfaces in warnings[]
PlatformConstraintError extends BackendError
BackendRateLimitError extends BackendError
  retryAfterMs?: number
```

### Trello: Concrete Vocabulary Mapping

| Scrum Concept   | Trello Primitive       | Status              | Encoding Convention                                                        |
| --------------- | ---------------------- | ------------------- | -------------------------------------------------------------------------- |
| `type`          | Label with prefix      | EMULATED            | `[scrum:type:user_story]`, `[scrum:type:bug]`, etc. One per card; required |
| `status`        | List (column) position | NATIVE              | List name maps to status name; configured in `scrum_config.yaml`           |
| `sprint`        | Dropdown custom field  | NATIVE (with setup) | Field named "Sprint"; created by `scrum_add_vocabulary` if absent          |
| `priority`      | Dropdown custom field  | NATIVE (with setup) | Field named "Priority"                                                     |
| `story_points`  | Number custom field    | NATIVE (with setup) | Field named "Story Points"                                                 |
| `epic`          | Text custom field      | EMULATED            | Field named "Epic"; stores epic card ID as string                          |
| `blocked_by`    | Checklist item         | EMULATED            | Checklist named "Blocked By"; each item is a card short link               |
| `labels` (user) | Non-special labels     | NATIVE              | Any label not matching `[scrum:*]` prefix passes through unchanged         |
| Burndown        | -                      | UNAVAILABLE         | No date-ranged completion data in Trello API                               |

### What a New Backend Must Implement

To add a backend, implement one concrete class and one vocabulary map. Nothing else changes.

1. A concrete `PlatformVocabularyMap` — maps all Scrum concepts, implements `isSpecialLabel()` and `extractUserLabels()`.
2. A concrete `Assembler` extending `AbstractAssembler` — implements all `assemble*` and `normalize*` methods using the vocabulary map.
3. An execution engine — handles auth, pagination, and rate limiting for that platform.
4. A `getCapabilities()` implementation.

Port interfaces, use-case functions, tool handlers, Zod schemas, and domain types require no changes.
