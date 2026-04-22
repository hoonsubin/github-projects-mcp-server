# Implementation Plan: SCRUM Sprint Tools

**Scope**: `github_get_sprint_status`, `github_get_velocity`, `github_get_backlog_items`,
`github_bulk_update_item_field` — plus the resource and prompt infrastructure they depend on.

**Agent role**: Scrum Master / SM assistant. Humans initiate and plan; the agent monitors,
reports, and executes mechanical triage (assigning items, clearing stale state, reporting sprint
health). The agent must be reactive and low-friction, but never mutate project state from
ambiguous natural language without an explicit confirmation gate.

---

## Reference Project: MesseBuddy

The `scrum.config.json` and `sprint-current.md` files are pre-populated from the MesseBuddy
SCRUM spec (Messe München digital onboarding platform, LMU Munich, Summer 2026). This is the
canonical reference for default field names, status taxonomy, priority system, and DoD.

### Taxonomy derived from spec

**Status values** (single-select field, from sprint backlog status key):

| Config key | GitHub field option | Display |
|---|---|---|
| `todo` | `"To Do"` | 🔵 |
| `in_progress` | `"In Progress"` | 🟡 |
| `in_review` | `"In Review"` | 🟠 |
| `done` | `"Done"` | ✅ |
| `blocked` | `"Blocked"` | 🔴 |

**Priority system** (MoSCoW single-select, not numeric):

| Option | Rank | Meaning |
|---|---|---|
| `"Must Have"` | 0 (highest) | Core value; sprint fails without it |
| `"Should Have"` | 1 | Important but not sprint-blocking |
| `"Could Have"` | 2 | Nice to have; first to drop under pressure |
| `"Won't Have"` | 3 | Explicitly out of scope this cycle |

Because this is single-select rather than numeric, `extractPriorityValue()` in `scrum.ts`
must use the option's index within `priority.options_ordered` as its sort key — not the
field value itself. This is declared via `priority.type: "single_select"` in config.

**Story points field**: Named `"Est."` (not "Story Points") — the column header used in
all sprint backlog tables in the spec.

**Sprint duration**: Variable across sprints (Sprint 1: 19 days, Sprints 2–4: ~18 days).
`sprint.duration_days` is set to `null`, which instructs `resolveTargetIteration()` to
derive the end date from the GitHub iteration's `startDate + duration` fields rather than
a config constant. Fixed-duration teams can set this to a number to override.

**Rotating Scrum Master**: Each sprint has a different SM (Alisa → Hoon → Kseniya → Luis).
The `team.members[].scrum_master_sprint` field in config maps sprint number to SM login.
The agent uses this when attributing standup prep and sprint reports.

### How taxonomy changes propagate

The agent calls `loadScrumConfig()` at the start of every sprint tool invocation. There is
no caching — the file is re-read each call. Consequences:

- A human edits `scrum.config.json` (e.g. renames "In Review" → "Under Review") → the
  next tool call immediately uses the new name. No server restart needed.
- The agent itself can propose config edits (e.g. adding a new status option) as a text
  response, but it does not write to `scrum.config.json` autonomously. Config changes are
  human-executed. This is intentional: the config is the human's definition of the process.
- `sprint-current.md` follows the same pattern — the SM updates it, the agent reads it
  fresh. Stale content in the doc is the SM's responsibility, not the agent's.

---

## API Constraints (confirmed from docs)

| Constraint | Impact |
|---|---|
| No `filterBy` on `projectV2.items` | All filtering is client-side; tools must auto-paginate the full item list before filtering |
| No bulk mutation | `github_bulk_update_item_field` loops sequential `updateProjectV2ItemFieldValue` calls |
| Iteration creation not supported via API | Agent can assign/move items between existing iterations; sprint setup is human-driven |
| `ProjectV2ItemFieldIterationValue` exposes `iterationId`, `title`, `startDate`, `duration` | Already present in `ITEM_FIELD_VALUES_FRAGMENT` — no fragment changes needed |

---

## Architecture Overview

Three MCP primitives compose the full system:

```
registerResource  →  stable, human-authored context the agent reads before acting
registerPrompt    →  workflow-scoped behavioral contracts + mutation guardrails
registerTool      →  live GitHub data queries and state mutations
```

These are not interchangeable. Resources ground the agent in project-specific facts.
Prompts gate the agent's authority and define what operations are in-scope per workflow.
Tools execute. The separation matters: a prompt cannot stop a tool from being called
directly, but together they define a coherent contract the agent is trained to respect.

---

## Layer 1 — Resources (`src/resources/`)

Resources are passive, URI-addressed documents the client surfaces to the model as ambient
context. They back slow-changing, human-authored facts that the agent should "just know"
rather than derive from repeated API calls.

### `scrum://config`

Backed by `scrum.config.json` in the project root (human-edited, committed to the repo).
This file answers the "open questions" that previously required tool parameters on every
sprint tool call, and controls the autonomy level of the agent.

**`scrum.config.json` schema:**

```json
{
  "project": {
    "owner": "hoonsubin",
    "owner_type": "user",
    "project_number": 1
  },
  "field_names": {
    "sprint":        "Sprint",
    "status":        "Status",
    "story_points":  "Story Points",
    "priority":      "Priority"
  },
  "status_values": {
    "done":          "Done",
    "in_progress":   "In Progress",
    "in_review":     "In Review",
    "blocked":       "Blocked",
    "todo":          "Todo"
  },
  "sprint": {
    "duration_days":              14,
    "velocity_window":             5,
    "carry_over_threshold_days":   3
  },
  "autonomy": {
    "level": "standard",
    "require_confirmation_above_n_items": 3
  },
  "definition_of_done": [
    "Code reviewed and approved by at least one peer",
    "Unit tests written and passing",
    "Deployed to staging environment",
    "Acceptance criteria verified"
  ]
}
```

The `autonomy.level` field controls which confirmation gates are active:

| Level | Behaviour |
|---|---|
| `"conservative"` | Confirm before any write, even single-item updates from explicit commands |
| `"standard"` | Confirm for bulk writes and all writes from unstructured natural language |
| `"full"` | Autonomous for unambiguous single-item writes; confirm only for bulk or destructive ops |

**Resource registration** (`src/resources/config.ts`):

```typescript
server.registerResource(
  "scrum-config",
  "scrum://config",
  { description: "SCRUM configuration: field name mappings, autonomy level, Definition of Done. Read this before any sprint operation.", mimeType: "application/json" },
  async () => {
    const config = await loadScrumConfig(); // reads scrum.config.json, falls back to defaults
    return { contents: [{ uri: "scrum://config", mimeType: "application/json",
      text: JSON.stringify(config, null, 2) }] };
  }
);
```

### `scrum://sprint/current`

Backed by `sprint-current.md` in the project root — a human-written document capturing the
sprint goal, capacity plan, and any out-of-band decisions made at sprint kick-off. The agent
reads this as grounding before standup, sprint review, or any status report. It does not
replace the live sprint status tool; it is the human-intent layer the live data is measured
against.

**Template (human fills at sprint start):**

```markdown
# Sprint N — Goal & Capacity

**Sprint Goal**: One outcome-based sentence.

**Dates**: YYYY-MM-DD → YYYY-MM-DD

## Capacity

| Member | Available Days | Notes |
|---|---|---|
| @alice | 10 | — |

## Commitments

Items pulled into this sprint and the reasoning behind selecting them.

## Out-of-band Decisions

Anything that happened outside the board (stakeholder requests, scope changes mid-sprint).
```

**Resource registration** (`src/resources/sprint.ts`):

```typescript
server.registerResource(
  "sprint-current",
  "scrum://sprint/current",
  { description: "Human-authored sprint goal, capacity plan, and commitments for the current sprint. Read before standup or sprint review.", mimeType: "text/markdown" },
  async () => {
    const text = await readSprintDoc("sprint-current.md");
    return { contents: [{ uri: "scrum://sprint/current", mimeType: "text/markdown", text }] };
  }
);
```

A `scrum://sprint/archive/{N}` resource follows the same pattern for historical sprint docs,
enabling the agent to reference past sprint goals when writing velocity commentary.

---

## Layer 2 — Prompts (`src/prompts/`)

Prompts are named, server-controlled instruction templates. They define *workflow entry
points* — the agent enters a mode with a constrained scope of permitted operations and a
clear behavioral contract. They are also the primary mutation safety mechanism.

**Client support note**: Prompt support is less consistent across MCP clients than tool
support. All prompts are designed to degrade gracefully — if a client doesn't surface them,
the tools still work correctly, and the tool descriptions themselves carry the "when NOT to
call me" language as a fallback safety layer.

### `scrum://prompts/classify-intent`

The disambiguation gate. The agent invokes this before taking any action on unstructured
natural language input (Slack messages, issue comments, PR descriptions, standup notes).

**Arguments**: `message: string`, `source: "slack" | "comment" | "direct" | "other"`

**Returns a structured classification**:

```
intent:   "direct_command" | "contextual_reference" | "incidental_mention"
confidence: "high" | "low"
implied_action: string | null   (human-readable description of what would happen)
implied_items:  string[]        (ticket numbers or item IDs mentioned)
```

Decision rules baked into the prompt template:
- `"incidental_mention"` → agent takes no action, optionally surfaces classification to user
- `"contextual_reference"` + `"low"` confidence → agent must ask user to confirm before acting
- `"direct_command"` + `"high"` confidence → agent proceeds, still subject to autonomy level rules

This gate prevents the failure mode where "we should fix the auth bug (#142) eventually" in
a Slack thread causes the agent to move #142 into the current sprint.

### `scrum://prompts/confirm-mutation`

Required before any write that originated from unstructured natural language, and before
bulk writes above the `require_confirmation_above_n_items` threshold from config.

**Arguments**: `action: string`, `items: Array<{id, title}>`, `field: string`, `new_value: string`

**Generates**:

```
⚠️ Proposed change
  Field:  "Status"
  Value:  "Done"
  Items (2):
    • #142 Fix auth token refresh (@alice)
    • #143 Update API docs (@bob)

Reply "confirm" to proceed or "cancel" to abort.
```

The model must hold state and not call any write tool until a structured confirmation
(the literal string "confirm") is returned. The prompt template explicitly forbids
proceeding on ambiguous responses like "yes", "ok", or "looks good".

### Workflow-scoped prompts

Each prompt loads the relevant resources, declares which tools are in-scope for this
workflow, and states the constraints the agent must operate under.

| Prompt | Write ops permitted | Resources loaded | Human trigger |
|---|---|---|---|
| `scrum://prompts/standup` | None (read-only) | `scrum://config`, `scrum://sprint/current` | "what's the status", scheduled standup |
| `scrum://prompts/backlog-refinement` | Story points, status, create draft issues | `scrum://config` | "let's refine the backlog" |
| `scrum://prompts/sprint-planning` | Iteration assignment only (no status changes) | `scrum://config`, `scrum://sprint/current` | "let's plan sprint N" |
| `scrum://prompts/sprint-close` | Archive, clear iteration field | `scrum://config` | "close sprint N" |
| `scrum://prompts/sprint-management` | All write ops (with autonomy-level gating) | `scrum://config`, `scrum://sprint/current` | "manage the project" |

`sprint-management` is the full-authority mode for reactive autonomous operation. It still
runs `classify-intent` on every unstructured input and enforces `confirm-mutation` per the
autonomy level in config. The human entering this mode is the consent act — not every
individual mutation.

### Autonomy gradient

Maps autonomy level + operation type to the required confirmation behavior:

```
                        conservative    standard    full
─────────────────────────────────────────────────────────
Read operations              auto          auto      auto
Single write, direct cmd     confirm       auto      auto
Single write, from NL        confirm       confirm   auto*
Bulk write (≤ threshold)     confirm       confirm   auto*
Bulk write (> threshold)     confirm       confirm   confirm
Destructive (delete/close)   confirm       confirm   confirm

* "auto" in "full" mode still calls classify-intent; acts only on high-confidence
  direct_command classification.
```

---

## Layer 3 — Tools (`src/tools/sprints.ts`)

With the config resource in place, sprint tools no longer accept `*_field_name` parameters.
Field names, status values, and project coordinates are resolved from `scrum.config.json`
via `loadScrumConfig()` at call time. This shrinks the input surface of every sprint tool
to what the agent actually needs to vary per call.

### Shared design decisions

**Field resolution**: `resolveFields(fields, config)` in `src/services/scrum.ts` maps config
field names to GraphQL node IDs by fetching the project fields. Throws a descriptive error
naming the missing field and listing what fields do exist if any name doesn't match.

**Auto-pagination**: `fetchAllItems(owner, ownerType, projectNumber)` in `src/services/scrum.ts`
loops `items(first: 100, after: cursor)` until `hasNextPage` is false. Sprint status and
velocity need the full item set; backlog items expose pagination to the caller.

**`loadScrumConfig()`**: reads `scrum.config.json`, validates with Zod, falls back to
a `DEFAULT_SCRUM_CONFIG` if the file is absent so the server always starts without error.

---

### `github_get_sprint_status`

**Purpose**: Single-call sprint health check — the agent's primary read before standup,
sprint review, or any "how are we doing" question.

**Input schema** (all field names resolved from config; no name params):

```typescript
z.object({
  iteration_id: z.string().optional()
    .describe("Iteration node ID. Omit to auto-detect the current active iteration by date."),
}).strict()
// owner / project_number come from scrum.config.json
```

**GraphQL: Step 1 — resolve fields** (reuses project fields query):

```graphql
query($login: String!, $number: Int!) {
  user(login: $login) {
    projectV2(number: $number) {
      id
      fields(first: 30) {
        nodes {
          ... on ProjectV2Field             { id name dataType }
          ... on ProjectV2SingleSelectField { id name dataType options { id name color } }
          ... on ProjectV2IterationField    {
            id name dataType
            configuration {
              iterations          { id title startDate duration }
              completedIterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}
```

**GraphQL: Step 2 — fetch all items** (via `fetchAllItems()`, auto-paginated, 100/page):

```graphql
query($login: String!, $number: Int!, $first: Int!, $after: String) {
  user(login: $login) {
    projectV2(number: $number) {
      items(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isArchived
          content {
            ... on Issue       { __typename id number title url state }
            ... on PullRequest { __typename id number title url state }
            ... on DraftIssue  { __typename id title }
          }
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name optionId
                field { ... on ProjectV2FieldCommon { id name } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                iterationId title startDate duration
                field { ... on ProjectV2FieldCommon { id name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { id name } }
              }
            }
          }
        }
      }
    }
  }
}
```

**Logic (`src/services/scrum.ts`)**:

```
loadScrumConfig()            → field names, status values, project coords
resolveFields(fields, config) → { sprintField, statusField, storyPointsField }
resolveTargetIteration(sprintField, iteration_id?)
  → if iteration_id given: find in active + completed iterations
  → if omitted: find iteration where startDate ≤ today ≤ startDate + duration
  → error if no current iteration exists (between-sprint boundary)
filterItemsByIteration(allItems, sprintField.id, targetIterationId)
  → items whose IterationValue.iterationId matches; excludes archived
groupItemsByStatus(items, statusField.id)
  → Map<statusName, item[]>; items with no status → "No Status"
sumStoryPoints(items, storyPointsField.id)
  → sum NumberValue across items; missing field value contributes 0
carryOverItems = sprintItems where status ≠ done AND daysRemaining < threshold
blockedItems   = sprintItems where status == blocked_status_name
```

**Output**:

```
## Sprint Status: Sprint 5  (2026-04-14 → 2026-04-27)

**Progress**: 18 / 31 pts  (58%)
**Items**: 9 total — 5 Done · 2 In Progress · 1 In Review · 1 Blocked

### 🔴 Blocked (1)
- [Fix auth token refresh](url) #142 — 5 pts — @alice

### 🟡 In Progress (2)
- [Migrate user table](url) #138 — 3 pts — @bob
- [Add rate limit headers](url) #140 — 2 pts — @carol

### 🟠 In Review (1)
- [Update API docs](url) #141 — 2 pts — @alice

### ✅ Done (5)  ...

### ⚠️ Carry-over Risk  (4 items · 13 pts · 3 days left)
```

---

### `github_get_velocity`

**Purpose**: Answers "how fast are we moving?" — read before sprint planning for capacity
forecasting, and during sprint review to surface trend direction.

**Input schema**:

```typescript
z.object({
  iterations_count: z.number().int().min(1).max(10).default(5)
    .describe("How many completed iterations to include in the velocity series."),
}).strict()
```

**GraphQL**: same two queries as `github_get_sprint_status`. No new queries needed.

**Logic**:

```
selectIterations(sprintField, iterations_count)
  → take last N from completedIterations ordered by startDate desc
groupAllItemsByIteration(allItems, sprintField.id)
  → Map<iterationId, item[]>
computeVelocityPerIteration(iterationMap, selectedIterations, config)
  → for each completed iteration:
      committed = sumStoryPoints(allItemsInIteration)
      completed = sumStoryPoints(doneItemsInIteration)
computeAverageVelocity(velocities)  → mean of completed points
computeTrend(velocities)
  → (mostRecent.completed - average) with direction symbol ↑ ↓ →
```

**Story point attribution note** (included in output): Story points are credited to the
iteration currently assigned on each item. Items carried across sprint boundaries are
credited to the iteration they were in when they reached Done — which in practice is
their current iteration. This slightly underestimates velocity on long-running carryovers
but is consistent and the industry standard for projects without mutation history.

**Output**:

```
## Velocity Report — Last 5 Sprints

| Sprint | Dates | Committed | Completed | Rate |
|---|---|---|---|---|
| Sprint 5 | Apr 14–27 | 31 pts | 18 pts | 58% |  ← active
| Sprint 4 | Mar 31–Apr 13 | 28 pts | 26 pts | 93% |
| Sprint 3 | Mar 17–30 | 25 pts | 25 pts | 100% |
| Sprint 2 | Mar 3–16 | 30 pts | 21 pts | 70% |
| Sprint 1 | Feb 17–Mar 2 | 22 pts | 19 pts | 86% |

**Average velocity (last 4 completed)**: 22.8 pts/sprint
**Trend**: ↑ +3.2 pts vs average (Sprint 4)
```

---

### `github_get_backlog_items`

**Purpose**: The agent's view of the Product Backlog — items in the project not assigned
to any sprint. Used during refinement (what needs estimates or acceptance criteria) and
sprint planning (what to pull next).

**Input schema**:

```typescript
z.object({
  include_estimated_only: z.boolean().default(false)
    .describe("Return only items with a story points value set (sprint-ready candidates)."),
  first: z.number().int().min(1).max(100).default(20),
  after: z.string().optional()
    .describe("Pagination cursor from a previous response."),
}).strict()
```

Pagination is exposed to the caller here (unlike sprint status / velocity) because the
backlog can be large and the agent works through it in chunks during refinement.

**Logic**:

```
isBacklogItem(item, sprintField.id)
  → no IterationValue for sprintField, OR iterationId is null
  → AND isArchived === false

extractPriorityValue(item, priorityField)
  → NumberField: numeric value (lower = higher priority)
  → SingleSelectField: option index within options array
  → missing: Infinity (sorts to end)

sortOrder:
  1. priority ascending  (items with priority set before items without)
  2. estimated before unestimated  (story points set before unset)
  3. createdAt ascending  (oldest first as tiebreaker)

clientCursor(index)
  → base64-encoded numeric index into the sorted list
  → since filtering is client-side, GitHub's server cursors cannot be reused here
```

**Output**:

```
## Product Backlog — 23 items not assigned to any sprint
_Showing 1–20 | Next page cursor: `MTk=`_

**Unestimated**: 8 items  |  **Estimated**: 15 items · 87 pts total

### Sprint-Ready (estimated)

| # | Title | Type | Points | Priority |
|---|---|---|---|---|
| #145 | Add OAuth scopes UI | Issue | 5 | High |
| #146 | Fix pagination on /users | Issue | 3 | High |

### Unestimated

| # | Title | Type | Status |
|---|---|---|---|
| #152 | Investigate Sentry errors | Issue | No Status |
```

---

### `github_bulk_update_item_field`

**Purpose**: Assigns a batch of items to a sprint iteration (or updates any other field)
in a single tool call. The primary write tool for sprint planning.

**Input schema**:

```typescript
z.object({
  project_id:    z.string().min(1).describe("Project node ID (PVT_kwDO...)"),
  item_ids:      z.array(z.string().min(1)).min(1).max(50)
    .describe("Project item node IDs (PVTI_lADO...). Max 50 per call."),
  field_id:      z.string().min(1).describe("Field node ID to update."),
  value:         FieldValueUnion,
  stop_on_error: z.boolean().default(false)
    .describe("Abort on first failure. Default false (best-effort across all items)."),
}).strict()
```

Max 50 items per call: safe within GitHub's 5,000 pt/hour GraphQL rate limit and covers
all practical sprint sizes. The agent makes multiple calls for larger batches.

**Safety integration**: When called from unstructured natural language context (i.e. the
agent is in `sprint-management` mode and the input came from Slack or a comment), the
`confirm-mutation` prompt must have been invoked and confirmed before this tool is called.
The tool description explicitly states this requirement so the model does not bypass it.

**Logic**:

```
for each item_id in item_ids (sequential — no parallelism):
  try:
    if value.type === "clear":
      clearProjectV2ItemFieldValue(...)
    else:
      updateProjectV2ItemFieldValue(...)
    results.push({ item_id, success: true })
  catch GitHubApiError as e:
    results.push({ item_id, success: false, error: e.message })
    if stop_on_error: break

return { succeeded, failed, results }
```

Sequential by design — parallel requests produce non-deterministic partial states on
failures and risk hitting secondary rate limits. 50 sequential mutations ≈ 2–3 seconds.

**Output (full success)**:

```
## Bulk Update — 12 / 12 succeeded

Field `Sprint` → Sprint 6 on 12 items

✅ PVTI_lADOxxx  #145 Add OAuth scopes UI
✅ PVTI_lADOyyy  #146 Fix pagination on /users
...
```

**Output (partial failure)**:

```
## Bulk Update — 10 / 12 succeeded · 2 failed

✅ 10 items updated.
❌ PVTI_lADOzzz — Item not found or already deleted
❌ PVTI_lADOwww — Field does not belong to this project

Succeeded items are committed. Re-run with only the failed IDs to retry.
```

---

## New Types (`src/types.ts`)

```typescript
// scrum.config.json shape (also used by Zod schema in scrum.ts)
export interface ScrumConfig {
  project:      { owner: string; owner_type: "user" | "org"; project_number: number };
  field_names:  { sprint: string; status: string; story_points: string; priority?: string };
  status_values: { done: string; in_progress: string; in_review: string; blocked: string; todo: string };
  sprint:       { duration_days: number; velocity_window: number; carry_over_threshold_days: number };
  autonomy:     { level: "conservative" | "standard" | "full"; require_confirmation_above_n_items: number };
  definition_of_done: string[];
}

// Resolved field IDs after name → ID mapping
export interface ResolvedScrumFields {
  sprintField:      ProjectV2Field;        // IterationField
  statusField:      ProjectV2Field;        // SingleSelectField
  storyPointsField: ProjectV2Field | null; // NumberField; null if not configured
  priorityField:    ProjectV2Field | null; // Number or SingleSelect
  doneOptionId:     string;
  blockedOptionId:  string | null;
}

// Per-iteration velocity entry
export interface IterationVelocity {
  iterationId:     string;
  title:           string;
  startDate:       string;
  durationDays:    number;
  committedPoints: number;
  completedPoints: number;
  completionRate:  number;   // 0–1
  isCurrent:       boolean;
}

// Sprint status aggregate
export interface SprintStatusResult {
  iteration:       { id: string; title: string; startDate: string; endDate: string };
  committedPoints: number;
  completedPoints: number;
  itemsByStatus:   Record<string, ProjectV2Item[]>;
  blockedItems:    ProjectV2Item[];
  carryOverItems:  ProjectV2Item[];
}

// Per-item result for bulk update
export interface BulkUpdateResult {
  item_id:  string;
  success:  boolean;
  error?:   string;
}
```

---

## Helper functions (`src/services/scrum.ts`)

```typescript
// Load and validate scrum.config.json; return defaults if absent
export async function loadScrumConfig(): Promise<ScrumConfig>

// Paginate all items from a project into a flat array
export async function fetchAllItems(
  owner: string, ownerType: "user" | "org", projectNumber: number
): Promise<ProjectV2Item[]>

// Resolve field names from config to GraphQL node IDs; throw descriptively on mismatch
export function resolveFields(
  fields: ProjectV2Field[], config: ScrumConfig
): ResolvedScrumFields

// Find the active iteration by date, or a specific one by ID
export function resolveTargetIteration(
  sprintField: ProjectV2Field, iterationId?: string
): { id: string; title: string; startDate: string; durationDays: number; endDate: string }

// Extract typed field values from an item
export function getNumberFieldValue(item: ProjectV2Item, fieldId: string): number | null
export function getStatusValue(item: ProjectV2Item, fieldId: string): string | null
export function getIterationValue(item: ProjectV2Item, fieldId: string): string | null

// Compute ISO date string from startDate + durationDays
export function computeEndDate(startDate: string, durationDays: number): string

// Client-side cursor encoding/decoding for backlog pagination
export function encodeCursor(index: number): string
export function decodeCursor(cursor: string): number
```

---

## File structure

```
scrum.config.json             Human-edited project configuration (committed)
sprint-current.md             Human-written sprint goal + capacity (committed, updated each sprint)

src/
├── index.ts                  + registerSprintPrompts(server) + registerScrumResources(server)
├── types.ts                  + ScrumConfig, ResolvedScrumFields, IterationVelocity,
│                               SprintStatusResult, BulkUpdateResult
├── tools/
│   ├── projects.ts           (unchanged)
│   ├── items.ts              (unchanged)
│   └── sprints.ts            NEW: github_get_sprint_status, github_get_velocity,
│                                  github_get_backlog_items, github_bulk_update_item_field
├── schemas/
│   └── inputs.ts             + GetSprintStatusSchema, GetVelocitySchema,
│                               GetBacklogItemsSchema, BulkUpdateItemFieldSchema
├── services/
│   ├── github.ts             (unchanged)
│   ├── formatters.ts         (unchanged)
│   └── scrum.ts              NEW: loadScrumConfig, fetchAllItems, resolveFields,
│                                  resolveTargetIteration, getters, cursor helpers
├── resources/
│   ├── config.ts             NEW: scrum://config resource registration
│   └── sprint.ts             NEW: scrum://sprint/current + scrum://sprint/archive/{n}
└── prompts/
    ├── classify.ts           NEW: scrum://prompts/classify-intent
    ├── confirm.ts            NEW: scrum://prompts/confirm-mutation
    └── workflows.ts          NEW: standup, backlog-refinement, sprint-planning,
                                   sprint-close, sprint-management
```

---

## Registration (`src/index.ts`)

```typescript
import { registerProjectTools }   from "./tools/projects.ts";
import { registerItemTools }       from "./tools/items.ts";
import { registerSprintTools }     from "./tools/sprints.ts";       // NEW
import { registerScrumResources }  from "./resources/index.ts";     // NEW
import { registerSprintPrompts }   from "./prompts/index.ts";       // NEW

const createMcpServer = (): McpServer => {
  const server = new McpServer({ name: "github-projects-mcp-server", version: "1.0.0" });

  registerProjectTools(server);
  registerItemTools(server);
  registerSprintTools(server);       // NEW
  registerScrumResources(server);    // NEW
  registerSprintPrompts(server);     // NEW

  return server;
};
```

---

## Implementation order

Order is sequenced so that each step is independently testable before the next depends on it.

1. **`scrum.config.json` + `sprint-current.md`** — create template files in the repo root with
   placeholder values; these unblock everything else

2. **`src/types.ts`** — add new interfaces (pure types, zero risk)

3. **`src/schemas/inputs.ts`** — add four Zod schemas (pure validation, zero risk)

4. **`src/services/scrum.ts`** — implement pure helper functions; test `loadScrumConfig`,
   `resolveFields`, `fetchAllItems` independently before the tools use them

5. **`src/resources/`** — `config.ts` then `sprint.ts`; verify with MCP Inspector that
   `scrum://config` returns the parsed JSON before building tools that depend on it

6. **`src/prompts/`** — `classify.ts`, `confirm.ts`, then `workflows.ts`; these are message
   templates and can be authored and reviewed without running code

7. **`src/tools/sprints.ts`** in this order:
   - `github_get_backlog_items` (no aggregation, simplest logic)
   - `github_bulk_update_item_field` (no field resolution, purely mechanical)
   - `github_get_sprint_status` (field resolution + aggregation)
   - `github_get_velocity` (builds on sprint_status logic)

8. **`src/index.ts`** — wire the three new register calls

9. **`README.md`** — promote planned tools to existing, add resources/prompts sections,
   update module architecture diagram to include the new directories

---

## Pre-implementation checklist

Taxonomy questions are answered by the MesseBuddy spec (see `scrum.config.json`).
Remaining items to confirm before writing code:

1. **GitHub field names must match `scrum.config.json` exactly** — values are derived
   from the spec's column headers. Confirm the GitHub Projects board has fields named
   exactly `"Sprint"`, `"Status"`, `"Est."`, `"Priority"`, `"Epic"`, `"Type"`. Update
   `field_names` in config if any name differs. Changes take effect immediately.

2. **GitHub logins in `team.members`** — `"login"` values must be actual GitHub
   usernames. Update `hoonsubin` and teammates' logins if they differ from the defaults.

3. **`"Est."` must be a Number field** in GitHub Projects (not text) — sprint point
   arithmetic requires numeric type. If created as text, recreate as number.

4. **Priority must be a Single Select field** with options named exactly
   `"Must Have"`, `"Should Have"`, `"Could Have"`, `"Won't Have"` (case-sensitive).

5. **`sprint.duration_days: null` is correct** — sprints are not all the same length.
   `resolveTargetIteration()` derives end dates from each iteration's own `duration`
   field in GitHub rather than a fixed config value.

6. **Autonomy level is `"standard"`** — autonomous for single unambiguous writes,
   confirmation for bulk and natural-language-triggered mutations. Adjust in config
   anytime; no restart needed.
