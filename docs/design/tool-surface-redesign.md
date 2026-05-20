# Tool Surface & Agent Behavioral Design — Redesign Proposal

**Status:** Draft\
**Scope:** Framework layer (MCP tool surface) and Agent layer (behavioral design)\
**Out of scope:** Adapter implementation, backend query changes, GitHub-specific concerns

---

## 1. Problem Statements

### 1.1 Item lookup requires knowing which bucket the item is in

`scrum_get_sprint` and `scrum_get_backlog` are separate tools representing separate "places." When the agent needs to find a specific item — or a filtered set of items — it does not know in advance whether those items are in the sprint or the unsprinted backlog. It must call both tools, receive two lists, and correlate. Only `scrum_get_backlog` has filter capability, which makes sprint-scoped filtering impossible without loading the full sprint list and filtering client-side.

### 1.2 The sprint/backlog split is a platform artifact, not a scrum concept

Scrum defines one Product Backlog. The Sprint Backlog is not a separate container — it is a time-bounded view of backlog items selected for the current sprint. Modelling sprint and backlog as separate tools leaks the GitHub Projects storage model (board columns, iteration fields) into the agent-facing contract, which is supposed to be platform-agnostic.

### 1.3 `scrum_orient` is a setup validator, not an executive summary

The current orient response answers: _"Is the platform correctly wired?"_ and _"What vocabulary does this team use?"_ It does not answer: _"What sprint are we in and how far along?"_, _"What epics are active?"_, or _"What is the current state of this project?"_ The agent has no temporal or thematic context after orient and must make additional calls to reconstruct basic situational awareness.

### 1.4 Sprint analytics are split across two tools with no unifying concept

`scrum_get_burndown` (intra-sprint, day-by-day) and `scrum_get_history` (inter-sprint, velocity snapshots) cover the same analytical domain — sprint performance — but are separate tools. An agent reasoning about capacity or velocity must call both and synthesize two different response shapes.

### 1.5 Templates are served as a tool call

`scrum_get_template` returns document content — a static, addressable artifact that does not change between calls. Serving it as a tool conflates document retrieval with action invocation and fills a tool slot that adds no behavioural value.

### 1.6 Building a dependency graph requires O(N) calls

Dependencies are modelled on the full `Story` object (returned by `scrum_get_story`) but are invisible at the list level. To construct a dependency graph for a sprint the agent must call `scrum_find_items` once to get item references, then call `scrum_get_story` for every item to retrieve its `blocked_by` and `blocks` fields. For a 15-item sprint that is 16 calls. This is an N+1 pattern that scales with board size and defeats the purpose of a unified item search surface.

---

## 2. Goals

1. **Single call for item retrieval.** The agent should be able to find any backlog item — regardless of sprint assignment — with one call and a set of filter parameters.
2. **Orient as executive summary.** After one `scrum_orient` call the agent has enough context to classify the session state: what sprint, how far in, what epics are live, what vocabulary and constraints the team uses.
3. **Clean separation of health view from item search.** Aggregate board health (readiness, impediments, risk signals) and item-centric search are different questions that warrant different tools with non-overlapping response shapes.
4. **Unified sprint analytics.** Historical velocity and current burndown are one analytical surface, not two.
5. **Templates as resources.** Template content is retrieved by URI, not by tool call.
6. **Alignment with scrum theory.** The tool surface should reflect the Scrum Guide's model: one Product Backlog, with sprint as the time dimension and epics as the space (thematic grouping) dimension.
7. **Single-call dependency graph.** The agent should be able to construct a full dependency graph for any set of items in one call. Out-of-scope dependency nodes (cross-sprint, cross-epic) must carry enough inline context for the agent to assess their state and decide whether a follow-up call is warranted — without being forced to fetch every node to answer basic questions like "is this blocker already done?"

---

## 3. Mental Model

### The backlog is the single source of truth

Every item — user story, bug, spike, tech debt — is a Product Backlog Item (PBI). There is no separate "sprint container." Sprint assignment is a field on the item, equivalent to a time-dimension filter. Querying "items in the current sprint" is `find_items(scope=sprint)`, not a call to a different tool.

### Epics are the space dimension

An epic groups related PBIs under a theme or delivery goal. Epics span multiple sprints. They are not items themselves; they are a grouping axis. The agent needs to know which epics are active to reason about prioritization, sequencing, and thematic coherence.

### Sprint is the time dimension

The sprint is a time-box. Sprint metadata (name, goal, start date, duration, days remaining) is project-level state, not item-level state. It belongs in the orient response, not attached to individual items.

### Item types

The recognized PBI types are: `user_story`, `bug`, `spike`, `tech_debt`. These are strict, config-anchored values. `impediment` is a first-class artifact with its own lifecycle and is not a PBI type. Type vocabulary is declared in `scrum_orient` via `vocabulary.type`.

### The agent's intelligence boundary

The MCP server is a stateless fact layer. It returns current project state accurately and efficiently. It does not interpret, recommend, or reason. That is exclusively the agent's role. The server's job is to make the agent's reasoning as cheap as possible by returning well-structured, semantically complete snapshots.

---

## 4. Tool Surface — Framework Layer

### 4.1 Summary of changes

| Tool                      | Change                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `scrum_orient`            | **Enhanced** — adds sprint time-progress, active epics, template resource URIs                       |
| `scrum_get_backlog`       | **Narrowed** — health/aggregate view only; no item lists                                             |
| `scrum_get_sprint`        | **Removed** — item retrieval replaced by `scrum_find_items`; sprint metadata moved to `scrum_orient` |
| `scrum_find_items`        | **New** — unified item search across all PBIs with filter parameters                                 |
| `scrum_get_story`         | **Unchanged**                                                                                        |
| `scrum_get_burndown`      | **Merged** into `scrum_get_analytics`                                                                |
| `scrum_get_history`       | **Merged** into `scrum_get_analytics`                                                                |
| `scrum_get_analytics`     | **New** — unified sprint analytics (burndown + velocity history)                                     |
| `scrum_get_template`      | **Removed** — replaced by `scrum://template/{type}` resource                                         |
| `scrum://template/{type}` | **New resource** — template documents addressable by item type                                       |

**Net change:** 7 read tools → 5 read tools + 1 resource type.

---

### 4.2 `scrum_orient` — Enhanced

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
      active: EpicSummary[]
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
    template_uris: TemplateUriMap      // NEW — replaces templates: { sprint_review, ... }
  }
}
```

**Key additions over current:**

- `platform_state.iterations.active` now includes `days_elapsed`, `days_remaining`, `time_elapsed_pct` (computed from `start_date` + `duration_days` + today; no new backend calls)
- `platform_state.epics` — active epics with names, descriptions, item counts (one additional backend call)
- `vocabulary.template_uris` — map of item type → `scrum://template/{type}` URI, replacing the static template path map; gives the agent a discovery surface for resources without a separate listing call

---

### 4.3 `scrum_get_backlog` — Narrowed

**Role:** Board health dashboard. Returns aggregate metrics and risk signals about the current backlog state. Does **not** return item lists — that is `scrum_find_items`' responsibility.

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
    blocked_count: number
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

### 4.4 `scrum_find_items` — New

**Role:** Item-centric search across the entire Product Backlog. The agent's primary tool for retrieving items regardless of sprint assignment. Replaces `scrum_get_sprint` as the item retrieval surface.

**Input:**

```
ItemFilter {
  scope:                "backlog" | "sprint" | "all"    // "backlog" = unsprinted; "sprint" = active sprint; "all" = both
                        default: "all"
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
  items: StoryListing[]
  total_count: number
  scope_summary: {                        // which bucket(s) contributed
    sprint_count: number | null
    backlog_count: number | null
  }
  dependency_map: DependencyMap | null    // populated only when include_dependencies=true
}
```

**Design note:** Returns `StoryListing` (enriched list entries) rather than bare `StoryRef`. This provides enough node data — title, type, status, epic — for the agent to reason over the result set without fetching individual stories. `dependency_map` is opt-in to avoid paying the resolution cost on every list call. The agent calls `scrum_get_story` only when it needs full detail (body, AC, comments, audit trail) on a specific item.

---

### 4.5 `scrum_get_story` — Unchanged

**Role:** Full detail of one PBI: body, acceptance criteria, comments, linked PRs, impediments, audit trail.

**Input:** `story_id: string`

No changes to this tool.

---

### 4.6 `scrum_get_analytics` — New (merges burndown + history)

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

### 4.7 `scrum://template/{type}` — New Resource

**Role:** Item body templates addressable by PBI type. Replaces `scrum_get_template`.

**URI pattern:** `scrum://template/{type}` where `{type}` is a value from `vocabulary.type` (e.g., `scrum://template/user_story`, `scrum://template/bug`).

**Discovery:** Available URIs are listed in `scrum_orient` under `vocabulary.template_uris`. The agent does not need a separate resource listing call.

**Why resource, not tool:** Templates are documents — stable, cacheable, addressable by a deterministic key. They do not change between requests and are not query results. The resource primitive is semantically correct here, unlike item lists which are dynamic query results.

---

## 5. Data Types — Framework Layer

Types relevant to the new and changed surfaces. Write tools and unchanged read tools carry over their existing types without modification.

### 5.1 New types

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
type TemplateUriMap = Record<ItemType, string>;
// e.g. { user_story: "scrum://template/user_story", bug: "scrum://template/bug", ... }

// Backlog health (scrum_get_backlog output)
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

// Enriched list entry returned by scrum_find_items — richer than StoryRef, lighter than full Story
interface StoryListing {
  ref: { id: string; key: string | null }; // key is the human-readable issue number (e.g. "42")
  title: string;
  type: string | null;
  status: string | null;
  story_points: number | null;
  assignees: string[];
  epic: { ref: EpicRef; name: string } | null;
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

  resolved: boolean; // true = full StoryListing present in items[]; false = partial node
  blocks: string[]; // keys of downstream items (this item must finish first)
  blocked_by: string[]; // keys of upstream items (those must finish before this one)
}

// Full dependency graph — map of issue key → node.
// Covers all items in the result set plus any out-of-scope dependencies they reference.
type DependencyMap = Record<string, DependencyNode>;

// Item filter (scrum_find_items input)
interface ItemFilter {
  scope?: "backlog" | "sprint" | "all";
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
  items: StoryListing[];
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

### 5.2 Preserved types (no change)

- `StoryRef` — still used as the return type of write tools (`scrum_create_story`, etc.) and as the input handle for `scrum_get_story`; no longer the list result type for `scrum_find_items`
- `DependencyEntry` — the existing per-edge type on `StoryBase`; remains unchanged on full `Story` objects returned by `scrum_get_story`
- `BurndownSeries` — day-by-day burndown with ideal line
- `SprintSnapshot` — completed sprint aggregate (points completed, velocity)
- `ImpedimentRef` — impediment lightweight reference
- `ItemType` — `"user_story" | "bug" | "spike" | "tech_debt"`

### 5.3 Removed types

- `OrientResult.vocabulary.templates` — replaced by `TemplateUriMap`
- Sprint-as-container types (any type modelling sprint as an independent retrieval unit)

### 5.4 Known type issue — `DependencyEntry.ref.id` is nullable

`DependencyEntry.ref.id` is typed `string | null` in `domain/types.ts` and is inconsistently populated across the project (acknowledged in a comment at line 65). This is a latent bug: any graph traversal that relies on `ref.id` as a node key silently breaks for null entries.

`DependencyMap` deliberately uses `key` (the human-readable issue number) as the canonical node identifier precisely to avoid this. `ref.id` remains on `DependencyEntry` for `scrum_get_story` responses where the adapter can reliably resolve it, but it must never be used as a primary graph key. Fixing the nullable inconsistency is an implementation-phase concern.

---

## 6. Agent Behavioral Design — Agent Layer

### 6.1 Session start protocol

On every session start, the agent executes four steps in order:

1. **`scrum_orient`** — load project structure, vocabulary, sprint context, active epics, and template URIs. This is the session's ground truth.
2. **Gap check** — inspect `platform_state.missing_options` and `labels.missing`. If structural gaps exist, surface them before proceeding.
3. **`scrum_get_backlog`** — load board health signals. Classify session health: clean, at-risk, or blocked.
4. **Classify and route** — use the orient + health data to classify the incoming request type and route to the matching playbook.

`scrum_orient` is called **once per session**. It is not re-called mid-workflow. The only exception is after a structural mutation (`scrum_add_vocabulary`) that would change the orient result.

### 6.2 Item retrieval pattern

The agent never assumes which bucket an item is in. All item searches go through `scrum_find_items`. The default scope is `"all"`.

```
// Before: agent tries both tools
scrum_get_sprint()         → filter client-side
scrum_get_backlog()        → filter client-side

// After: one call
scrum_find_items({ type: ["bug"], status: ["in_progress"] })
```

For full item detail the agent always follows up with `scrum_get_story(id)`. It does not work from list-level data for actions.

### 6.3 Orient as temporal anchor

The `time_elapsed_pct` field from `SprintContext` feeds directly into the agent's sprint risk assessment. The agent does not compute time-based risk from raw dates — it reads the pre-computed signal and maps it to a stance:

| `time_elapsed_pct` | Agent stance                                                   |
| ------------------ | -------------------------------------------------------------- |
| < 40%              | Normal — focus on readiness and unblocking                     |
| 40–70%             | Monitor — cross-check `sprint_risk` from `scrum_get_backlog`   |
| > 70%              | Elevated — proactively surface unfinished items and scope risk |

This mapping is encoded in the agent's playbooks, not in the MCP server.

### 6.4 Epic context in prioritization

When the agent makes a prioritization recommendation, active epics from `scrum_orient` are a required input alongside sprint goal and deadlines. An item that advances an active epic with no other in-flight items gets a thematic coherence signal that increases its recommendation weight. The `open_item_count` on each epic is the signal — it tells the agent whether momentum on that epic is stalling.

### 6.5 Template discovery and usage

Template URIs are discovered from `vocabulary.template_uris` in the `scrum_orient` response. When drafting a new item the agent checks this map first. If a URI exists for the requested type, the agent reads it as a resource. It falls back to the canonical format in `references/item-types.md` only when no config template is declared.

### 6.6 Analytics usage

`scrum_get_analytics` is called when the agent needs to reason about capacity or historical delivery rate. This is triggered by: sprint planning requests, velocity-based estimation, capacity questions, or burndown review. It is not called during routine board management sessions.

### 6.7 Dependency graph pattern

When the agent needs to reason about item relationships — blocked work, delivery sequencing, cross-epic dependencies — it uses a single call:

```
scrum_find_items({ scope: "sprint", include_dependencies: true })
→ { items: StoryListing[], dependency_map: DependencyMap }
```

The `dependency_map` covers every node in the graph: items in the result set (`resolved: true`) and out-of-scope dependencies they reference (`resolved: false`). For any unresolved node the agent uses the inline state signals to make a fetch-or-skip decision before making any additional call:

| Unresolved node signals                       | Agent decision                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `status: "Done"`                              | Blocker is resolved. No follow-up needed.                                                                               |
| `status: "In Progress"`, `sprint: "Sprint N"` | Active in another sprint. Fetch if sprint health is relevant to the current task.                                       |
| `status: "In Progress"`, `sprint: null`       | Active but unscheduled — a backlog risk. Surface to the team; fetch full detail if actioning it.                        |
| `status: null`                                | Item is external to the project. Agent notes the dependency but cannot resolve it via MCP.                              |
| `epic_name: "X"` on unresolved node           | Cross-epic dependency. Use `scrum_find_items({ epic_id: X })` for full context, not `scrum_get_story` on a single item. |

The agent calls `scrum_get_story` on a dependency node only when it needs the full detail (body, AC, audit trail) to take a specific action — not merely to determine whether the dependency is active.

---

## 7. Out of Scope

The following are acknowledged design concerns but are **not addressed in this proposal**. They are captured here to avoid re-litigating them in future sessions.

- **Backend implementation of `scrum_find_items`** — how GitHub Projects' GraphQL API is queried to support the unified filter. Implementation concern.
- **Backend implementation of epic enumeration in `scrum_orient`** — fetching milestone/epic data alongside platform state. Implementation concern.
- **`scrum://template/{type}` resource registration** — how `server.registerResourceTemplate()` is wired in `index.ts`. Implementation concern.
- **`scrum_get_backlog` health metrics computation** — what backend queries are needed to count unestimated, blocked, and orphaned items. Implementation concern.
- **Config-driven type vocabulary extension** — the `ItemType` union is currently hardcoded. Future extension point: `vocabulary.type` in scrum config drives the allowed values dynamically. Out of scope for this iteration.
- **Stateful orient comparison server** — logging orient snapshots and diffing them across sessions to surface structural changes. Not a function of the MCP server (which is stateless). Valid future agent infrastructure pattern.

---

## 8. Open Questions

- **`sprint_risk` in `scrum_get_backlog`** — computing `unestimated_count` and `blocked_count` requires a count query on sprint items. If the backend cannot return aggregate counts without loading full items, this may be expensive. Decide: lightweight count query, or accept the cost as justified by the tool's role.
- **`scrum_find_items` with past sprints** — the `sprint_ref` field allows querying items from a past sprint by ID. Is this a confirmed requirement, or is `scrum_get_analytics` sufficient for past-sprint reasoning? Confirm before implementing the filter path.
- **`scrum_orient` call cost** — adding epic enumeration adds one backend call to orient. On GitHub Projects this is a GraphQL request. Acceptable given once-per-session contract; confirm this holds before relaxing the session protocol.
- **Out-of-project dependency status resolution** — `DependencyNode.status`, `sprint`, and `epic_name` for in-project items can be resolved from the backend's already-loaded in-memory state (after `backend.reload()`) at no extra network cost. For dependencies on issues in other repositories or not on the board, these fields will be null. Confirm whether the adapter can distinguish "in-project but unresolved" from "genuinely external" so the agent can communicate the difference accurately.
- **`DependencyEntry.ref.id` nullable fix scope** — resolving the inconsistency in `domain/types.ts` touches the adapter layer and potentially the GitHub query layer. Scope the fix before starting the `scrum_find_items` implementation to avoid building the dependency map on top of a broken foundation.
