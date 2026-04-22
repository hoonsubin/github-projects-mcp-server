# Implementation Plan: SCRUM Sprint Layer

**Scope**: Full SCRUM management layer — six new sprint tools, three enhancements to existing
tools, the resource and prompt infrastructure they depend on, and the config + sync pipeline
that grounds them all.

**Agent role**: Scrum Master / SM assistant. Humans initiate and plan; the agent monitors,
reports, and executes mechanical triage (assigning items, clearing stale state, reporting sprint
health). The agent must be reactive and low-friction, but never mutate project state from
ambiguous natural language without an explicit confirmation gate.

---

## Reference Project: MesseBuddy

`scrum.config.yml` and `sprint-current.md` are pre-populated from the MesseBuddy SCRUM spec
(Messe München digital onboarding platform, LMU Munich, Summer 2026). This is the canonical
reference for default field names, status taxonomy, priority system, and DoD.

### Taxonomy

**Status values** (auto-synced to `project-board.config.json` after `deno task sync-config`):

| Config key    | GitHub field option |
| ------------- | ------------------- |
| `backlog`     | `"Backlog"`         |
| `ready`       | `"Ready"`           |
| `in_progress` | `"In Progress"`     |
| `in_review`   | `"In Review"`       |
| `done`        | `"Done"`            |
| `blocked`     | `"Blocked"`         |

**Priority system** (MoSCoW, single-select — not numeric):

| Option          | Rank        | Meaning                                    |
| --------------- | ----------- | ------------------------------------------ |
| `"Must Have"`   | 0 (highest) | Core value; sprint fails without it        |
| `"Should Have"` | 1           | Important but not sprint-blocking          |
| `"Could Have"`  | 2           | Nice to have; first to drop under pressure |
| `"Won't Have"`  | 3           | Explicitly out of scope this cycle         |

Because this is single-select rather than numeric, `extractPriorityValue()` in `scrum.ts` must
use the option's index within `priority.options_ordered` (from `project-board.config.json`) as
its sort key — not the field value itself.

**Story points**: Named `"Story Points"` (number field). Human config defines the scale
([1, 2, 3, 5, 8, 13]) and max per item (8); the field's GitHub node ID is stored in
`project-board.config.json` by the sync script.

**Sprint duration**: Variable across sprints. `sprint.duration_days: null` instructs
`resolveTargetIteration()` to derive end dates from the GitHub iteration's own `startDate +
duration` fields rather than a fixed constant.

**Rotating Scrum Master**: `team.members[].scrum_master_sprint` in `scrum.config.yml` maps
sprint number → SM login. The agent uses this when attributing standup prep and sprint reports.

### How config changes propagate

`loadScrumConfig()` is called at the start of every sprint tool invocation — no caching, no
restart required. Two separate reads are merged:

1. `scrum.config.yml` → human project spec (field names, DoR, DoD, epics, team, autonomy)
2. `project-board.config.json` → live board state (field IDs, option lists, active sprint)

A human can rename a GitHub field, run `deno task sync-config` to update
`project-board.config.json`, and the next tool call will use the new IDs — without touching any
TypeScript code.

---

## API Constraints (confirmed from docs)

| Constraint                                                                                 | Impact                                                                                 |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| No `filterBy` on `projectV2.items`                                                         | All filtering is client-side; tools must auto-paginate the full item list              |
| No bulk mutation                                                                           | `github_bulk_update_item_field` loops sequential `updateProjectV2ItemFieldValue` calls |
| Iteration creation not supported via API                                                   | Agent assigns items to existing iterations; sprint setup is human-driven               |
| `ProjectV2ItemFieldIterationValue` exposes `iterationId`, `title`, `startDate`, `duration` | Already present in `ITEM_FIELD_VALUES_FRAGMENT`                                        |
| No history/audit log via API                                                               | Velocity is approximated from current item state, not mutation history                 |

---

## Architecture Overview

Three MCP primitives compose the full system:

```
registerResource  →  stable, human-authored context the agent reads before acting
registerPrompt    →  workflow-scoped behavioral contracts + mutation guardrails
registerTool      →  live GitHub data queries and state mutations
```

These are not interchangeable. Resources ground the agent in project-specific facts. Prompts
gate the agent's authority and define what operations are in-scope per workflow. Tools execute.

---

## Config Pipeline

### Two-file split

| File                        | Owner           | Contains                                                                     |
| --------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `scrum.config.yml`          | Human           | Project spec — field names, team, DoR, DoD, epics, sprint settings, autonomy |
| `project-board.config.json` | GitHub (synced) | Field IDs, option lists, active sprint, all iterations, `_fields_registry`   |

### `loadScrumConfig()` — merge strategy

```typescript
export async function loadScrumConfig(): Promise<MergedScrumConfig> {
  const humanRaw = await Deno.readTextFile("./scrum.config.yml");
  const human = parseYaml(humanRaw) as ScrumConfigYml;

  let board: BoardConfig = EMPTY_BOARD_CONFIG;
  try {
    const boardRaw = await Deno.readTextFile("./project-board.config.json");
    board = JSON.parse(boardRaw) as BoardConfig;
  } catch {
    // project-board.config.json absent — first run before sync
    // tools will still work via live field resolution fallback
  }

  return { ...human, _board: board };
}
```

`MergedScrumConfig` is the union type the sprint tools operate on. All sprint tools read
`config._board._fields_registry` to resolve field names → IDs without a live API call.

### `_fields_registry` fast path in `resolveFields()`

```typescript
export function resolveFields(
  config: MergedScrumConfig,
  liveFields?: GhField[], // provided only when tools have already fetched project fields
): ResolvedScrumFields {
  const registry = config._board._fields_registry;

  // Fast path: use the synced registry — zero extra API calls
  if (Object.keys(registry).length > 0) {
    const fn = config.field_names;
    return {
      sprintField:
        registry[fn.sprint] ?? throwMissing("sprint", fn.sprint, registry),
      statusField:
        registry[fn.status] ?? throwMissing("status", fn.status, registry),
      storyPointsField: registry[fn.story_points] ?? null,
      priorityField: registry[fn.priority] ?? null,
      impedimentField: registry[fn.impediment] ?? null,
    };
  }

  // Fallback: live API fields already fetched (e.g. sprint_status fetches fields anyway)
  if (liveFields) {
    return resolveFromLiveFields(liveFields, config);
  }

  throw new Error(
    "project-board.config.json has no _fields_registry. Run `deno task sync-config` first.",
  );
}
```

---

## Layer 1 — Resources (`src/resources/`)

### `scrum://config`

Backed by the merged result of `loadScrumConfig()`. Surfaces both the human project spec and
the live board state as a single JSON document the agent reads before any sprint operation.

```typescript
server.registerResource(
  "scrum-config",
  "scrum://config",
  {
    description:
      "SCRUM configuration: field name mappings, status taxonomy, DoR, DoD, autonomy level, " +
      "and synced GitHub board field IDs. Read this before any sprint operation.",
    mimeType: "application/json",
  },
  async () => {
    const config = await loadScrumConfig();
    return {
      contents: [
        {
          uri: "scrum://config",
          mimeType: "application/json",
          text: JSON.stringify(config, null, 2),
        },
      ],
    };
  },
);
```

### `scrum://sprint/current`

Backed by `sprint-current.md`. Captures the sprint goal, capacity plan, committed items, and
any out-of-band decisions made at sprint kick-off. The agent reads this before standup, sprint
review, or any "how are we doing" question. It does not replace live sprint status — it is the
human-intent layer the live data is measured against.

```typescript
server.registerResource(
  "sprint-current",
  "scrum://sprint/current",
  {
    description:
      "Human-authored sprint goal, capacity plan, and out-of-band decisions for the " +
      "current sprint. Read before standup or sprint review.",
    mimeType: "text/markdown",
  },
  async () => {
    const text = await Deno.readTextFile("./sprint-current.md");
    return {
      contents: [
        { uri: "scrum://sprint/current", mimeType: "text/markdown", text },
      ],
    };
  },
);
```

A `scrum://sprint/archive/{N}` variant follows the same pattern for historical sprint docs,
enabling the agent to reference past sprint goals when writing velocity commentary.

---

## Layer 2 — Prompts (`src/prompts/`)

Prompts define workflow entry points — the agent enters a mode with a constrained scope of
permitted operations and a clear behavioral contract. They are also the primary mutation safety
mechanism.

**Client support note**: Prompt support is inconsistent across MCP clients. All prompts degrade
gracefully — if a client doesn't surface them, the tools still work, and the tool descriptions
themselves carry the "when NOT to call me" language as a fallback safety layer.

### `scrum://prompts/classify-intent`

Disambiguation gate. The agent invokes this before taking any action on unstructured natural
language input (Slack messages, issue comments, PR descriptions, standup notes).

**Arguments**: `message: string`, `source: "slack" | "comment" | "direct" | "other"`

**Returns**:

```
intent:          "direct_command" | "contextual_reference" | "incidental_mention"
confidence:      "high" | "low"
implied_action:  string | null
implied_items:   string[]          (ticket numbers mentioned)
```

Decision rules:

- `"incidental_mention"` → take no action; optionally surface classification to user
- `"contextual_reference"` + `"low"` confidence → ask user to confirm before acting
- `"direct_command"` + `"high"` confidence → proceed, still subject to autonomy level

This prevents "we should fix #142 eventually" in Slack from moving #142 into the sprint.

### `scrum://prompts/confirm-mutation`

Required before any write originating from unstructured natural language, and before bulk writes
above the `require_confirmation_above_n_items` threshold.

**Arguments**: `action: string`, `items: Array<{id, title}>`, `field: string`, `new_value: string`

**Generates a structured preview and waits for the literal string `"confirm"` — not "yes",
"ok", or "looks good" — before any write tool is called.**

### Workflow-scoped prompts

| Prompt                               | Write ops permitted                       | Resources loaded                           | Triggered by                           |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------ | -------------------------------------- |
| `scrum://prompts/standup`            | None                                      | `scrum://config`, `scrum://sprint/current` | "what's the status", scheduled standup |
| `scrum://prompts/backlog-refinement` | Story points, status, create draft issues | `scrum://config`                           | "let's refine the backlog"             |
| `scrum://prompts/sprint-planning`    | Iteration assignment only                 | `scrum://config`, `scrum://sprint/current` | "let's plan sprint N"                  |
| `scrum://prompts/sprint-close`       | Archive, clear iteration field            | `scrum://config`                           | "close sprint N"                       |
| `scrum://prompts/sprint-management`  | All writes (with autonomy-level gating)   | `scrum://config`, `scrum://sprint/current` | "manage the project"                   |

### Autonomy gradient

```
                        conservative    standard    full
─────────────────────────────────────────────────────────
Read operations              auto          auto      auto
Single write, direct cmd     confirm       auto      auto
Single write, from NL        confirm       confirm   auto*
Bulk write (≤ threshold)     confirm       confirm   auto*
Bulk write (> threshold)     confirm       confirm   confirm
Destructive (archive/close)  confirm       confirm   confirm

* "auto" in "full" mode still runs classify-intent; acts only on high-confidence
  direct_command classification.
```

---

## Layer 3 — Tools

### Enhancements to Existing Tools

These changes close gaps the agent hits repeatedly in normal sprint workflows.

#### `github_list_project_items` — add `iteration_id` and `status_option_id` filters

**Why**: Without filters, every ceremony (standup, sprint review, close) loads the full item
list and scans it in the prompt. For a 200-item project, this is wasteful and fragile.

**New optional params**:

```typescript
iteration_id: z.string().optional(); // filter to a specific sprint
status_option_id: z.string().optional(); // filter to a specific Status option
```

Filtering remains client-side (GitHub API has no `filterBy`), but the tool does it before
returning rather than sending the full list to the model.

#### `github_add_draft_issue` — add `iteration_id` param

**Why**: Items created during refinement or planning must be sprint-assigned immediately.
Without this, every creation requires a follow-up `github_update_item_field` call, making
sprint planning 2× the number of mutations.

**New optional param**:

```typescript
iteration_id: z.string()
  .optional()
  .describe("Iteration node ID to assign immediately on creation.");
```

Implementation: call `updateProjectV2ItemFieldValue` for the sprint field right after `addProjectV2DraftIssue` returns the new item ID, within the same tool call.

#### `github_get_project_fields` — add `field_type` filter

**Why**: The agent frequently needs just the iteration field ID or just the story-points field
ID. Currently it gets all 30+ fields and must scan. A type filter avoids the noise.

**New optional param**:

```typescript
field_type: z.enum([
  "TEXT",
  "NUMBER",
  "DATE",
  "SINGLE_SELECT",
  "ITERATION",
  "ASSIGNEES",
  "LABELS",
  "MILESTONE",
  "REPOSITORY",
  "REVIEWERS",
  "TITLE",
  "TRACKED_BY",
  "TRACKS",
]).optional();
```

---

### New Tools (`src/tools/sprints.ts`)

#### `github_get_sprint_status`

Single-call sprint health check. The agent's primary read before standup, sprint review, or any
"how are we doing" question.

**Input schema**:

```typescript
z.object({
  iteration_id: z
    .string()
    .optional()
    .describe(
      "Iteration node ID. Omit to auto-detect the active iteration by date.",
    ),
}).strict();
// owner / project_number resolved from scrum.config.yml
```

**Logic**:

```
loadScrumConfig()                         → field names, status values, project coords
resolveFields(config)                     → field IDs from _fields_registry (fast path)
fetchProjectFields()                      → live fields (needed for iteration list)
resolveTargetIteration(sprintField, id?)  → active or specified iteration
fetchAllItems()                           → paginated full item list
filterByIteration(items, iterationId)     → sprint items only, no archived
groupByStatus(items, statusFieldId)       → Map<statusName, item[]>
sumStoryPoints(done items)                → completed points
sumStoryPoints(all sprint items)          → committed points
carryOverCandidates: status ≠ done AND daysRemaining < carry_over_threshold_days
blockedItems: status == config.status_values.blocked
```

**Output** (Markdown):

```
## Sprint Status: Sprint 1  (2026-04-27 → 2026-05-15)

**Progress**: 8 / 22 pts  (36%)   ·   9 days remaining
**Items**: 6 total — 2 Done · 2 In Progress · 1 In Review · 1 Blocked

### 🔴 Blocked (1)
- [US-02 Secure login](#url) — 3 pts — @hoonsubin

### 🟡 In Progress (2)  ...
### ✅ Done (2)  ...

### ⚠️ Carry-over Risk  (3 items · 11 pts · 9 days left)
- Sprint is on track. No carry-over risk yet at current pace.
```

---

#### `github_get_velocity`

Answers "how fast are we moving?" for sprint planning and capacity forecasting.

**Input schema**:

```typescript
z.object({
  iterations_count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(4)
    .describe("Number of completed iterations to include."),
}).strict();
```

**Logic**:

```
resolveFields(config)
fetchProjectFields()                  → iteration list
fetchAllItems()                       → full item set (reuses same pagination helper)
selectLastN(completedIterations, N)   → ordered by startDate desc
groupAllItemsByIteration(items)       → Map<iterationId, item[]>
for each selected iteration:
  committed = sumStoryPoints(allItemsInIteration)
  completed = sumStoryPoints(doneItemsInIteration)
average = mean(completed[] for all selected)
trend = mostRecent.completed - average  (with ↑ ↓ → symbol)
```

**Story point attribution**: Points credited to the iteration currently assigned on each item.
Carryover items are credited to whichever iteration they were in when they reached Done. This is
consistent with industry standard and avoids needing mutation history.

**Output**:

```
## Velocity Report — Last 4 Sprints

| Sprint | Dates | Committed | Completed | Rate |
|---|---|---|---|---|
| Sprint 1 | Apr 27–May 15 | 22 pts | — pts | — |  ← active
| (no completed sprints yet) | | | | |

**Average velocity**: n/a (no completed sprints)
**Recommendation**: Use team capacity × 0.7 as first-sprint target.
```

---

#### `github_get_backlog_items`

The agent's view of the Product Backlog — items not assigned to any sprint iteration.

**Input schema**:

```typescript
z.object({
  include_estimated_only: z
    .boolean()
    .default(false)
    .describe(
      "Return only items with a story points value set (sprint-ready candidates).",
    ),
  first: z.number().int().min(1).max(100).default(20),
  after: z
    .string()
    .optional()
    .describe("Cursor from a previous response for pagination."),
}).strict();
```

Pagination is exposed to the caller because the backlog can be large and the agent works through
it in chunks during refinement.

**Logic**:

```
isBacklogItem(item): no IterationValue for sprintField AND isArchived === false

extractPriorityValue(item, priorityFieldId):
  SingleSelect → index in board.priority.options_ordered (lower = higher priority)
  missing      → Infinity (sorts to end)

sortOrder:
  1. priority ascending (items with priority set before items without)
  2. estimated before unestimated
  3. createdAt ascending (oldest first as tiebreaker)

Client-side cursor: base64(numericIndex) — GitHub server cursors can't be reused
after client-side filtering
```

**Output**:

```
## Product Backlog — 18 items unassigned to any sprint

**Unestimated**: 6 items  |  **Estimated**: 12 items · 64 pts total

### Sprint-Ready (estimated, ordered by priority)
| # | Title | Type | Points | Priority |
|---|---|---|---|---|
| US-05 | Buddy search by department | User Story | 5 | Must Have |
| T-07  | Set up CI pipeline | Task | 3 | Must Have |

### Needs Estimation
| # | Title | Type | Status |
|---|---|---|---|
| US-08 | Email notification on match | User Story | Backlog |
```

---

#### `github_bulk_update_item_field`

Assigns a batch of items to a sprint (or sets any other field value) in a single tool call.
The primary write tool for sprint planning.

**Input schema**:

```typescript
z.object({
  project_id: z.string().min(1),
  item_ids: z.array(z.string().min(1)).min(1).max(50),
  field_id: z.string().min(1),
  value: FieldValueUnion, // text | number | date | singleSelectOptionId | iterationId | clear
  stop_on_error: z.boolean().default(false),
}).strict();
```

Max 50 items: covers all practical sprint sizes and stays well within the 5,000 pt/hour rate
limit. The agent makes multiple calls for larger batches.

**Safety**: The tool description explicitly states that when invoked from unstructured NL
context, `confirm-mutation` must have been invoked and returned `"confirm"` first. This is
enforced by the prompt layer, not the tool itself.

**Logic**: Sequential mutation loop (no parallelism — parallel requests risk secondary rate
limits and produce non-deterministic partial state on failures). 50 sequential mutations ≈ 2–3s.

**Output**:

```
## Bulk Update — 6 / 6 succeeded

Field `Sprint` → Sprint 1 on 6 items

✅ PVTI_xxx  US-01 New hire registration
✅ PVTI_yyy  US-02 Secure login with session management
...
```

---

#### `github_close_sprint`

Sprint close ceremony: moves incomplete items to a target iteration or clears them to backlog,
optionally archives Done items.

**Input schema**:

```typescript
z.object({
  closing_iteration_id: z
    .string()
    .min(1)
    .describe("The sprint iteration being closed."),
  target_iteration_id: z
    .string()
    .optional()
    .describe(
      "Iteration to carry incomplete items into. Omit to clear iteration field (return to backlog).",
    ),
  archive_done: z
    .boolean()
    .default(false)
    .describe("Archive items whose status is Done after moving."),
  dry_run: z
    .boolean()
    .default(true)
    .describe(
      "Preview the close operation without executing it. Default true.",
    ),
}).strict();
```

`dry_run` defaults to `true` — the agent must explicitly pass `dry_run: false` to execute.
This is the primary safeguard for a destructive multi-item operation.

**Logic**:

```
fetchAllItems()
filterByIteration(items, closingIterationId)
  → sprintItems (excludes archived)

doneItems       = sprintItems where status == config.status_values.done
incompleteItems = sprintItems where status != done

if dry_run:
  return preview: {
    sprint: closingIteration.title,
    done: doneItems.length,
    incomplete: incompleteItems.length,
    willCarryTo: targetIteration?.title ?? "Backlog",
    willArchive: archive_done ? doneItems.length : 0,
  }

// Execute
for each incompleteItem:
  if target_iteration_id:
    updateProjectV2ItemFieldValue(sprintField, target_iteration_id)
  else:
    clearProjectV2ItemFieldValue(sprintField)

if archive_done:
  for each doneItem:
    archiveProjectV2Item(doneItem.id)

return summary
```

**Output (dry run)**:

```
## Sprint Close Preview — Sprint 1

**Would carry over**: 2 items (8 pts) → Sprint 2
  - US-03 New hire profile  (In Progress · 5 pts)
  - S1-T02 Database schema  (In Review · 3 pts)

**Would archive**: 4 Done items

Run with `dry_run: false` to execute.
```

---

#### `github_generate_sprint_report`

Synthesizes the full sprint review / retrospective document from live board data and
`sprint-current.md`. The output is the structured report the SM and PO review.

**Input schema**:

```typescript
z.object({
  iteration_id: z
    .string()
    .optional()
    .describe("Iteration node ID. Omit to use the active iteration."),
  include_retrospective_scaffold: z
    .boolean()
    .default(true)
    .describe("Include Start / Stop / Continue template in output."),
}).strict();
```

**Logic**:

```
loadScrumConfig()                   → project spec (DoD, team, sprint settings)
readSprintDoc("sprint-current.md")  → sprint goal, commitments, out-of-band decisions
github_get_sprint_status(iteration) → live item-by-item state
github_get_velocity()               → completed points, trend

reportSections:
  1. Sprint summary (goal, dates, Scrum Master, PO)
  2. Goal achieved? (yes / no / partial — compared against Done items)
  3. Velocity table (this sprint + last N from config.sprint.velocity_window)
  4. Item-by-item outcome (committed items vs actual status)
  5. Carry-over list with context
  6. Definition of Done checklist (from config, for each Done item)
  7. Retrospective scaffold (Start / Stop / Continue) — if include_retrospective_scaffold
```

**Output** (structured Markdown, ready to paste into sprint-current.md or send as a report):

```
# Sprint 1 Review — MesseBuddy
**Date**: 2026-05-15  |  **SM**: Alisa Diakova  |  **PO**: Peter Tubak

## Sprint Goal
> Enable any user to register, log in, and create a fully filled profile…

**Goal Achieved**: ⚠️ Partially — 2 of 4 user stories completed

## Velocity
| Sprint | Committed | Completed | Rate |
|---|---|---|---|
| Sprint 1 | 22 pts | 14 pts | 64% |

## Item Outcomes
| ID | Title | Status | Points |
|---|---|---|---|
| US-01 | New hire registration | ✅ Done | 3 |
| US-02 | Secure login | ✅ Done | 3 |
| US-03 | New hire profile | ⚠️ Carry-over | 5 |
...

## Carry-over to Sprint 2
- US-03 (5 pts) — US-04 (5 pts)

## Retrospective — Start / Stop / Continue
| | Observations |
|---|---|
| ✅ What went well | |
| ⚠️ Needs improvement | |
| 🚀 Start doing | |
| 🛑 Stop doing | |
```

---

## New Types (`src/types.ts`)

```typescript
// Merged runtime config (human YAML + board JSON)
export interface MergedScrumConfig {
  project: {
    owner: string;
    owner_type: "user" | "org";
    project_number: number;
  };
  field_names: {
    sprint: string;
    status: string;
    story_points: string;
    priority: string;
    epic: string;
    item_type: string;
    assignee: string;
    impediment: string;
  };
  status_values: Record<string, string>; // key: snake_case alias, value: exact option name
  sprint: {
    duration_days: number | null;
    velocity_window: number;
    carry_over_threshold_days: number;
    report_submit_time: string;
    report_recipient: string | null;
  };
  autonomy: {
    level: "conservative" | "standard" | "full";
    require_confirmation_above_n_items: number;
  };
  definition_of_ready: { version: string; criteria: string[] };
  definition_of_done: { version: string; criteria: string[] };
  epics: Array<{ id: string; title: string; priority: string }>;
  team: {
    product_owner: { name: string; contact: string };
    members: Array<{
      login: string;
      name: string;
      scrum_master_sprint: number;
    }>;
    supervisor: { name: string; contact: string; report_recipient: boolean };
  };
  story_points: {
    method: string;
    scale: number[];
    max_points_per_item: number;
  };
  impediment: { escalation_threshold_days: number };
  // Board-sourced (from project-board.config.json)
  _board: {
    _fields_registry: Record<
      string,
      { id: string; dataType: string; __typename: string }
    >;
    status_values: Record<string, unknown>; // includes _field_id and _options
    priority: Record<string, unknown>;
    sprint: {
      _field_id: string | null;
      active_sprint: SprintIteration | null;
      all_iterations: SprintIteration[];
    };
    impediment: { _field_id: string | null; statuses: string[] };
    story_points: { _field_id: string | null };
  };
}

// Resolved field references after name → ID mapping
export interface ResolvedScrumFields {
  sprintFieldId: string;
  statusFieldId: string;
  storyPointsFieldId: string | null;
  priorityFieldId: string | null;
  impedimentFieldId: string | null;
  doneOptionId: string | null; // null until status_values is synced
  blockedOptionId: string | null;
}

// Per-iteration velocity entry
export interface IterationVelocity {
  iterationId: string;
  title: string;
  startDate: string;
  durationDays: number;
  endDate: string;
  committedPoints: number;
  completedPoints: number;
  completionRate: number; // 0–1
  isCurrent: boolean;
}

// Sprint status aggregate
export interface SprintStatusResult {
  iteration: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    daysRemaining: number;
  };
  committedPoints: number;
  completedPoints: number;
  completionPct: number;
  itemsByStatus: Record<string, ProjectV2Item[]>;
  blockedItems: ProjectV2Item[];
  carryOverItems: ProjectV2Item[];
}

export interface SprintIteration {
  id: string;
  title: string;
  startDate: string;
  duration: number;
  completed?: boolean;
}

// Per-item result for bulk / close operations
export interface BulkUpdateResult {
  item_id: string;
  title: string;
  success: boolean;
  error?: string;
}
```

---

## Helper Functions (`src/services/scrum.ts`)

```typescript
// Load scrum.config.yml and merge with project-board.config.json
export async function loadScrumConfig(): Promise<MergedScrumConfig>;

// Resolve field names → IDs using _fields_registry (fast path) or live fields (fallback)
export function resolveFields(
  config: MergedScrumConfig,
  liveFields?: GhField[],
): ResolvedScrumFields;

// Paginate all items from a project into a flat array
export async function fetchAllItems(
  owner: string,
  ownerType: "user" | "org",
  projectNumber: number,
): Promise<ProjectV2Item[]>;

// Find the active iteration by date, or a specific one by ID
export function resolveTargetIteration(
  iterations: SprintIteration[],
  iterationId?: string,
): SprintIteration & { endDate: string; daysRemaining: number };

// Typed field value extractors
export function getNumberFieldValue(
  item: ProjectV2Item,
  fieldId: string,
): number | null;
export function getStatusValue(
  item: ProjectV2Item,
  fieldId: string,
): { name: string; optionId: string } | null;
export function getIterationValue(
  item: ProjectV2Item,
  fieldId: string,
): { iterationId: string; title: string } | null;

// Story point aggregation
export function sumStoryPoints(
  items: ProjectV2Item[],
  fieldId: string | null,
): number;

// Priority sort key for backlog ordering
export function extractPriorityValue(
  item: ProjectV2Item,
  fieldId: string | null,
  orderedOptions: string[],
): number;

// Client-side pagination cursor
export function encodeCursor(index: number): string;
export function decodeCursor(cursor: string): number;

// ISO date arithmetic
export function computeEndDate(startDate: string, durationDays: number): string;
export function daysRemaining(endDate: string): number;
```

---

## Full File Structure (post-implementation)

```
github-projects-mcp-server/
├── scrum.config.yml              Human-defined project spec (version-controlled)
├── project-board.config.json     Auto-generated board state (gitignore candidate)
├── sprint-current.md             Active sprint doc (SM updates each sprint)
├── scripts/
│   └── sync-project-config.ts   Sync GitHub fields → project-board.config.json
├── deno.json                     + sync-config, sync-config:dry tasks; @std/yaml import
└── src/
    ├── index.ts                  + registerSprintTools, registerScrumResources, registerSprintPrompts
    ├── types.ts                  + MergedScrumConfig, ResolvedScrumFields, IterationVelocity,
    │                               SprintStatusResult, BulkUpdateResult, SprintIteration
    ├── tools/
    │   ├── projects.ts           + field_type filter on github_get_project_fields
    │   ├── items.ts              + iteration_id/status filters on list; iteration_id on add_draft_issue
    │   └── sprints.ts            NEW: 6 sprint tools
    ├── schemas/
    │   └── inputs.ts             + GetSprintStatusSchema, GetVelocitySchema,
    │                               GetBacklogItemsSchema, BulkUpdateItemFieldSchema,
    │                               CloseSprintSchema, GenerateSprintReportSchema,
    │                               + updated ListProjectItemsSchema, AddDraftIssueSchema,
    │                               + updated GetProjectFieldsSchema
    ├── services/
    │   ├── github.ts             (unchanged)
    │   ├── formatters.ts         (unchanged)
    │   └── scrum.ts              NEW: loadScrumConfig, resolveFields (_fields_registry fast path),
    │                               fetchAllItems, resolveTargetIteration, field getters,
    │                               sumStoryPoints, extractPriorityValue, cursor helpers
    ├── resources/
    │   ├── index.ts              NEW: registerScrumResources(server)
    │   ├── config.ts             NEW: scrum://config resource
    │   └── sprint.ts             NEW: scrum://sprint/current + scrum://sprint/archive/{n}
    └── prompts/
        ├── index.ts              NEW: registerSprintPrompts(server)
        ├── classify.ts           NEW: scrum://prompts/classify-intent
        ├── confirm.ts            NEW: scrum://prompts/confirm-mutation
        └── workflows.ts          NEW: standup, backlog-refinement, sprint-planning,
                                       sprint-close, sprint-management
```

---

## Implementation Order

Sequenced so each step is independently verifiable before the next depends on it.

**Step 1 — Types** (`src/types.ts`)
Add `MergedScrumConfig`, `ResolvedScrumFields`, `IterationVelocity`, `SprintStatusResult`,
`BulkUpdateResult`, `SprintIteration`. Pure declarations, zero risk.

**Step 2 — Zod schemas** (`src/schemas/inputs.ts`)
Add the six new sprint tool schemas plus updated schemas for `ListProjectItems`, `AddDraftIssue`,
and `GetProjectFields`. Pure validation, zero risk.

**Step 3 — `src/services/scrum.ts`**
Implement `loadScrumConfig()` (merge yml + json), `resolveFields()` (registry fast path + live
fallback), `fetchAllItems()`, `resolveTargetIteration()`, all field getters and helpers.
Test `loadScrumConfig` and `resolveFields` in isolation with `deno test` before tools use them.

**Step 4 — Resources** (`src/resources/`)
`config.ts` then `sprint.ts`. Verify with MCP Inspector that `scrum://config` returns the full
merged config before building tools that call `loadScrumConfig()`.

**Step 5 — Prompts** (`src/prompts/`)
`classify.ts`, `confirm.ts`, `workflows.ts`. These are message templates and can be authored and
reviewed without running code.

**Step 6 — Existing tool enhancements**

- `github_get_project_fields`: add `field_type` filter (`src/tools/projects.ts`)
- `github_list_project_items`: add `iteration_id` + `status_option_id` filters (`src/tools/items.ts`)
- `github_add_draft_issue`: add `iteration_id` param with post-creation update (`src/tools/items.ts`)

**Step 7 — New sprint tools** (in this order within `src/tools/sprints.ts`):

1. `github_get_backlog_items` — no aggregation, only filtering; simplest logic
2. `github_bulk_update_item_field` — no field resolution; purely mechanical loop
3. `github_get_sprint_status` — field resolution + multi-group aggregation; core read tool
4. `github_get_velocity` — builds directly on `github_get_sprint_status` helpers
5. `github_close_sprint` — bulk mutation + archive; implement dry_run first, then execute path
6. `github_generate_sprint_report` — composes from sprint_status + velocity + sprint-current.md

**Step 8 — Wire** (`src/index.ts`)
Add `registerSprintTools(server)`, `registerScrumResources(server)`, `registerSprintPrompts(server)`.
Keep the existing register calls unchanged — additive only.

**Step 9 — README update**
Promote planned tools to existing. Add Resources and Prompts sections. Update module architecture
diagram to include the new directories.

---

## Pre-Implementation Checklist

Confirm before writing code:

1. **Run `deno task sync-config`** once with a valid `GITHUB_TOKEN` to populate
   `project-board.config.json`. Verify `_fields_registry` contains all eight expected field names.

2. **Verify field names match `scrum.config.yml`** — confirm the GitHub Projects board has fields
   named exactly `"Sprint"`, `"Status"`, `"Story Points"`, `"Priority"`, `"Epic"`, `"Type"`,
   `"Assignee"`, `"Impediment"`. Check the sync output for any `⚠️` warnings about unmatched
   names. Update `field_names` in `scrum.config.yml` if any differ, then re-sync.

3. **`"Story Points"` must be a Number field** in GitHub Projects — not text. Sprint arithmetic
   requires numeric type. If created as text, recreate as number.

4. **Priority must be a Single Select field** with options named exactly `"Must Have"`,
   `"Should Have"`, `"Could Have"`, `"Won't Have"` (case-sensitive, spaces included).

5. **Confirm GitHub logins** — `team.members[].login` values must be real GitHub usernames
   for assignee attribution to work correctly.

6. **`sprint.duration_days: null` is intentional** — sprints vary in length. Do not set a
   fixed number unless all sprints will be exactly the same duration.

7. **Add `project-board.config.json` to `.gitignore`** (optional but recommended) — this file
   is generated and contains GitHub node IDs that change if the project is recreated. Teams that
   want reproducible tooling without running sync can commit it instead.
