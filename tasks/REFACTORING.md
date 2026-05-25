# Tool Surface & Agent Behavioral Design — Redesign Proposal

## Problem Statements

### Item Lookup Requires Knowing Which Bucket the Item is in

`scrum_get_sprint` and `scrum_get_backlog` are separate tools representing separate "places." When the agent needs to find a specific item — or a filtered set of items — it does not know in advance whether those items are in the sprint or the unsprinted backlog. It must call both tools, receive two lists, and correlate. Only `scrum_get_backlog` has filter capability, which makes sprint-scoped filtering impossible without loading the full sprint list and filtering client-side.

### The sprint/backlog Split is a Platform Artifact, not a Scrum Concept

Scrum defines one Product Backlog. The Sprint Backlog is not a separate container — it is a time-bounded view of backlog items selected for the current sprint. Modelling sprint and backlog as separate tools leaks the GitHub Projects storage model (board columns, iteration fields) into the agent-facing contract, which is supposed to be platform-agnostic.

### `scrum_orient` Is a Setup Validator, not an Executive Summary

The current orient response answers: _"Is the platform correctly wired?"_ and _"What vocabulary does this team use?"_ It does not answer: _"What sprint are we in and how far along?"_, _"What epics are active?"_, or _"What is the current state of this project?"_ The agent has no temporal or thematic context after orient and must make additional calls to reconstruct basic situational awareness.

The primary purpose of this call is to address two challenges that only a language model can address:

- According to scrum vocabulary, we can make assumptions about the minimum requirement of a backlog taxonomy, but we cannot make any assumption on the additive properties (e.g., labels, types, tags, DoD, DoR, etc.). The scrum config and the actual platform API call made at the adapter layer fills in the missing gap and passes it to the agent.
- When a backlog is not ready to make the minimum required calls according to scrum vocabulary, the agent will know what is missing and how to handle it. This way, we ensure the MCP can function properly as a backlog management tool, while providing flexibility to the agent for team-specific taxonomy.

### Sprint Analytics Are Split across Two Tools with no Unifying Concept

`scrum_get_burndown` (intra-sprint, day-by-day) and `scrum_get_history` (inter-sprint, velocity snapshots) cover the same analytical domain — sprint performance — but are separate tools. An agent reasoning about capacity or velocity must call both and synthesize two different response shapes.

### Templates Are Served as a Tool Call

`scrum_get_template` returns document content — a static, addressable artifact that does not change between calls. Serving it as a tool conflates document retrieval with action invocation and fills a tool slot that adds no behavioural value.

### Building a Dependency Graph Requires O(N) Calls

Dependencies are modeled on the full item detail object (returned by `scrum_get_item_detail`) but are invisible at the list level. To construct a dependency graph for a sprint the agent must call `scrum_find_items` once to get item references, then call `scrum_get_item_detail` for every item to retrieve its `blocked_by` and `blocks` fields. For a 15-item sprint that is 16 calls. This is an N+1 pattern that scales with board size and defeats the purpose of a unified item search surface.

### `StoryRef` Accepts Only Opaque IDs — Human-Readable Numbers Require a Full Board Dump

`scrum_get_story` and all write tools that accept `StoryRef` require the opaque project-item handle (`PVTI_...`). This handle is never visible to the user. The only externally-visible ticket identifier — the GitHub issue number — is not an accepted input. When a user references items by number, the agent must call `scrum_get_sprint` or `scrum_get_backlog` to download the full board, scan for matching `ref.key` entries, and then extract the opaque IDs before it can act. Observed in practice: a two-ticket comparison becomes a seven-call interaction.

### Session Health Load Is Unconditional

The session start protocol (§6.1) unconditionally calls `scrum_get_backlog` after `scrum_orient`. For read-only, targeted requests — "compare these two tickets," "show me the body of ticket 42" — board health state is irrelevant. The unconditional load imposes unnecessary latency and noise on every session regardless of task type.

---

## Goals

1. **Single call for item retrieval.** The agent should be able to find any backlog item — regardless of sprint assignment — with one call and a set of filter parameters.
2. **Orient as executive summary.** After one `scrum_orient` call the agent has enough context to classify the session state: what sprint, how far in, what epics are live, what vocabulary and constraints the team uses.
3. **Clean separation of health view from item search.** Aggregate board health (readiness, impediments, risk signals) and item-centric search are different questions that warrant different tools with non-overlapping response shapes.
4. **Unified sprint analytics.** Historical velocity and current burndown are one analytical surface, not two.
5. **Templates as resources.** Template content is retrieved by URI, not by tool call.
6. **Alignment with scrum theory.** The tool surface should reflect the Scrum Guide's model: one Product Backlog, with sprint as the time dimension and epics as the space (thematic grouping) dimension.
7. **Single-call dependency graph.** The agent should be able to construct a full dependency graph for any set of items in one call. Out-of-scope dependency nodes (cross-sprint, cross-epic) must carry enough inline context for the agent to assess their state and decide whether a follow-up call is warranted — without being forced to fetch every node to answer basic questions like "is this blocker already done?"
8. **Direct lookup by human-readable number.** The agent must be able to retrieve one or more items by their issue number — the only identifier visible to users outside of titles — without first loading a complete item list.
9. **Task-driven health loading.** Board health state should be loaded only when the task requires it. Session start should not unconditionally pay the health-load cost for targeted read-only requests.

---

## Mental Model

### The Backlog is the Single Source of Truth

Every item — user story, bug, spike, tech debt — is a Product Backlog Item (PBI). There is no separate "sprint container." Sprint assignment is a field on the item, equivalent to a time-dimension filter. Querying "items in the current sprint" is `find_items(scope=sprint)`, not a call to a different tool.

### Epics Are the Space Dimension

An epic groups related PBIs under a theme or delivery goal. Epics span multiple sprints. They are not items themselves; they are a grouping axis. The agent needs to know which epics are active to reason about prioritization, sequencing, and thematic coherence.

### Sprint is the time Dimension

The sprint is a time-box. Sprint metadata (name, goal, start date, duration, days remaining) is project-level state, not item-level state. It belongs in the orient response, not attached to individual items.

### Item Types

The recognized PBI types are: `user_story`, `bug`, `spike`, `tech_debt`. These are strict, config-anchored values. `impediment` is a first-class artifact with its own lifecycle and is not a PBI type per se, as a team may decide to keep a separate backlog to track these, or tack them on the same board with different labels. But as far as the agent is concerned, an impediment is something it should always be aware of. Type vocabulary is declared in `scrum_orient` via `vocabulary.type`.

### The Agent's Intelligence Boundary

The MCP server is a semi-stateless (depending on the adapter requirements) fact layer. It returns current project state accurately and efficiently. It does not interpret, recommend, or reason. That is exclusively the agent's role. The server's job is to make the agent's reasoning as cheap as possible by returning well-structured, semantically complete snapshots.

---

## Tool Surface — Framework Layer

### Summary of Changes

| Tool                      | Change                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `scrum_orient`            | **Enhanced** — adds sprint time-progress, sprint-scoped active epics, template resource URIs         |
| `scrum_get_backlog`       | **Renamed** to `scrum_get_board_health` — health/aggregate view only; no item lists                  |
| `scrum_get_sprint`        | **Removed** — item retrieval replaced by `scrum_find_items`; sprint metadata moved to `scrum_orient` |
| `scrum_find_items`        | **New** — unified item search across all PBIs with filter parameters                                 |
| `scrum_get_story`         | **Renamed** to `scrum_get_item_detail` — input accepts `number` in addition to opaque `id`           |
| `scrum_get_burndown`      | **Merged** into `scrum_get_analytics`                                                                |
| `scrum_get_history`       | **Merged** into `scrum_get_analytics`                                                                |
| `scrum_get_analytics`     | **New** — unified sprint analytics (burndown + velocity history)                                     |
| `scrum_get_template`      | **Removed** — replaced by `scrum://template/{type}` resource                                         |
| `scrum://template/{type}` | **New resource** — template documents addressable by item type                                       |

**Net change:** 7 read tools → 5 read tools + 1 resource type. `scrum_get_backlog` renamed to `scrum_get_board_health`; `scrum_get_story` renamed to `scrum_get_item_detail` with extended input contract.

---

### `scrum_orient` — Enhanced

**Role:** Executive summary and session ground truth. Called once at session start. Returns everything the agent needs to understand project structure, vocabulary, temporal position, and thematic context — without loading any items.

**Call contract:** One call per session. Re-called only after structural mutations (e.g., `scrum_add_vocabulary`). Not re-called mid-workflow.

**Input:** None (reads from backend platform state + scrum config).

**Output shape:**

```
OrientResult {
  platform_state: {
    fields: {
      status:       { exists: bool, options: string[], missing_options: string[] }
      sprint:       { exists: bool }
      story_points: { exists: bool }
      priority:     { exists: bool, options: string[], missing_options: string[] }
    }
    missing_options: string[]           // convenience: concat of all missing field options
    labels: {
      existing: string[]
      expected: string[]
      missing: string[]
    }
    iterations: {
      active: SprintContext | null
      next:   SprintRef | null
      completed_count: number
    }
    epics: {                            // NEW
      active: EpicSummary[]            // sprint-scoped: only epics with ≥1 item in the active sprint
                                       // fallback: all open epics when no active sprint exists,
                                       // or when sprint-scoped query is too expensive for the adapter
      total_count: number
    }
  }
  vocabulary: {
    status:        Record<string, string> | null
    priority:      Record<string, string> | null
    type:          Record<string, string> | null
    story_points:  { scale: string | null, values: number[] | null }
    sprint:        { length_weeks: number | null, velocity_window: number }
    team:          TeamConfig | null
    dor:           DefinitionOfReady | null
    dod:           DefinitionOfDone | null
    autonomy:      AgentAutonomy | null
    template_uris: TemplateUriMap | null  // partial — only types with a declared template; null when none configured
  }
}
```

**Key additions over current:**

- `platform_state.iterations.active` now includes `days_elapsed`, `days_remaining`, `time_elapsed_pct` (computed from `start_date` + `duration_days` + today; no new backend calls)
- `platform_state.epics` — epics that have at least one item in the active sprint, with names, descriptions, and open item counts (one additional backend call). Purpose: give the agent thematic context relevant to the current sprint, not a full epic dump. Fallback to all open epics when there is no active sprint or when the adapter cannot efficiently perform the sprint-scoped query.
- `vocabulary.template_uris` — partial map of item type → `scrum://template/{type}` URI. Only types with a team-declared template file appear in this map. When `null`, no templates are configured and the agent uses its own built-in defaults. Replaces the flat `templates:` ceremony map from the old orient response.

---

### `scrum_get_board_health` — Renamed

**Role:** Board health dashboard. Returns aggregate metrics and risk signals about the current backlog state. Does **not** return item lists — that is `scrum_find_items`' responsibility. Renamed from `scrum_get_backlog` to eliminate the naming confusion between "retrieve items from the backlog" and "assess the health of the board."

**Input:** None (or optional `sprint_scope: "current" | "all"` for health metrics).

**Output shape:**

```
BacklogHealth {
  readiness: {
    by_type: Record<ItemType, { ready: number, not_ready: number, total: number }>
    overall_pct: number
  }
  sprint_risk: {                        // only populated when a sprint is active
    unestimated_count: number
    blocked_count: number               // items whose status field value equals the "Blocked" vocabulary option;
                                        // derived from shallow status field, not from dependency graph resolution
    no_assignee_count: number
  }
  impediments: {
    orphan_count: number                // unlinked, unresolved impediments
    open_count: number
  }
  ungroomed_count: number               // items with no type, no estimate, no AC
}
```

**Design note:** No item lists. If the agent needs to act on a health signal (e.g., "3 unestimated items in sprint"), it follows up with `scrum_find_items(scope="sprint", estimated=false)`. Health view and item retrieval are always separate calls.

---

### `scrum_find_items` — New

**Role:** Item-centric search across the entire Product Backlog. The agent's primary tool for retrieving items regardless of sprint assignment. Replaces `scrum_get_sprint` as the item retrieval surface.

**Input:**

```
ItemFilter {
  scope:                "backlog" | "sprint" | "all"    // "backlog" = unsprinted; "sprint" = active sprint; "all" = both
                        default: "all"
  keys:                 string[]                         // optional; OR filter on human-readable issue number — e.g. ["108", "115"]
                                                         // takes priority over scope; returns matching items regardless of bucket
  search:               string                           // optional; substring match against item title
  type:                 ItemType[]                       // optional; multi-value OR filter
  status:               string[]                         // optional; values from vocabulary.status
  epic_id:              string                           // optional; filter by epic/milestone
  label:                string[]                         // optional; multi-value AND filter
  assignee:             string                           // optional; GitHub username or team name
  estimated:            bool                             // optional; true = has SP, false = missing SP
  sprint_ref:           "current" | "next" | SprintId   // optional; overrides scope for past sprint lookup
  include_dependencies: bool                             // optional; default false — when true, response includes dependency_map
  limit:                number                           // optional; default 50
}
```

**Output shape:**

```
ItemSearchResult {
  items: BacklogItemListing[]
  total_count: number
  scope_summary: {                        // which bucket(s) contributed
    sprint_count: number | null
    backlog_count: number | null
  }
  dependency_map: DependencyMap | null    // populated only when include_dependencies=true
}
```

**Design note:** Returns `BacklogItemListing` entries — richer than a bare `StoryRef`, lighter than full item detail. Standard fields cover the information needed for list-level reasoning (type, status, sprint, epic, dependency refs); `custom_fields` carries any additional team-declared properties from `scrum_orient`. The agent calls `scrum_get_item_detail` only when it needs the full body, AC, comments, or audit trail for a specific item. `dependency_map` is opt-in to avoid paying full graph resolution cost on every list call.

When a user references tickets by number (e.g., "Ticket 108 and 115"), the agent uses `keys` to look them up directly rather than dumping the full board:

```
// Before (7 calls): orient → get_story×2 (fail) → get_sprint + get_backlog → get_story×2
// After (1 call):
scrum_find_items({ keys: ["108", "115"] })
→ { items: [BacklogItemListing, BacklogItemListing], ... }
```

`keys` takes priority over `scope` — it returns the matching items regardless of which bucket they are in. `search` covers the adjacent "I remember the topic but not the number" case.

---

### `scrum_get_item_detail` — Renamed and Updated Input Contract

**Role:** Full detail of one backlog item of any type: body, acceptance criteria, comments, linked PRs, impediments, audit trail.

**Input:** `ref: { id: string } | { number: number }`

- `id` — the opaque project-item handle (`PVTI_...`) from `BacklogItemListing.ref.id`. Use this when the agent already holds a listing entry.
- `number` — the human-readable issue number visible to the user (e.g. `108`). Use this for direct single-item lookup when no prior list call has been made.

The tool description must guide the agent on this choice explicitly. When the user names a single ticket by number and full detail is needed immediately (body, AC, comments), `scrum_get_item_detail({ number: 108 })` is correct. When the agent already holds a `BacklogItemListing` from `scrum_find_items`, it should prefer `id` to avoid a redundant resolution step.

**Output shape:** unchanged from prior `scrum_get_story`.

---

### `scrum_get_analytics` — New (merges Burndown + history)

**Role:** Sprint performance analytics. Covers both intra-sprint progress (burndown) and inter-sprint velocity (history). Unified because both questions are about sprint delivery performance and are often consulted together (e.g., "are we on track this sprint given our historical velocity?").

**Input:**

```
AnalyticsQuery {
  view: "burndown" | "history" | "both"   // default: "both"
  sprint_ref: "current" | SprintId        // for burndown; default: "current"
  history_window: number                  // for history; sprint count; default: velocity_window from config
}
```

**Output shape:**

```
AnalyticsResult {
  burndown: BurndownSeries | null         // null when view="history"
  history:  SprintSnapshot[] | null      // null when view="burndown"
}
```

Existing `BurndownSeries` and `SprintSnapshot` types are preserved unchanged.

---

### `scrum://template/{type}` — New Resource

**Role:** Per-type instructional content that tells the agent how to construct a PBI of that type. Replaces `scrum_get_template`. These are not fillable markdown templates — they describe the expected structure, acceptance criteria conventions, and quality signals for each item type, and are intended to be read and interpreted by the agent, not rendered to the user.

**URI pattern:** `scrum://template/{type}` where `{type}` is a PBI type key from `vocabulary.type` (e.g., `scrum://template/user_story`, `scrum://template/bug`).

**Content source:** Each backend declares template file paths alongside display names in its type configuration (e.g., `backends.github.type_mapping[type].template`). The server fetches the declared file from the managed repo at read time. This means teams control the template content by committing files to their repo (e.g., `.github/ISSUE_TEMPLATE/feature.md`). Template paths are backend-specific — different backends may point to different files for the same type.

**Discovery:** Available URIs are listed in `scrum_orient` under `vocabulary.template_uris`. The map is partial — only types with a declared template file appear. A missing key means the agent falls back to its built-in default for that type. The agent does not need a separate resource listing call.

**Why resource, not tool:** Templates are documents — stable, cacheable, addressable by a deterministic key. They do not change between requests and are not query results. The resource primitive is semantically correct here, unlike item lists which are dynamic query results.

---

## Data Types — Framework Layer

Types relevant to the new and changed surfaces. Write tools and unchanged read tools carry over their existing types without modification.

### New Types

```typescript
// Sprint context enriched with time-progress (in scrum_orient)
interface SprintContext {
  id: string;
  name: string;
  goal: string | null;
  start_date: string; // ISO date
  duration_days: number;
  days_elapsed: number; // computed: today - start_date
  days_remaining: number; // computed: (start_date + duration_days) - today
  time_elapsed_pct: number; // days_elapsed / duration_days * 100
}

// Lightweight epic summary (in scrum_orient)
interface EpicSummary {
  id: string;
  name: string;
  description: string | null;
  open_item_count: number;
}

// Template URI map (in scrum_orient vocabulary)
// Partial — only types with a team-declared template file are included.
// A missing key means no template is configured for that type; the agent uses its own default.
type TemplateUriMap = Partial<Record<ItemType, ScrumTemplateUri>>;
// e.g. { feature: "scrum://template/feature", bug: "scrum://template/bug" }
// (user_story absent → no template declared for that type)

// Backlog health (scrum_get_board_health output)
interface BacklogHealth {
  readiness: {
    by_type: Record<ItemType, { ready: number; not_ready: number; total: number }>;
    overall_pct: number;
  };
  sprint_risk: {
    unestimated_count: number;
    blocked_count: number;
    no_assignee_count: number;
  } | null;
  impediments: {
    orphan_count: number;
    open_count: number;
  };
  ungroomed_count: number;
}

// Enriched list entry returned by scrum_find_items — richer than StoryRef, lighter than full item detail.
// Standard fields are fixed; custom_fields carries any additional properties declared in scrum_orient
// vocabulary (e.g. team-specific labels, priority variants). The agent knows which keys to expect
// from the orient response and can interpret them without the server hardcoding every possible field.
interface BacklogItemListing {
  ref: { id: string; key: string }; // both always present for on-board items
  title: string;
  type: string | null;
  status: string | null;
  story_points: number | null;
  assignees: string[];
  labels: string[];
  sprint: { ref: { id: string }; name: string } | null; // ref+name pair; null = unsprinted
  epic: { ref: EpicRef; name: string } | null;
  blocked_by: Array<{ id: string; key: string }>; // upstream items this one is waiting on
  blocks: Array<{ id: string; key: string }>; // downstream items waiting on this one
  custom_fields: Record<string, string | number | boolean | null>; // team-declared fields from orient
}

// A single node in the dependency graph — keyed by issue number (key), not opaque item ID.
// Using key as the canonical node identifier guarantees the field is always present
// (ref.id is nullable for unresolved items; see §7 known issue).
interface DependencyNode {
  key: string; // issue number — stable, human-readable, always present
  title: string | null; // resolved at parse time from DependencyEntry; null if unknown

  // State signals — populated for all in-project items (resolved or not);
  // null only for items genuinely outside the project (cross-repo, off-board)
  status: string | null; // e.g. "Done", "In Progress" — primary fetch-or-skip signal
  sprint: string | null; // sprint name, or null if in backlog
  epic_name: string | null; // epic name, or null if ungrouped

  resolved: boolean; // true = full BacklogItemListing present in items[]; false = partial node
  blocks: string[]; // keys of downstream items (this item must finish first)
  blocked_by: string[]; // keys of upstream items (those must finish before this one)
}

// Full dependency graph — map of issue key → node.
// Covers all items in the result set plus any out-of-scope dependencies they reference.
type DependencyMap = Record<string, DependencyNode>;

// Item filter (scrum_find_items input)
interface ItemFilter {
  scope?: "backlog" | "sprint" | "all";
  keys?: string[]; // OR filter on human-readable issue number; e.g. ["108", "115"]
  // ignores scope — returns matching items regardless of bucket
  search?: string; // substring match against item title
  type?: ItemType[];
  status?: string[];
  epic_id?: string;
  label?: string[];
  assignee?: string;
  estimated?: boolean;
  sprint_ref?: "current" | "next" | string;
  include_dependencies?: boolean; // default false
  limit?: number;
}

// Item search result (scrum_find_items output)
interface ItemSearchResult {
  items: BacklogItemListing[];
  total_count: number;
  scope_summary: {
    sprint_count: number | null;
    backlog_count: number | null;
  };
  dependency_map: DependencyMap | null; // null unless include_dependencies=true
}

// Analytics query input
interface AnalyticsQuery {
  view?: "burndown" | "history" | "both";
  sprint_ref?: "current" | string;
  history_window?: number;
}

// Analytics result (scrum_get_analytics output)
interface AnalyticsResult {
  burndown: BurndownSeries | null;
  history: SprintSnapshot[] | null;
}
```

### Modified Types

```typescript
// StoryRef — extended to accept human-readable issue number as an alternative to opaque id.
// Used as input to scrum_get_item_detail and all write tools that target a specific item.
// No longer requires a prior list call when the user provides a number.
type StoryRef =
  | { id: string } // opaque PVTI_ handle from any prior list or write call
  | { number: number }; // GitHub issue number visible to the user (e.g. 108)
```

### Preserved Types (no change)

- `DependencyEntry` — the existing per-edge type on `StoryBase`; remains unchanged on full item detail objects returned by `scrum_get_item_detail`
- `BurndownSeries` — day-by-day burndown with ideal line
- `SprintSnapshot` — completed sprint aggregate (points completed, velocity)
- `ImpedimentRef` — impediment lightweight reference
- `ItemType` — `"user_story" | "bug" | "spike" | "tech_debt"`

### Removed Types

- `OrientResult.vocabulary.templates` — replaced by `TemplateUriMap`
- Sprint-as-container types (any type modelling sprint as an independent retrieval unit)

### Known Type Issue — `DependencyEntry.ref.id` is Nullable

`DependencyEntry.ref.id` is typed `string | null` in `domain/types.ts` and is inconsistently populated across the project (acknowledged in a comment at line 65). This is a latent bug: any graph traversal that relies on `ref.id` as a node key silently breaks for null entries.

`DependencyMap` deliberately uses `key` (the human-readable issue number) as the canonical node identifier precisely to avoid this. `ref.id` remains on `DependencyEntry` for `scrum_get_item_detail` responses where the adapter can reliably resolve it, but it must never be used as a primary graph key. Fixing the nullable inconsistency is an implementation-phase concern.

---

## Agent Behavioral Design — Agent Layer

### Session Start Protocol

On every session start, the agent executes three steps in order:

1. **`scrum_orient`** — load project structure, vocabulary, sprint context, active epics, and template URIs. This is the session's ground truth.
2. **Gap check** — inspect `platform_state.missing_options` and `labels.missing`. If structural gaps exist, surface them before proceeding.
3. **Classify and route** — classify the incoming request type and route to the matching playbook.

`scrum_orient` is called **once per session**. It is not re-called mid-workflow. The only exception is after a structural mutation (`scrum_add_vocabulary`) that would change the orient result.

**`scrum_get_board_health` is task-triggered, not session-triggered.** It is called only by playbooks that require board health state: sprint planning, backlog refinement, retrospective prep, and session health classification when the task is ambiguous. It is not called for targeted read-only requests (item lookup, story detail, duplicate analysis) or for write operations that target specific known items. This distinction prevents paying the health-load cost on every session regardless of task type.

| Task type                                      | `scrum_get_board_health` called?        |
| ---------------------------------------------- | --------------------------------------- |
| Sprint planning / refinement                   | Yes — health signals are required input |
| Retrospective / ceremony prep                  | Yes — board state is required input     |
| "Show me ticket X" / item lookup               | No                                      |
| "Compare tickets X and Y" / duplicate analysis | No                                      |
| Write operation on a named item                | No                                      |
| Ambiguous / open-ended request                 | Yes — classify session health first     |

### Direct Lookup Pattern

When a user references items by number, the agent uses `scrum_find_items` with `keys` for multi-item lookup, or `scrum_get_item_detail` with `number` for single-item full-detail requests. It never dumps the full board to resolve a number.

```
// User: "Tickets 108 and 115 overlap — merge recommendation?"
scrum_find_items({ keys: ["108", "115"] })
→ 2× BacklogItemListing (title, type, status, sprint, epic, dependency refs, ...)
// Agent assesses overlap from listing data.
// If full body/AC comparison is needed:
scrum_get_item_detail({ number: 108 })
scrum_get_item_detail({ number: 115 })

// User: "Show me the body of ticket 42"
scrum_get_item_detail({ number: 42 })
// Direct — no prior list call needed.
```

The lookup ladder: `keys` (multi-item, list detail) → `scrum_get_item_detail({ number })` (single item, full detail). Each step is only taken if the previous level of detail is insufficient for the task.

### Item Retrieval Pattern

The agent never assumes which bucket an item is in. All item searches go through `scrum_find_items`. The default scope is `"all"`.

```
// Before: agent tries both tools
scrum_get_sprint()         → filter client-side
scrum_get_backlog()        → filter client-side

// After: one call
scrum_find_items({ type: ["bug"], status: ["in_progress"] })
```

For full item detail the agent follows up with `scrum_get_item_detail`. It does not work from list-level data for actions that require body, AC, or comments.

### Orient as Temporal Anchor

The `time_elapsed_pct` field from `SprintContext` feeds directly into the agent's sprint risk assessment. The agent does not compute time-based risk from raw dates — it reads the pre-computed signal and maps it to a stance:

| `time_elapsed_pct` | Agent stance                                                      |
| ------------------ | ----------------------------------------------------------------- |
| < 40%              | Normal — focus on readiness and unblocking                        |
| 40–70%             | Monitor — cross-check `sprint_risk` from `scrum_get_board_health` |
| > 70%              | Elevated — proactively surface unfinished items and scope risk    |

This mapping is encoded in the agent's playbooks, not in the MCP server.

### Epic Context in Prioritization

When the agent makes a prioritization recommendation, active epics from `scrum_orient` are a required input alongside sprint goal and deadlines. An item that advances an active epic with no other in-flight items gets a thematic coherence signal that increases its recommendation weight. The `open_item_count` on each epic is the signal — it tells the agent whether momentum on that epic is stalling.

### Template Discovery and Usage

Template URIs are discovered from `vocabulary.template_uris` in the `scrum_orient` response. When drafting a new item the agent checks this map first. If a URI exists for the requested type, the agent reads the resource to get the team's instructional content for constructing that item type. If the type is absent from the map (no template declared), the agent falls back to its own built-in defaults for that type — it does not call the resource.

Template content is instructional, not prescriptive. The agent interprets it to understand the team's conventions for that item type (e.g., expected AC format, required fields, definition-of-ready signals) and uses that to construct a well-formed item. The agent should not render the raw template content to the user.

### Analytics Usage

`scrum_get_analytics` is called when the agent needs to reason about capacity or historical delivery rate. This is triggered by: sprint planning requests, velocity-based estimation, capacity questions, or burndown review. It is not called during routine board management sessions.

### Dependency Graph Pattern

When the agent needs to reason about item relationships — blocked work, delivery sequencing, cross-epic dependencies — it uses a single call:

```
scrum_find_items({ scope: "sprint", include_dependencies: true })
→ { items: BacklogItemListing[], dependency_map: DependencyMap }
```

The `dependency_map` covers every node in the graph: items in the result set (`resolved: true`) and out-of-scope dependencies they reference (`resolved: false`). For any unresolved node the agent uses the inline state signals to make a fetch-or-skip decision before making any additional call:

| Unresolved node signals                       | Agent decision                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `status: "Done"`                              | Blocker is resolved. No follow-up needed.                                                                                     |
| `status: "In Progress"`, `sprint: "Sprint N"` | Active in another sprint. Fetch if sprint health is relevant to the current task.                                             |
| `status: "In Progress"`, `sprint: null`       | Active but unscheduled — a backlog risk. Surface to the team; fetch full detail if actioning it.                              |
| `status: null`                                | Item is external to the project. Agent notes the dependency but cannot resolve it via MCP.                                    |
| `epic_name: "X"` on unresolved node           | Cross-epic dependency. Use `scrum_find_items({ epic_id: X })` for full context, not `scrum_get_item_detail` on a single item. |

The agent calls `scrum_get_item_detail` on a dependency node only when it needs the full detail (body, AC, audit trail) to take a specific action — not merely to determine whether the dependency is active.

---

## Out of Scope

The following are acknowledged design concerns but are **not addressed in this proposal**. They are captured here to avoid re-litigating them in future sessions.

- **Backend implementation of `scrum_find_items`** — how GitHub Projects' GraphQL API is queried to support the unified filter. Implementation concern.
- **Backend implementation of epic enumeration in `scrum_orient`** — fetching milestone/epic data alongside platform state. Implementation concern.
- **`scrum://template/{type}` resource registration** — how `server.registerResourceTemplate()` is wired in `index.ts`. Implementation concern.
- **`scrum_get_board_health` health metrics computation** — what backend queries are needed to count unestimated, blocked, and orphaned items. Implementation concern.
- **Config-driven type vocabulary extension** — the `ItemType` union is currently hardcoded. Future extension point: `vocabulary.type` in scrum config drives the allowed values dynamically. Out of scope for this iteration.
- **Stateful orient comparison server** — logging orient snapshots and diffing them across sessions to surface structural changes. Not a function of the MCP server (which is stateless). Valid future agent infrastructure pattern.
