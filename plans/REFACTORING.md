# Refactoring Plan: `github_*` → `scrum_*` Tool Surface

This document is the authoritative plan for refactoring the MCP server from its current GitHub-primitive tool surface to the backend-agnostic Scrum vocabulary defined in the README's **Tool Surface** section. Update this file as decisions are made or scope changes.

---

## Context and Decisions

### Why this refactoring

The current 18 `github_*` tools expose GitHub GraphQL primitives directly — the agent has to manage project node IDs, field IDs, option IDs, iteration IDs, and user node IDs in its own context. The README's design requires the server to own all of that resolution so the agent speaks only Scrum vocabulary. A `StoryRef` of `{ "number": 42 }` must be enough; `"current"` must be enough to target the active sprint.

### Agreed decisions

| Question                                             | Decision                                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config file location                                 | `.github/scrum/config.yml` in the repo — unchanged from current `ScrumConfigYml` assumption                                                          |
| Project identity (owner, owner_type, project_number) | Provided in the agent's system prompt during testing; eventually the standard orient call (`scrum_orient`) is how the agent acquires and caches this |
| Transition strategy                                  | Hard cutover — no side-by-side period. Build the minimum functioning `scrum_*` surface first; remove old tools in the same pass                      |
| `github_graphql`                                     | Kept on the tool surface, marked deprecated in its description                                                                                       |

---

## Target Tool Surface

Eleven tools. This is the complete, stable contract. No `github_*` tool outside `github_graphql` should be agent-callable after the cutover.

### Read tools (5)

| Tool                | One-line purpose                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `scrum_orient`      | Current platform state + declared vocabulary — the agent's entry point for any new project |
| `scrum_get_sprint`  | Current sprint backlog snapshot grouped by status with point totals                        |
| `scrum_get_backlog` | All unsprinted stories, filterable, with readiness summary                                 |
| `scrum_get_story`   | Full detail of one story: comments, linked PRs, parsed AC                                  |
| `scrum_get_history` | Raw completed-sprint snapshots with per-sprint stories[] and summary stats                 |

### Write tools (6)

| Tool                   | One-line purpose                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `scrum_create_story`   | Create a story and optionally place it on the board in one call                          |
| `scrum_update_story`   | Edit story content (title, body, labels, assignees, epic)                                |
| `scrum_set_field`      | Single entry point for all story-level board-field mutations                             |
| `scrum_plan_sprint`    | Bulk-assign stories to a sprint                                                          |
| `scrum_log_impediment` | Create a blocking impediment story linked to an affected story                           |
| `scrum_add_vocabulary` | Idempotent addition of a vocabulary entry (field option or label) to the platform schema |

### Deprecated (kept, not promoted)

| Tool             | Status                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| `github_graphql` | Deprecated — kept for power-user/diagnostic GraphQL lookups; removed in a future pass |

---

## Phase 1 — Foundations

No tool registrations change in this phase. The goal is to build the internal services and types that all eleven tools will share. Everything in Phase 1 is pure infrastructure.

### 1a. New domain types — `src/types.ts`

Add the canonical Scrum domain types. `SprintStatusResult` and `IterationVelocity` are partial predecessors that will be retired once the old tools are gone.

```typescript
// Accepted as input by any tool that takes a story reference.
// Tools accept either form; handlers resolve to a full ref at invocation time.
export interface StoryRef {
  number?: number; // user-facing issue number
  id?: string; // opaque backend handle returned by a previous tool call
}

// Accepted as the sprint-targeting argument across multiple tools.
// "current" | "next" | null (= backlog, i.e. clear the sprint) | explicit sprint name
export type SprintRef = "current" | "next" | null | string;

// The five board fields the agent can write via scrum_set_field.
export type ScrumField =
  | "status"
  | "sprint"
  | "story_points"
  | "priority"
  | "assignee";

// Story type — drives the type label applied by the backend.
export type StoryType = "feature" | "bug" | "tech_debt" | "spike";

// The canonical story shape returned by every read tool.
// Optional fields are populated when present in the backend.
export interface Story {
  ref: { number: number; id: string }; // always both forms after a read
  title: string;
  body: string;
  type: StoryType | null;
  status: string | null;
  sprint: string | null;
  story_points: number | null;
  priority: string | null;
  assignees: string[];
  labels: string[];
  epic: string | null;
  created_at: string;
  updated_at: string;
  url: string | null;
}
```

`SprintStatusResult`, `BulkUpdateResult`, and `IterationVelocity` become internal to their respective new tool handlers. Remove them from `types.ts` in Phase 4.

### 1b. Config loader — `src/services/config.ts`

A new service called by every tool handler at invocation time (stateless, per design principle 3). Replaces the pre-cached `BoardConfig` / `MergedScrumConfig` pattern.

**Responsibilities:**

- Read `scrum.config.yml` from the repo path via the existing GitHub file service
- Parse and validate against `ScrumConfigYml`
- Fetch live field metadata from the GitHub project in a single `project.fields` call: field IDs, single-select option IDs (status, priority, type, impediment), and the full iteration list
- Return a `RuntimeConfig` object that merges human config with resolved field metadata

```typescript
// Internal runtime type — not exposed to the agent.
export interface RuntimeConfig {
  yml: ScrumConfigYml;
  projectId: string;
  fields: {
    sprintFieldId: string;
    statusFieldId: string;
    storyPointsFieldId: string | null;
    priorityFieldId: string | null;
    epicFieldId: string | null;
    assigneeFieldId: string | null;
    typeFieldId: string | null;
  };
  statusOptions: Record<string, string>; // vocabulary name → option ID
  priorityOptions: Record<string, string>; // vocabulary name → option ID
  typeOptions: Record<string, string>; // StoryType → option ID
  iterations: {
    active: IterationEntry | null;
    next: IterationEntry | null;
    completed: IterationEntry[];
    all: IterationEntry[];
  };
}

// owner/owner_type/project_number come from the agent's system prompt during testing.
export async function loadConfig(
  github: GitHubClient,
  owner: string,
  ownerType: "user" | "org",
  projectNumber: number,
): Promise<RuntimeConfig>;
```

**Caching policy:** no server-side cache. Each invocation fetches fresh. If round-trip latency becomes a problem in practice, a short-lived in-process TTL cache (≤60s) can be added later — but start without one to keep the stateless invariant clean.

### 1c. Resolvers — `src/services/resolver.ts`

Two resolver functions shared across all tool handlers.

```typescript
// Resolves a StoryRef to the GitHub node IDs the backend mutations need.
// { number } → looks up the issue by number to get both the issue node ID and
//              the project item ID.
// { id }     → treats `id` as the project item ID; fetches issue ID from item.
// Returns both so handlers can choose which ID a given operation needs.
export async function resolveStory(
  ref: StoryRef,
  config: RuntimeConfig,
  github: GitHubClient,
): Promise<{ itemId: string; issueId: string; issueNumber: number }>;

// Resolves a SprintRef to a GitHub iteration ID (or null for backlog/clear).
// "current" → config.iterations.active.id (errors if no active iteration)
// "next"    → config.iterations.next.id (errors if none scheduled)
// null      → null (caller uses this to clear the sprint field)
// string    → case-insensitive title match across all iterations
// Pure function — operates on the already-fetched RuntimeConfig.
export function resolveSprint(
  ref: SprintRef,
  config: RuntimeConfig,
): string | null;
```

`resolveSprint` is synchronous — it works on the iteration list already in `RuntimeConfig`. `resolveStory` is async because a number-based lookup requires a GraphQL call.

### 1d. Input schemas — `src/schemas/scrum.ts`

Zod schemas for all eleven tools. No GitHub IDs, node IDs, or internal field identifiers appear in these schemas — Scrum vocabulary only.

**Primitive schemas (shared by multiple tools):**

```typescript
export const StoryRefSchema = z
  .object({
    number: z.number().int().positive().optional(),
    id: z.string().optional(),
  })
  .refine((v) => v.number !== undefined || v.id !== undefined, {
    message: "StoryRef requires at least one of: number, id",
  });

// "current", "next", null, or any explicit sprint name string
export const SprintRefSchema = z.union([
  z.literal("current"),
  z.literal("next"),
  z.null(),
  z.string().min(1),
]);

export const ScrumFieldSchema = z.enum([
  "status",
  "sprint",
  "story_points",
  "priority",
  "assignee",
]);

export const StoryTypeSchema = z.enum(["feature", "bug", "tech_debt", "spike"]);
```

**Per-tool schemas** (abbreviated — full definitions live in the file):

```typescript
// Read tools
// scrum_orient takes no arguments — uses z.object({}).strict().shape inline in the handler
export const GetSprintSchema = z
  .object({ sprint: SprintRefSchema.optional() })
  .strict();
export const GetBacklogSchema = z
  .object({
    search: z.string().optional(),
    labels: z.array(z.string()).optional(),
    priority: z.string().optional(),
    epic: z.string().optional(),
    limit: z.number().int().positive().default(50),
  })
  .strict();
export const GetStorySchema = z.object({ ref: StoryRefSchema }).strict();
export const GetHistorySchema = z
  .object({
    window: z.number().int().min(1).max(10).default(5),
  })
  .strict();
export const GetBurndownSchema = z
  .object({ sprint: SprintRefSchema.optional() })
  .strict();

// Write tools
export const CreateStorySchema = z
  .object({
    title: z.string().min(1),
    body: z.string(),
    type: StoryTypeSchema,
    priority: z.string().optional(),
    story_points: z.number().optional(),
    labels: z.array(z.string()).optional(),
    epic: z.string().optional(),
    assignees: z.array(z.string()).optional(),
    sprint: SprintRefSchema.optional(),
  })
  .strict();

export const UpdateStorySchema = z
  .object({
    ref: StoryRefSchema,
    title: z.string().optional(),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    epic: z.string().or(z.null()).optional(),
  })
  .strict();

export const SetFieldSchema = z
  .object({
    ref: StoryRefSchema,
    field: ScrumFieldSchema,
    value: z.union([z.string(), z.number(), SprintRefSchema, z.null()]),
  })
  .strict();

export const PlanSprintSchema = z
  .object({
    sprint: SprintRefSchema,
    stories: z.array(StoryRefSchema).min(1),
    replace: z.boolean().default(false),
  })
  .strict();

export const LogImpedimentSchema = z
  .object({
    description: z.string().min(1),
    affects: StoryRefSchema,
    raised_by: z.string().optional(),
    priority: z.string().optional(),
  })
  .strict();

export const AddVocabularySchema = z
  .object({
    kind: z.enum(["status_option", "priority_option", "label"]),
    value: z.string().min(1),
  })
  .strict();
```

The predecessor schemas to delete from `src/schemas/inputs.ts` in Phase 4: `GetSprintStatusSchema`, `GetVelocitySchema` (old), `GetBacklogItemsSchema`, `BulkUpdateItemFieldSchema`, `CloseSprintSchema`, `GenerateSprintReportSchema`.

---

## Phase 2 — Read Tools

New file: `src/tools/scrum-read.ts`. Exports a single `registerScrumReadTools(server, github)` function. Implement tools in the order below — each is independently testable.

### `scrum_orient`

- Call `loadConfig(github, ...)`
- Map `RuntimeConfig` to two top-level keys:
  - `platform_state`: fields (status, sprint, story_points, priority — each with `exists` bool and live options list), `labels` note, `iterations` (active, next, completed_count)
  - `declared_vocabulary`: status map, priority map, story_point scale, sprint settings, team, DoR, DoD
- Compute `missing_options` per field by diffing declared vocabulary values against live option names
- No additional GitHub calls beyond what `loadConfig` already makes

### `scrum_get_history`

- Call `loadConfig` to get the completed iteration list
- For each completed iteration in the requested `window`: fetch all project items assigned to that iteration
- Return per sprint: `stories[]` (lightweight: `{ number, title, points, status }`), `summary` (`{ committed_points, completed_points, carried_points, completion_rate, story_count, completed_count }`)
- Top-level `window` field in the response (requested count vs. returned count may differ if fewer sprints exist)
- **No** `average_completed` or any other derived aggregate — agent computes those from raw data

### `scrum_get_backlog`

- Call `loadConfig` to get the sprint field ID
- Fetch all project items where the sprint field is unset (no iteration value)
- Apply optional client-side filters: `search` (title+body substring), `labels`, `priority`, `epic`, `limit` cap
- Compute the `readiness` summary: count items that have story points set, have an AC checklist in body, and have a priority value
- Map each item to the `Story` shape

Note: GitHub Projects v2 does not support server-side filtering on field absence. Retrieve all items and filter client-side. Use pagination; respect the `limit` cap.

### `scrum_get_sprint`

- Accept optional `sprint: SprintRef` (default `"current"`)
- Call `loadConfig`, then `resolveSprint` to get the iteration ID
- Fetch all project items assigned to that iteration
- Group by status in `status_vocabulary` order; sum story points per group and overall
- Return: `sprint` metadata object, `groups` array, `totals` object

The existing `SprintStatusResult` logic is the reference — port and adapt.

### `scrum_get_story`

- Accept `ref: StoryRef`
- Call `resolveStory` to get the issue node ID
- Fetch the issue with: body, comments (author/body/created_at/url), linked PRs (via the issue's timeline or a `closingIssuesReferences` query), and current project field values
- Parse AC from the body by scanning for `- [ ]` / `- [x]` markdown checkboxes
- Map to `Story` plus the extended fields: `comments`, `linked_prs`, `sub_tasks`, `acceptance_criteria`

---

## Phase 2.5 — REST API + `scrum_get_burndown`

See `plans/BURNDOWN.md` for the complete plan. Summary:

- Add `rest<T>()` function to `src/services/github.ts` (single-request REST helper, same auth/timeout pattern as `graphql()`)
- Add `GetBurndownSchema` to `src/schemas/scrum.ts` ✓ (already done)
- Implement `scrum_get_burndown` inside `registerScrumReadTools` in `src/tools/scrum-read.ts`
- Data source: Enterprise Audit Log preferred; falls back to Issue Close Proxy (one REST call per story) on 403

---

## Phase 3 — Write Tools

New file: `src/tools/scrum-write.ts`. Exports `registerScrumWriteTools(server, github)`. Also registers the deprecated `github_graphql` tool here (or in a separate `registerDeprecatedTools`).

### `scrum_add_vocabulary` (implement first — no resolver needed)

- Accept `kind` (`status_option` | `priority_option` | `label`) and `value`
- `status_option` / `priority_option`: call `updateProjectV2SingleSelectField` mutation to append the option to the relevant field. If the field does not exist (`statusFieldId` / `priorityFieldId` is null in config), return a structured error describing the human action needed.
- `label`: call `createLabel` mutation on the repo. Auto-assign a colour from a fixed palette (hash of the label name for determinism). Return `{ created: false }` if the label already exists.
- Idempotent: safe to call if the entry already exists.

### `scrum_set_field` (implement second — used by most other write tools)

The translation engine from Scrum vocabulary to GitHub field mutations. If a vocabulary lookup fails (e.g. status value not in `statusOptions`), return a structured error citing the mismatch and hinting `scrum_add_vocabulary` as the fix.

| `field`        | `value` type                              | Backend operation                                                                                              |
| -------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `status`       | string from `status_vocabulary`           | Resolve name → option ID via `statusOptions`; call `updateProjectV2ItemFieldValue` with `singleSelectOptionId` |
| `sprint`       | `SprintRef`                               | Call `resolveSprint` → iteration ID or null; set or clear the iteration field                                  |
| `story_points` | number or null                            | Set or clear the number field                                                                                  |
| `priority`     | string from `priority_vocabulary` or null | Resolve name → option ID via `priorityOptions`; set or clear                                                   |
| `assignee`     | login string or null                      | Resolve login → user node ID; set or clear via `updateIssue` mutation (not a project field)                    |

Returns the updated `Story`.

### `scrum_update_story`

- Accept `ref`, optional `title`, `body`, `labels`, `assignees`, `epic`
- Call `resolveStory` to get the issue and item node IDs
- Call `updateIssue` mutation for title/body/assignees/labels
- Epic: update the Milestone on the issue (see open question below)
- Return the updated `Story`

### `scrum_create_story`

- Create the issue via the `createIssue` mutation (repo from config)
- Add the created issue to the project via `addProjectV2ItemById`
- For each optional field provided (`priority`, `story_points`, `sprint`, `assignees`): call the `scrum_set_field` logic inline (reuse the internal helper, not the registered tool)
- Type label: resolve via `createLabel` if not yet present (reuse `scrum_add_vocabulary` label logic internally)
- Partial failure: if issue creation succeeds but a field-set fails, return a structured error that includes the partial `StoryRef` so the agent can retry field-sets rather than duplicating the story
- Return the new `Story`

### `scrum_plan_sprint`

- Accept `sprint: SprintRef`, `stories: StoryRef[]`, `replace: boolean`
- If `replace: true`: fetch existing sprint items and clear the sprint field on each first
- For each story in `stories`: call `resolveStory`, then apply the sprint field-set logic
- Collect `assigned` refs and `skipped` entries (`{ ref, reason }`)
- Return the partial-success report described in the README

### `scrum_log_impediment`

Composes existing primitives:

1. `scrum_create_story` with `type = "spike"` (or the team's impediment label if distinct — check config) and initial status set to `"Blocked"`
2. `addComment` mutation (shared internal helper, **not** an agent-callable tool) on the affected story with a cross-link: "Impediment #N opened against this story."
3. `addComment` mutation on the new impediment story back-linking to the affected story

Returns the impediment as a `Story` plus `linked_to: StoryRef`.

---

## Phase 4 — Cutover and Cleanup

### `src/index.ts` swap

```typescript
// Remove:
registerProjectTools(server);
registerItemTools(server);
registerRepositoryTools(server);

// Add:
registerScrumReadTools(server, github);
registerScrumWriteTools(server, github); // includes deprecated github_graphql
```

### Files to delete or gut

| File                      | Action                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `src/tools/projects.ts`   | Delete — fully superseded                                                          |
| `src/tools/items.ts`      | Delete — fully superseded                                                          |
| `src/tools/repository.ts` | Gut tool registrations; keep any internal helper functions still used by new tools |

The underlying service functions in `src/services/github.ts` and `src/services/formatters.ts` are not deleted — new tools call them internally.

### Schemas cleanup — `src/schemas/inputs.ts`

**Remove:** `GetSprintStatusSchema`, `GetVelocitySchema` (old version), `GetBacklogItemsSchema`, `BulkUpdateItemFieldSchema`, `CloseSprintSchema`, `GenerateSprintReportSchema`.

**Keep:** `GetIssueNodeIdSchema`, `GetUserNodeIdSchema`, `GraphQLQuerySchema`, `GetRepoFileSchema`, `WriteRepoFileSchema`, `CreateCommentSchema` — these back the new tool implementations and the deprecated `github_graphql` tool.

### Types cleanup — `src/types.ts`

Remove once old tools are gone: `SprintStatusResult`, `BulkUpdateResult` (implementation details that leaked into the shared type file).

`BoardConfig` and sync-script-specific types (`GhFieldBase`, `GhSingleSelectField`, `GhIterationField`, `GhProjectResponse`) can be removed if `scripts/sync-project-config.ts` is retired — confirm separately.

### `github_graphql` deprecation marker

Update the tool description to read:

> **DEPRECATED.** This tool is preserved for ad-hoc diagnostic GraphQL lookups but will be removed in a future version. Prefer the `scrum_*` tools for all agent workflows. Mutations are blocked.

---

## File Map: Before → After

```text
src/
├── index.ts                     [modify]  swap registerXxxTools calls
├── types.ts                     [modify]  add Story/StoryRef/SprintRef/ScrumField/StoryType;
│                                          retire SprintStatusResult, BulkUpdateResult
├── schemas/
│   ├── inputs.ts                [modify]  remove superseded schemas; keep helpers
│   └── scrum.ts                 [new]     Zod schemas for all 11 scrum_* tools
├── services/
│   ├── github.ts                [modify]  add rest<T>() for Phase 2.5 (burndown)
│   ├── logger.ts                [keep]    unchanged
│   ├── formatters.ts            [keep]    GraphQL fragments, unchanged
│   ├── config.ts                [new]     RuntimeConfig loader
│   └── resolver.ts              [new]     resolveStory / resolveSprint
└── tools/
    ├── projects.ts              [delete]
    ├── items.ts                 [delete]
    ├── repository.ts            [modify]  gut registrations; keep any helpers still in use
    ├── scrum-read.ts            [new]     5 read tools
    └── scrum-write.ts           [new]     6 write tools + deprecated github_graphql
```

---

## Implementation Order (minimum functioning build)

This sequence gets all 11 tools registered and the read path working end-to-end. Write tools are stubbed with a clear `"not yet implemented"` error until step 13.

1. `src/types.ts` — add domain types (`Story`, `StoryRef`, `SprintRef`, `ScrumField`, `StoryType`)
2. `src/schemas/scrum.ts` — all input schemas
3. `src/services/config.ts` — `loadConfig` (unblocks everything)
4. `src/services/resolver.ts` — `resolveSprint` (sync, no deps beyond `RuntimeConfig`)
5. `src/tools/scrum-read.ts` — `scrum_orient` (entry-point read; good integration test checkpoint)
6. `src/tools/scrum-read.ts` — `scrum_get_history`
7. `src/tools/scrum-read.ts` — `scrum_get_backlog`
8. `src/tools/scrum-read.ts` — `scrum_get_sprint`
9. `src/services/resolver.ts` — `resolveStory` (async; needed by remaining tools)
10. `src/tools/scrum-read.ts` — `scrum_get_story`
11. `src/tools/scrum-write.ts` — stubs for all 6 write tools + deprecated `github_graphql`
12. `src/index.ts` — swap to new register calls; delete `projects.ts` and `items.ts` ← **minimum functioning build: server starts, all 11 tools appear in tool list**
13. Write tool implementations in order:
    - `scrum_add_vocabulary` (simplest — single field/label mutation, no resolver)
    - `scrum_set_field` (core primitive)
    - `scrum_update_story`
    - `scrum_create_story`
    - `scrum_plan_sprint`
    - `scrum_log_impediment`

---

## Open Questions

Resolve these before or during implementation — each affects a tool's design.

**Epic field representation.** GitHub Projects v2 has no native "epic" concept. Confirm how epic membership is currently (or will be) modelled: custom single-select field on the project, a label on the issue, or a parent-issue relationship. This affects `scrum_create_story`, `scrum_update_story`, and the `epic` field in `Story`.

> A: Epic should be using GitHub API's `Milestone` type

**Sprint "next" resolution.** "Next" is defined as the scheduled iteration immediately after the active one, by iteration order in the GitHub Projects API response. Confirm this ordering is reliable and that there is at most one active iteration at a time.

> A: The MCP server should perform the check operation, and notify the AI agent that there is or isn't a `next` sprint. The MCP server only reports, it is up to the agent and the user to figure out if a sprint is missing or the current sprint is the last sprint.

**Assignee field writes.** The GitHub Projects v2 `ASSIGNEES` field is a built-in field, not a custom field. Confirm whether `updateProjectV2ItemFieldValue` accepts it or whether assignee writes must go through the `updateIssue` mutation on the issue itself (and whether both are needed for project-item vs. issue-level assignee state).

> A: Use the `updateIssue` built-in API for this function. Do not create a separate field for `ASSIGNEES`. The MCP should treat Issues, PRs, and ProjectsV2 project board under the same Scrum terminology without separating overlapping concepts for technical reasons.

**Sync script fate.** `scripts/sync-project-config.ts` and `scripts/graphql-codegen.ts` — confirm whether the sync script is retired alongside `BoardConfig`, or kept as a development utility independent of the agent-facing surface.

> A: The sync script is retired and not needed as all information should be contained in the subject repository, retrievable via the GraphQL API, or use the pre-fetched schema as the TypeScript type.
