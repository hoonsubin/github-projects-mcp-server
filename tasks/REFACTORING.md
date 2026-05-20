# Refactoring Plan: First-Class Epics & Story Dependencies

## Overview

This plan adds two domain-level features currently missing or underspecified in the v1 surface:

1. **Epics as first-class entities** — `Story.epic` is currently a raw `string | null` (a GitHub Milestone title). It has no stable identity, no lifecycle state, and no way to enumerate all epics without scanning stories. This refactoring promotes epics to typed, referenceable objects with their own listing.

2. **Structured story dependencies** — dependencies between stories are currently prose inside the story body. This refactoring parses them into typed `blocked_by`/`blocks` arrays on `Story` and adds a `has_dependencies` flag to `StoryListing` so the agent can identify dependency-carrying items during planning without fetching full story detail.

**Tool surface contract does not grow.** No new MCP tools are added. The changes surface through amended return shapes of existing tools (`scrum_get_backlog`, `scrum_get_story`) and an amended argument to `scrum_update_story`.

---

## Design Decisions (read before implementing any phase)

These decisions are locked. Do not re-derive them during implementation.

### D1 — Epics belong in `scrum_get_backlog`, not in a dedicated tool

Epics are a backlog-level planning artifact. The agent needs them during backlog orientation, which already calls `scrum_get_backlog`. Adding a `scrum_get_epics` tool would require a separate call in every planning workflow. The response for `scrum_get_backlog` gains a top-level `epics:
EpicListing[]` field.

### D2 — Epic writes go through existing story tools

`scrum_create_story` and `scrum_update_story` already accept `epic?: string`. Once `EpicRef` exists, those inputs accept the opaque ID. The adapter resolves the name or ID internally. No `scrum_create_epic` / `scrum_update_epic` tools are added in this plan.

### D3 — `Story.epic` type changes from `string | null` to `{ ref: EpicRef; name: string } | null`

This is a planned breaking change to the tool surface. It affects every place that currently reads `story.epic` as a string. The breaking change is contained in Phase 2, which must fix all downstream usages atomically. The build must pass at the end of Phase 2.

### D4 — GitHub adapter maps Milestones → EpicListing

On GitHub, a Milestone is the backing concept for an Epic. The adapter maps:

- `milestone.id` (node ID) → `EpicRef.id`
- `milestone.title` → `EpicListing.name`
- `milestone.description` → `EpicListing.description`
- `milestone.state` (`OPEN`/`CLOSED`) → `EpicListing.status` (`"open"` / `"done"`)
- `milestone.openIssues.totalCount + milestone.closedIssues.totalCount` → `EpicListing.story_count`

Future non-GitHub adapters map their own concept (Linear Project, Notion DB row, etc.) to the same `EpicListing` shape. The port is backend-agnostic.

### D5 — Dependencies are stored as a `## Dependencies` section in the story body

On GitHub there is no native project-level dependency field. The convention is a markdown section:

```markdown
## Dependencies

- Blocked by: #17
- Blocked by: #42
- Blocks: #55
```

The GitHub adapter parses this section. Writes update this section. Other backends (Linear, Notion) will implement `EpicPort` and the dependency fields natively — the port contract is the same.

### D6 — `has_dependencies: boolean` in `StoryListing` is a cheap parse flag

It is `true` if and only if the story body contains a non-empty `## Dependencies` section. It does NOT require resolving whether upstream stories are done. The agent uses it to identify which items need full dependency inspection via `scrum_get_story`. Resolving actual block status is agent work.

### D7 — Dependency entries carry `key` and `title`; `ref.id` may be null

Parsing `#17` from the body yields an issue number, not a project item ID. Resolving issue numbers to project item IDs requires additional queries. The `DependencyEntry.ref.id` field is typed as `string | null` — the adapter sets it to the resolved project item ID when it can (backlog/sprint contexts where all items are already in memory), and `null` otherwise. The `key` (issue number string) is always present and is sufficient for the agent to look up the story.

### D8 — `scrum_update_story` gains `blocked_by` and `blocks` write fields

Both `blocked_by?: StoryRef[] | null` and `blocks?: StoryRef[] | null` are added symmetrically. Each replaces its respective direction atomically (same pattern as `labels` and `assignees`). `null` clears all entries in that direction; omitting the field leaves it unchanged. The adapter rewrites only the affected direction in the `## Dependencies` body section, preserving the other direction's lines. Both fields provided → rewrite both. Both `null` → remove the entire section.

---

## Implementation Phases

The phases are **strictly sequential**. Each phase must leave the build green (`deno lint` passes, `deno test` passes, TypeScript compiles without errors) before the next phase begins. Each phase is designed to be executed by a single agent working in isolation.

**Exception — Phases 4 and 5 must be paired.** Phase 4 intentionally introduces TypeScript compile errors (required `blocked_by`/`blocks` fields without adapter implementation) that serve as a guided checklist for Phase 5. Do not hand off between them — treat Phases 4 and 5 as a single unit when assigning to agents or planning across sessions.

---

## Phase 1 — Domain Layer: New Types & Port Contracts [done]

> **Board tickets:** [#75](https://github.com/hoonsubin/github-projects-mcp-server/issues/75), [#96](https://github.com/hoonsubin/github-projects-mcp-server/issues/96), [#101](https://github.com/hoonsubin/github-projects-mcp-server/issues/101)

**Goal:** Add all new types and port method signatures. No logic changes. No breaking changes to existing type shapes. Build stays green throughout.

**Files in scope:**

- `src/domain/types.ts`
- `src/scrum/ports.ts`

### Changes to `src/domain/types.ts`

1. **Add `EpicRef`** after the `ImpedimentRef` definition:

   ```typescript
   /**
    * A reference to a single Epic.
    * On GitHub: id is the Milestone node ID (MI_...).
    * Pass to story create/update tools as the epic identifier.
    */
   export interface EpicRef {
     id: string;
   }
   ```

2. **Add `EpicListing`** after `EpicRef`:

   ```typescript
   /**
    * Lightweight epic entry for planning contexts.
    * Returned in scrum_get_backlog alongside StoryListing[].
    * Full epic detail (child stories, history) is derived by the agent via
    * scrum_get_backlog filtered by epic name.
    */
   export interface EpicListing {
     ref: EpicRef;
     name: string;
     description: string | null;
     priority: string | null; // team's vocabulary value, or null
     status: "open" | "in_progress" | "done" | null;
     story_count: number; // total stories under this epic (all statuses)
   }
   ```

3. **Add `DependencyEntry`** after `EpicListing`:

   ```typescript
   /**
    * A single dependency link between two stories.
    * key is always present (human-readable issue number, e.g. "17").
    * ref.id is the project item ID when resolvable from in-memory context; null otherwise.
    * title is the story title when available; null if not yet resolved.
    */
   export interface DependencyEntry {
     key: string;
     title: string | null;
     ref: { id: string | null };
   }
   ```

4. **Add dependency fields to `StoryBase`** — add two optional fields at the end of the `StoryBase` interface (optional `?` keeps this non-breaking; Phase 4 makes them required):

   ```typescript
   blocked_by?: DependencyEntry[];  // stories that must be Done before this one starts
   blocks?: DependencyEntry[];      // stories that are downstream of this one
   ```

5. **Remove the stale todo comment** on line 22: `// todo: need to handle epics as first-class object`

   Do not change `IssueStory.epic` type yet — that is Phase 2.

### Changes to `src/scrum/ports.ts`

1. **Add import** for `EpicListing` from `../domain/types.ts` (add to the existing import line).

2. **Add `has_dependencies: boolean` to `StoryListing`** (new optional field — non-breaking):

   ```typescript
   has_dependencies: boolean; // true when the story body contains a ## Dependencies section
   ```

3. **Add `blocked_by?: StoryRef[] | null` to `StoryUpdates`**:

   ```typescript
   blocked_by?: StoryRef[] | null; // null clears all; omit to leave unchanged
   ```

4. **Add `EpicPort`** focused interface before the `BacklogPort` definition:

   ```typescript
   /**
    * Epic port — returns all epics for the project.
    * Used by: getBacklogUseCase
    */
   export interface EpicPort {
     getEpics(): Promise<EpicListing[]>;
   }
   ```

5. **Compose `EpicPort` into `ProjectReader`**:

   Change `ProjectReader` extends line from:
   ```typescript
   export interface ProjectReader
     extends BacklogPort, SprintPort, StoryPort, HistoryPort, BurndownPort, ImpedimentPort {
   ```
   to:
   ```typescript
   export interface ProjectReader
     extends BacklogPort, SprintPort, StoryPort, HistoryPort, BurndownPort, ImpedimentPort, EpicPort {
   ```

6. **Update `ProjectBackend`** — it extends `ProjectReader`, so it picks up `EpicPort` automatically. No explicit change needed unless the comment needs updating.

### Verification

- `deno lint` passes.
- `deno test` passes (no logic changed).
- TypeScript compiles: `GitHubProjectBackend` will now show a compile error for the missing `getEpics()` method — this is expected and will be resolved in Phase 3.

---

## Phase 2 — Epics: Type Migration, Use Case, Tool Schema [done]

> **Board tickets:** [#80](https://github.com/hoonsubin/github-projects-mcp-server/issues/80), [#102](https://github.com/hoonsubin/github-projects-mcp-server/issues/102)

**Goal:** Upgrade `Story.epic` from `string | null` to a structured object. Update all downstream consumers of `story.epic` atomically. Expose `epics: EpicListing[]` in the `scrum_get_backlog` response. The build must pass at the end of this phase.

**Prerequisite:** Phase 1 complete.

**Files in scope:**

- `src/domain/types.ts`
- `src/adapters/github/types.ts`
- `src/adapters/github/mappers.ts`
- `src/adapters/github/internal/story-query-service.ts`
- `src/scrum/get-backlog.ts`
- `src/scrum/get-story.ts`
- `src/schemas/scrum.ts` (if a Zod schema for the backlog response exists; if not, check `src/tools/scrum-read.ts` for inline schema definitions)
- `src/tools/scrum-read.ts`

### Changes to `src/domain/types.ts`

Upgrade `IssueStory.epic` type from `string | null` to:

```typescript
epic: { ref: EpicRef; name: string } | null;
```

`DraftStory.epic` stays `null` — no change needed there.

### Changes to `src/adapters/github/types.ts`

The `ProjectItemIssueContent.milestone` shape currently is:

```typescript
milestone: { title: string; dueOn: string | null } | null;
```

Add `id` so the adapter can build `EpicRef`:

```typescript
milestone: { id: string; title: string; dueOn: string | null } | null;
```

Similarly, `IssueDetailsInput` in `src/adapters/github/mappers.ts` has:

```typescript
milestone?: { title: string } | null;
```

Expand to:

```typescript
milestone?: { id: string; title: string } | null;
```

### Changes to `src/adapters/github/operations.graphql`

Two operations reference `milestone` without the `id` field. Add `id` to both:

1. In the project item fragment that fetches `Issue` content (used by `GetProjectItems` or equivalent) — find `milestone { title` and change to `milestone { id title`.
2. In `GetIssueDetails` — find `milestone { title }` and change to `milestone { id title }`.

### Changes to `src/adapters/github/internal/story-query-service.ts`

`GetIssueDetailsResponse` (line ~33) contains an inline `milestone` type that is separate from `IssueDetailsInput` in `mappers.ts`. Add `id` to this inline type to match the GraphQL change:

```typescript
// Before
milestone?: { title: string } | null;

// After
milestone?: { id: string; title: string } | null;
```

This is in the `node` sub-shape of `GetIssueDetailsResponse`, approximately line 44. Failing to update this type means the `id` field is silently dropped when the GraphQL response is typed, even if the query correctly requests it.

### Changes to `src/adapters/github/mappers.ts`

**`buildStoryFromRaw`** (Issue/PR branch, line ~147):

Before:

```typescript
const epic = content.__typename === "Issue" ? content.milestone?.title ?? null : null;
```

After:

```typescript
const epic = content.__typename === "Issue" && content.milestone
  ? { ref: { id: content.milestone.id }, name: content.milestone.title }
  : null;
```

**`buildEnrichedStory`** (line ~198):

Before:

```typescript
epic: issueNode.milestone?.title ?? null,
```

After:

```typescript
epic: issueNode.milestone
  ? { ref: { id: issueNode.milestone.id }, name: issueNode.milestone.title }
  : null,
```

### Changes to `src/scrum/get-backlog.ts`

**Epic filter** (line ~84) currently compares `s.epic === params.epic` (string equality). Change to:

```typescript
if (params.epic) {
  stories = stories.filter((s) => s.epic?.name === params.epic);
}
```

**Return type** — extend `GetBacklogResult` to include epics:

```typescript
interface GetBacklogResult {
  stories: StoryListing[];
  total_count: number;
  readiness: { ready: number; partially_ready: number; not_ready: number };
  orphan_impediments: ImpedimentListing[];
  epics: EpicListing[]; // ← add
}
```

Import `EpicListing` and `EpicPort` from `./ports.ts`. Change the use case signature to accept a `BacklogPort & EpicPort` (or a combined type) instead of just `BacklogPort`:

```typescript
export const getBacklogUseCase = async (
  backend: BacklogPort & EpicPort,
  scrumConfig: ScrumConfig,
  params: GetBacklogParams,
): Promise<GetBacklogResult> => {
```

Fetch epics in parallel with stories and impediments:

```typescript
const [allStories, orphanImpediments, epics] = await Promise.all([
  backend.getBacklogStories(),
  backend.getOrphanImpediments(),
  backend.getEpics(),
]);
```

Include `epics` in the returned object.

### Changes to `src/tools/scrum-read.ts`

In the `scrum_get_backlog` handler, pass the `epics` field from the use case result through to the MCP response. The shape should mirror `EpicListing` exactly — no transformation needed.

If a Zod output schema exists for this tool, add the `epics` field definition. Follow the same pattern used for `orphan_impediments`.

### Changes to `src/scrum/get-story.ts`

`GetStoryResult.story` is currently typed as `unknown`. Change it to `Story`:

```typescript
// Before
interface GetStoryResult {
  story: unknown;
  // ...
}

// After
import type { Story } from "../domain/types.ts";

interface GetStoryResult {
  story: Story;
  // ...
}
```

This is a one-line change that ensures the `blocked_by`/`blocks` fields added in Phase 4, and any future `Story` fields, are compiler-validated through the full use-case return path rather than silently typed as `unknown`.

### Verification

- `deno lint` passes.
- `deno test` passes.
- TypeScript compiles without errors. The `GitHubProjectBackend` will still show an error for the missing `getEpics()` implementation — expected; resolved in Phase 3.
- Calling `scrum_get_backlog` via the MCP inspector returns an `epics` array (empty until Phase 3 wires up `getEpics()`).

---

## Phase 3 — Epics: GitHub Adapter Implementation [done]

> **Board tickets:** [#103](https://github.com/hoonsubin/github-projects-mcp-server/issues/103)

**Goal:** Implement `getEpics()` and `getEpics()`-related Milestone fetching in the GitHub adapter. Resolve the Phase 2 TypeScript compile error. Build must pass cleanly at end of phase.

**Prerequisite:** Phase 2 complete.

**Files in scope:**

- `src/adapters/github/operations.graphql` (new query)
- `src/adapters/github/queries.ts` (new export)
- `src/adapters/github/internal/story-query-service.ts` (or a new `src/adapters/github/internal/epic-service.ts`)
- `src/adapters/github/backend.ts`

### New GraphQL operation

Add a `ListMilestones` operation to `operations.graphql`. It must query milestones for all tracked repos (iterate over `config.trackedRepos`). The operation should return for each milestone:

```graphql
id
title
description
state        # OPEN | CLOSED
openIssues: issues(states: OPEN) { totalCount }
closedIssues: issues(states: CLOSED) { totalCount }
```

Add the corresponding exported constant to `queries.ts` following the existing pattern:

```typescript
export const LIST_MILESTONES_QUERY = buildQuery("ListMilestones");
```

### New or extended service

Either add a new `src/adapters/github/internal/epic-service.ts` class or add the method to an appropriate existing service. The implementation fetches milestones for all repos in `config.trackedRepos`, deduplicates by milestone ID, and maps each to `EpicListing`:

```
milestone.id          → EpicListing.ref.id
milestone.title       → EpicListing.name
milestone.description → EpicListing.description (null if empty string)
milestone.state       → "open" | "done" (OPEN → "open", CLOSED → "done")
openIssues.totalCount
  + closedIssues.totalCount → EpicListing.story_count
priority              → null (GitHub Milestones have no priority field)
```

### Changes to `src/adapters/github/backend.ts`

Add `getEpics(): Promise<EpicListing[]>` to `GitHubProjectBackend`. Delegate to the new service. This resolves the compile error introduced in Phase 1.

### Verification

- `deno lint` passes.
- `deno test` passes.
- TypeScript compiles without errors.
- Calling `scrum_get_backlog` returns a populated `epics` array when milestones exist on the configured repos.
- Each epic in the response has `ref.id` (Milestone node ID), `name`, and `status`.

---

## Phase 4 — Dependencies: Domain, Use Case & Tool Schema [done]

> **Board tickets:** [#82](https://github.com/hoonsubin/github-projects-mcp-server/issues/82) [#98](https://github.com/hoonsubin/github-projects-mcp-server/issues/98) [#104](https://github.com/hoonsubin/github-projects-mcp-server/issues/104), [#81](https://github.com/hoonsubin/github-projects-mcp-server/issues/81),

**Goal:** Make dependency fields required (not optional) on `Story`, populate them in the use case layer, expose `has_dependencies` in `StoryListing` for both backlog and sprint views, and add `blocked_by` and `blocks` to the `scrum_update_story` input schema symmetrically. The GitHub adapter wires in Phase 5.

**Prerequisite:** Phase 3 complete.

**Must be paired with Phase 5** — this phase intentionally leaves the build broken. See the pairing note in the Implementation Phases preamble.

**Files in scope:**

- `src/domain/types.ts`
- `src/scrum/get-backlog.ts`
- `src/scrum/get-sprint.ts`
- `src/scrum/get-story.ts`
- `src/scrum/ports.ts`
- `src/schemas/scrum.ts` (or wherever `UpdateStorySchema` is defined)
- `src/tools/scrum-write.ts`

### Changes to `src/domain/types.ts`

Make the dependency fields on `StoryBase` required (remove the `?`):

```typescript
blocked_by: DependencyEntry[];
blocks: DependencyEntry[];
```

This will produce TypeScript compile errors in any code that constructs a `Story` without these fields — those errors guide what to fix in the adapter (Phase 5).

Also explicitly add the required fields to `DraftStory`. `DraftStory` extends `StoryBase` and inherits the fields structurally, but the mapper constructs `DraftStory` objects directly in Phase 5. Making them explicit on `DraftStory` catches any future divergence:

```typescript
export interface DraftStory extends StoryBase {
  kind: "draft";
  key: null;
  url: null;
  epic: null;
  blocked_by: DependencyEntry[]; // always [] — Draft Issues have no tracked dependencies
  blocks: DependencyEntry[]; // always []
}
```

### Changes to `src/scrum/get-backlog.ts`

Update `storyToListing` to populate `has_dependencies`:

```typescript
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true,
  has_dependencies: story.blocked_by.length > 0 || story.blocks.length > 0,
});
```

### Changes to `src/scrum/get-sprint.ts`

`get-sprint.ts` has its own story-to-listing projection (separate from `get-backlog.ts`). Apply the same `has_dependencies` population there. Find the function or inline expression that maps a `Story` to a `StoryListing` and add:

```typescript
has_dependencies: story.blocked_by.length > 0 || story.blocks.length > 0,
```

The sprint board view is where the agent does standup and mid-sprint planning — this is where the `has_dependencies` flag has the most day-to-day value.

### Changes to `src/scrum/get-story.ts`

The `Story` object returned by the adapter already contains `blocked_by` and `blocks` once Phase 5 is complete. The use case passes them through to the tool response without transformation.

Verify the use case does not strip these fields when constructing its return value. If it builds a new object from the story, add the two fields explicitly.

### Changes to `src/scrum/ports.ts`

Add `blocks` to `StoryUpdates` alongside the existing `blocked_by` field (added in Phase 1):

```typescript
blocked_by?: StoryRef[] | null; // null clears all; omit to leave unchanged
blocks?: StoryRef[] | null;     // null clears all; omit to leave unchanged
```

### Changes to `src/schemas/scrum.ts`

Add both `blocked_by` and `blocks` to the `UpdateStorySchema` (find the schema for `scrum_update_story`). Add them as a pair — they follow identical patterns:

```typescript
blocked_by: z
  .array(StoryRefSchema)
  .nullish()
  .describe(
    "Replace the full list of stories that block this story. " +
      "Each entry is a StoryRef ({ id }) obtained from a previous read tool. " +
      "Pass null to clear all dependencies. Omit to leave dependencies unchanged.",
  ),
blocks: z
  .array(StoryRefSchema)
  .nullish()
  .describe(
    "Replace the full list of stories that this story blocks (downstream dependencies). " +
      "Each entry is a StoryRef ({ id }) obtained from a previous read tool. " +
      "Pass null to clear all. Omit to leave unchanged.",
  ),
```

### Changes to `src/tools/scrum-write.ts`

In the `scrum_update_story` handler, pass both `blocked_by` and `blocks` from the validated input through to `StoryUpdates`. For each field: if `undefined` (omitted), omit from `StoryUpdates`; if `null`, pass `null`; if an array, pass the array.

### Verification

- TypeScript will have compile errors from the required `blocked_by`/`blocks` fields on `Story` — these are expected and guide Phase 5 (the adapter must be updated to populate them).
- `deno lint` passes on non-erroring files.
- The `UpdateStorySchema` now includes both `blocked_by` and `blocks` — verify with a JSON schema dump or test.

---

## Phase 5 — Dependencies: GitHub Adapter Implementation [done]

> **Board tickets:** [#104](https://github.com/hoonsubin/github-projects-mcp-server/issues/104) _(paired with Phase 4)_

**Goal:** Parse and write the `## Dependencies` body section in the GitHub adapter. Populate `blocked_by`, `blocks`, and `has_dependencies` in all story-building paths. Resolve all compile errors from Phase 4. Build must pass cleanly at end of phase.

**Prerequisite:** Phase 4 complete.

**Files in scope:**

- `src/adapters/github/mappers.ts`
- `src/adapters/github/internal/story-mutation-service.ts`
- `src/adapters/github/internal/story-query-service.ts` (for resolution context)
- `src/adapters/github/backend.ts` (if `updateStory` is wired here)

### Dependency body convention

The `## Dependencies` section uses this format (case-insensitive matching):

```
## Dependencies

- Blocked by: #17
- Blocked by: #42
- Blocks: #55
```

Parsing rules:

- Lines starting with `- Blocked by: #` (case-insensitive) → `blocked_by` entries.
- Lines starting with `- Blocks: #` (case-insensitive) → `blocks` entries.
- Any other lines in the section are ignored.
- If the section is absent, both arrays are empty.

Writing rules (applied when `blocked_by` and/or `blocks` are provided in `StoryUpdates`):

- **Only `blocked_by` provided:** rewrite all `- Blocked by: #N` lines; preserve all existing `- Blocks: #N` lines unchanged.
- **Only `blocks` provided:** rewrite all `- Blocks: #N` lines; preserve all existing `- Blocked by: #N` lines unchanged.
- **Both provided:** rewrite both sets of lines atomically.
- **A field is `null`:** clear all lines for that direction; preserve the other direction.
- **Both are `null`:** remove the entire `## Dependencies` section from the body.
- **A field is an array:** for each `StoryRef`, resolve it to an issue number via `resolveStory` in `resolver.ts`, then write `- Blocked by: #N` or `- Blocks: #N` accordingly.

### Changes to `src/adapters/github/mappers.ts`

Add a private parsing helper (not exported — stays internal to the mapper module):

```typescript
const parseDependencies = (body: string): {
  blocked_by: DependencyEntry[];
  blocks: DependencyEntry[];
} => {
  // 1. Find ## Dependencies section (case-insensitive)
  // 2. Extract lines matching "- Blocked by: #N" and "- Blocks: #N"
  // 3. Return arrays of DependencyEntry with key=N, title=null, ref.id=null
  // (ref.id resolution is deferred — the adapter sets it when in-memory context is available)
};
```

Update `buildStoryFromRaw` and `buildEnrichedStory` to call `parseDependencies(content.body ?? "")` and spread the result into the returned story object.

Update `DraftStory` construction to set `blocked_by: []` and `blocks: []` (Draft Issues have no body-level dependencies in this model).

### Dependency ref resolution (best-effort, for `getSprintStories` and `getBacklogStories`)

These methods already fetch all project items into memory. After building the `Story[]`, do a second pass: for each story's `blocked_by`/`blocks` entries where `ref.id` is `null`, look up the referenced issue number in the already-fetched item list and fill in `ref.id`. This is O(n) with no additional network calls.

Implement as a pure function in `mappers.ts`:

```typescript
export const resolveDependencyRefs = (
  stories: Story[],
  allItems: ProjectItem[],
  config: RuntimeConfig,
): Story[] => {
  // Build a map: issue number (string) → project item ID
  // Walk each story's blocked_by and blocks arrays; fill ref.id where found
};
```

Call this function at the end of `getSprintStories` and `getBacklogStories` before returning.

For `getStoryDetail`, dependency ref resolution requires a separate lookup if the items are not in memory. Acceptable approach: return `ref.id = null` for `getStoryDetail` context in Phase 5; a follow-up can add a targeted resolution query.

### Changes to `src/adapters/github/internal/story-mutation-service.ts`

Add dependency write support to `updateStory`. When `StoryUpdates.blocked_by` or `StoryUpdates.blocks` is defined, apply the writing rules from D8:

1. Fetch the current story body (already done as part of the update flow if the body is being replaced; otherwise fetch via `GET_ITEM_FIELDS_QUERY` or `GET_ISSUE_DETAILS_QUERY`).
2. Parse the existing `## Dependencies` section to extract the current `blocked_by` and `blocks` line sets.
3. For each field that is provided (non-`undefined` in `StoryUpdates`): if `null`, clear its direction's lines; if an array, resolve each `StoryRef` to an issue number via `resolveStory` in `resolver.ts` and overwrite that direction's lines.
4. Reconstruct the `## Dependencies` section from the updated line sets. If both directions are empty after the update, remove the section entirely.
5. Proceed with the body mutation using the reconstructed body text.

### Verification

- `deno lint` passes.
- `deno test` passes.
- TypeScript compiles without errors.
- `scrum_get_story` on a story with a `## Dependencies` section returns populated `blocked_by` and/or `blocks` arrays.
- `scrum_get_sprint` returns `has_dependencies: true` for sprint items that have a `## Dependencies` section (not just backlog items — both views must reflect the flag).
- `scrum_get_backlog` returns `has_dependencies: true` for stories with a `## Dependencies` section.
- `scrum_update_story` with `blocked_by: [{ id: "..." }]` rewrites only the `Blocked by` lines, preserving existing `Blocks` lines.
- `scrum_update_story` with `blocked_by: null, blocks: null` removes the entire `## Dependencies` section without corrupting surrounding body content.

---

## Phase 6 — README Tool Surface Documentation

> **Board tickets:** [#105](https://github.com/hoonsubin/github-projects-mcp-server/issues/105)

**Goal:** Update `README.md` to document the amended tool shapes. Pure documentation — no code changes.

**Prerequisite:** Phase 5 complete.

**Files in scope:**

- `README.md`

### Changes

**Common Types table** — add three new rows:

| Type              | Meaning                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EpicRef`         | Reference to an Epic. Shape: `{ "id": "<opaque>" }`. Returned in `EpicListing.ref` and `Story.epic.ref`.                                            |
| `EpicListing`     | Lightweight epic entry. Fields: `ref`, `name`, `description`, `priority`, `status` (`"open"` / `"in_progress"` / `"done"` / `null`), `story_count`. |
| `DependencyEntry` | A single dependency link. Fields: `key` (issue number string), `title` (or `null`), `ref.id` (project item ID or `null`).                           |

**StoryListing shape table** — add:

| Field              | Meaning                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `has_dependencies` | `true` when the story body contains a `## Dependencies` section with at least one entry. Use as a signal to call `scrum_get_story` for full dependency detail. |

**Story shape table** — update `epic` row and add dependency rows:

- `epic` row: change description from "Parent epic name, or `null`. Readable and writable." to "Parent epic as `{ ref: EpicRef; name: string }`, or `null`. The `ref.id` can be used as the `epic` argument in `scrum_create_story` and `scrum_update_story`."
- Add `blocked_by` row: "Array of `DependencyEntry` — stories that block this one. Empty array if none."
- Add `blocks` row: "Array of `DependencyEntry` — stories downstream of this one. Empty array if none."

**`scrum_get_backlog` — Returns section** — add `epics` field:

> `epics` — Array of `EpicListing`. All epics currently defined for the project, regardless of the story filter applied. The agent uses this list for epic-level planning and to populate the `epic` argument in create/update calls.

**`scrum_get_story` — Returns section** — note that the `Story` shape now includes `blocked_by` and `blocks` arrays.

**`scrum_update_story` — Arguments table** — add `blocked_by` and `blocks` rows:

| Argument     | Meaning                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked_by` | optional, array of `StoryRef` or `null`. Replaces the full upstream dependency list atomically. Pass `null` to clear all. Omit to leave unchanged.                                |
| `blocks`     | optional, array of `StoryRef` or `null`. Replaces the full downstream dependency list atomically. Pass `null` to clear all. Omit to leave unchanged. Symmetric with `blocked_by`. |

### Verification

- All amended tables are internally consistent.
- `scrum_get_backlog` "Does not" section still does not claim to return epic details or follow dependency chains — those remain agent responsibilities.

---

## Completion Criteria

The refactoring is complete when all six phases have passed verification and:

1. `deno lint` passes on the full codebase.
2. `deno test` passes.
3. TypeScript compiles with zero errors.
4. `scrum_get_backlog` returns `epics: EpicListing[]` alongside stories.
5. `scrum_get_story` returns `blocked_by: DependencyEntry[]` and `blocks: DependencyEntry[]`.
6. `scrum_update_story` with `blocked_by` rewrites the dependency section correctly.
7. README accurately documents all amended shapes.
