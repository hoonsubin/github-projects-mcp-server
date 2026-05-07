# Integration Plan: REST API + `scrum_get_burndown`

This document is the authoritative plan for adding GitHub REST API support and a
`scrum_get_burndown` read tool to the MCP server. It is a standalone extension to
`REFACTORING.md` — all decisions here are additive; nothing in the existing 11-tool
surface changes.

---

## Context and Decisions

### Why REST, and why now

The GraphQL API is the right transport for project structure queries (fields, items,
iterations). It is the wrong transport for **event history** — GitHub does not expose
intra-sprint project field change history via GraphQL for any plan tier. REST's issue
timeline endpoint and (for Enterprise) the Audit Log endpoint do expose this data.

Adding a `rest()` helper alongside the existing `graphql()` helper in
`services/github.ts` is a one-function change that unlocks a new class of tool. The
`scrum_get_burndown` tool is the first consumer.

### Agreed decisions

| Question | Decision |
|---|---|
| New tool name | `scrum_get_burndown` — consistent with existing `scrum_get_*` naming |
| Where the tool lives | Added to `registerScrumReadTools` in `src/tools/scrum-read.ts` |
| Data source priority | Try Enterprise Audit Log first; fall back to Issue Close Proxy if 403 |
| Free/Team proxy validity | Issue close timestamps are a valid proxy **only if** the team closes issues when moving to Done. Tool description and response warn the agent explicitly. |
| `data_source` field | Always returned so the agent can cite the accuracy level to the user |
| Ideal line | Always computed from sprint start/end and committed points — no data dependency |
| Pagination | REST timeline: `per_page=100`, one page is sufficient for typical stories. Audit log: paginate via `Link` header until sprint window is exhausted. |
| Rate limits | 5 000 REST requests/hour for authenticated users. Worst case: 1 call per story (timeline proxy path) + 1 audit-log page = N+1 calls. Acceptable for sprints ≤ 200 items. |
| Retry / backoff | Not implemented in v1. If rate-limited, tool returns the 403 error text so the agent can inform the user. |
| Sequence relative to refactoring | Implement after Phase 2 (read tools done), before Phase 3 (write tools). This is Phase 2.5. |

---

## Tool Contract

### Input schema — `GetBurndownSchema`

```typescript
// src/schemas/scrum.ts — add alongside existing read schemas
export const GetBurndownSchema = z
  .object({
    sprint: SprintRefSchema.optional(), // defaults to "current"
  })
  .strict();
```

No other input is needed. The tool derives sprint dates, story list, and vocabulary
from `loadConfig` + `resolveSprint` (same bootstrap as the other read tools).

### Output shape

```jsonc
{
  "sprint": {
    "name": "Sprint 12",
    "start_date": "2025-06-02",
    "end_date": "2025-06-13",
    "duration_days": 12,
    "days_remaining": 5
  },
  "data_source": "audit_log" | "issue_close_proxy",
  "warning": "Points are inferred from issue close events...",  // only on proxy path
  "series": [
    { "date": "2025-06-02", "remaining_points": 34, "completed_points": 0 },
    { "date": "2025-06-03", "remaining_points": 34, "completed_points": 0 },
    { "date": "2025-06-04", "remaining_points": 29, "completed_points": 5 },
    // ... one entry per calendar day from start_date to today
  ],
  "ideal": [
    { "date": "2025-06-02", "remaining_points": 34 },
    { "date": "2025-06-03", "remaining_points": 31 },
    // ... straight-line from committed_points to 0 over duration_days
  ],
  "stories": [
    {
      "number": 42,
      "title": "As a user I can log in",
      "points": 5,
      "status": "Done",
      "completed_at": "2025-06-04T14:32:00Z"  // null if not yet done
    }
  ]
}
```

The `series` and `ideal` arrays together are what a charting agent (or any downstream
visualisation) needs to render a burndown. The agent can also describe the chart in
prose using just `series`.

---

## Architecture

### File changes (complete list)

| File | Change |
|---|---|
| `src/services/github.ts` | Add `rest<T>()` function; add REST-specific entries to `REQUIRED_PERMISSION` map |
| `src/schemas/scrum.ts` | Add `GetBurndownSchema` and export |
| `src/tools/scrum-read.ts` | Add `scrum_get_burndown` registration inside `registerScrumReadTools`; add REST GraphQL types for timeline/audit-log responses |
| `plans/BURNDOWN.md` | This file |

No other files change. `index.ts` does not need updating — `registerScrumReadTools`
already exports the function; adding a tool inside it is transparent to the caller.

---

## Service Layer — `rest<T>()`

### Signature

```typescript
// src/services/github.ts
export const rest = async <T>(
  path: string,                              // e.g. "/repos/owner/repo/issues/42/timeline"
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    params?: Record<string, string>;         // appended as query string
    body?: unknown;                          // JSON-serialised for non-GET
    accept?: string;                         // override Accept header (some endpoints need this)
  } = {},
): Promise<T>
```

### Implementation notes

- Base URL: `https://api.github.com`
- Auth: same `Bearer {GITHUB_TOKEN}` header
- Default `Accept: application/vnd.github+json` (GitHub recommends this over `application/json`)
- `X-GitHub-Api-Version: 2022-11-28` header (locks the API version)
- Same 30 s timeout + AbortController pattern as `graphql()`
- Same 401 / 403 / non-2xx error classification as `graphql()`
- Returns `response.json() as T` — no `data` wrapper (REST responses are top-level, unlike GraphQL)
- Pagination: callers handle it; `rest()` is single-request only. The burndown tool
  implements its own `while (nextLink)` loop using the `Link` response header.

### `REQUIRED_PERMISSION` additions

```typescript
get_issue_timeline: "Issues: Read",
get_audit_log:      "Organization: Read (Enterprise only — requires GHES or GHEC)",
```

---

## Tool Implementation — `scrum_get_burndown`

### Step 1 — Load config and resolve sprint

Identical to `scrum_get_board`:

```
loadConfig → resolveSprint(ref, config) → iterationId
```

Find the `IterationEntry` to get `startDate` and `duration`.

### Step 2 — Fetch sprint stories

Reuse `fetchAllItems` (already in `scrum-read.ts`), filter to the target `iterationId`
the same way `scrum_get_board` does. Extract issue numbers and story points.

Stories with no story points are included in the list but contribute 0 to the series —
the agent's description should note unpointed stories separately.

### Step 3 — Determine completion timestamps

**Path A — Enterprise Audit Log (preferred)**

```
GET /orgs/{org}/audit-log
  ?phrase=action:projects_v2_item.field_value_updated
  &order=asc
  &per_page=100
```

Filter response entries where:
- `data.field_type === "single_select"`
- `data.field_name` matches the configured status field name
- `data.value` (new value) matches the "Done" display name from `config.yml.status`
- `data.project_item_node_id` is in the sprint story set

Extract `created_at` as the completion timestamp for the matching story.

Paginate via `Link: <url>; rel="next"` header until `created_at` of the last entry
exceeds `sprint.end_date` (no point fetching beyond the sprint window).

If the endpoint returns HTTP 403: fall through to Path B and set
`data_source: "issue_close_proxy"`.

**Path B — Issue Close Proxy (free/Team plans)**

For each story, call:
```
GET /repos/{owner}/{repo}/issues/{number}/timeline?per_page=100
```

Scan events for the last `closed` event whose `created_at` falls within
`[sprint.startDate, sprint.endDate]`. That timestamp is the proxy completion time.

If an issue has no `closed` event in the sprint window (e.g., it was done but not
closed, or it was closed before the sprint started), `completed_at` is null. The agent
must warn the user when this count is non-zero: "N stories appear Done on the board
but have no close event in the sprint window — their points may be misattributed."

### Step 4 — Build the day series

```
committedPoints = sum of all sprint story points
sprintDays = [startDate, startDate+1, ..., min(today, endDate)]

for each day d in sprintDays:
  completedOnOrBefore(d) = stories where completed_at <= d (end of day, UTC)
  series[d].completed_points = sum(points of completedOnOrBefore(d))
  series[d].remaining_points = committedPoints - series[d].completed_points
```

### Step 5 — Compute ideal line

```
for each day d in [startDate .. endDate]:
  dayIndex = (d - startDate).days          // 0-based
  ideal[d] = committedPoints * (1 - dayIndex / duration_days)
```

Straight-line from `committedPoints` on day 0 to 0 on the last day.

### Step 6 — Assemble and return

Return the full response shape defined in the **Tool Contract** section above.

---

## Rate Limit Analysis

| Scenario | REST calls | GraphQL calls | Total |
|---|---|---|---|
| Enterprise, 20-story sprint | 1 (audit log, likely 1 page) | ~3 (loadConfig + fetchAllItems) | ~4 |
| Free plan, 20-story sprint | 20 (1 timeline per story) | ~3 | ~23 |
| Free plan, 50-story sprint | 50 | ~5 | ~55 |

All well within the 5 000 req/hr REST limit and 5 000 point/hr GraphQL limit.

For very large projects (> 100 stories in a sprint), parallelise timeline calls in
batches of 10 using `Promise.all` with a concurrency limiter. Not needed for v1.

---

## Implementation Sequence

This is Phase 2.5 — after Phase 2 read tools are complete, before Phase 3 write tools.

| Step | File | What |
|---|---|---|
| 2.5a | `src/services/github.ts` | Add `rest<T>()` function |
| 2.5b | `src/schemas/scrum.ts` | Add `GetBurndownSchema` |
| 2.5c | `src/tools/scrum-read.ts` | Add `scrum_get_burndown` in `registerScrumReadTools` |
| 2.5d | Type-check entire project | `deno check src/index.ts` must pass clean |

Each step is independently type-checkable. Implement and check in order.

---

## Open Questions

| Question | Status |
|---|---|
| Does `projects_v2_item.field_value_updated` exist in the audit log for GHEC? | Needs verification against live schema — structure inferred from GitHub changelog |
| Should `scrum_get_burndown` accept a `include_weekends: boolean` flag to skip non-working days in the series? | Deferred — v1 includes all calendar days |
| Should the ideal line use team capacity (from `config.yml.sprint.velocity_window`) rather than a straight line? | Deferred — straight line is the Scrum standard; capacity-adjusted ideal is a v2 option |
| Should unpointed stories show in the series as 0-pt or be excluded entirely? | Included at 0 pt — exclusion would hide scope changes from the chart |
