# Story 9.5: Implement scrum_get_burndown Read Tool

**Issue:** (file when creating) **Priority:** Should **Size:** L **Story Points:** 8 **Sprint:** Sprint 2 **Status:** Ready for Implementation

---

## Goal

Implement the `scrum_get_burndown` read tool: the agent's window into how a sprint's work flowed day-by-day. It returns a time-series of remaining and completed points alongside an ideal burndown line, so the agent can describe sprint health, identify when the team fell behind, and surface stalled stories — without the server pre-computing any of those assessments.

This is Phase 2.5. It introduces the only REST API usage in the server and has two implementation sub-goals of equal importance:

1. **Add `rest<T>()`** — a single-request REST helper in `src/services/github.ts` that mirrors the existing `graphql()` in error handling, timeouts, and logging discipline.
2. **Implement `scrum_get_burndown`** — using `rest<T>()` and the same orchestration pattern established by the other four read tools.

---

## Background: Why Two Data Paths

GitHub does not expose intra-sprint project field change history over GraphQL at any plan tier. To know _when_ a story moved to Done, the tool must use:

- **Enterprise Audit Log** (`GET /orgs/{org}/audit-log`) — precise timestamps for every project field change. Available on GitHub Enterprise Cloud and Enterprise Server only. Tried first; falls back on HTTP 403.
- **Issue Close Proxy** (`GET /repos/{owner}/{repo}/issues/{number}/timeline`) — uses the `closed` event timestamp as a proxy for "moved to Done". Available on all plan tiers. Only valid if the team closes issues when marking them Done on the board. The tool warns the agent when it degrades to this path.

The `data_source` field in the response always tells the agent which path was used, so it can communicate accuracy to the user.

---

## Acceptance Criteria

1. **`rest<T>()` added to `src/services/github.ts`** — single-request helper; same `AbortController` timeout, same 401/403/non-2xx error classification, same `log.debug` instrumentation as `graphql()`. Returns `{ data: T; linkHeader: string | null }` so callers can paginate without needing a second HTTP call.

2. **`REQUIRED_PERMISSION` map extended** — `get_issue_timeline` and `get_audit_log` entries added so `enrichError` can surface the correct permission hint on a 403.

3. **Tool registration** — `scrum_get_burndown` registered in `registerScrumReadTools` with proper MCP metadata (title, description, inputSchema, annotations).

4. **Sprint targeting** — accepts optional `sprint: SprintRef`, defaults to `"current"`.

5. **`data_source` always returned** — either `"audit_log"` or `"issue_close_proxy"`. Never omitted.

6. **`warning` field on proxy path** — when the tool falls back to issue close events, the response includes a `warning` string describing what the agent should tell the user.

7. **`series` array** — one entry per calendar day from `sprint.start_date` to `min(today, sprint.end_date)`. Each entry: `{ date, remaining_points, completed_points }`.

8. **`ideal` array** — one entry per calendar day from `sprint.start_date` to `sprint.end_date`. Straight-line from `committed_points` on day 0 to 0 on the last day. Pure computation — no data dependency.

9. **`stories` array** — lightweight per-story summary with `completed_at` (ISO timestamp or null). Unpointed stories included at 0 pt with a comment in the tool description.

10. **Handler reads as orchestration** — the registered handler delegates to five named helper functions. No inline data transformation or branching logic in the handler body.

11. **Pure helpers are independently testable** — `buildDaySeries`, `buildIdealLine`, `buildSprintWindow`, and `extractLinkHeader` have no network dependencies and can be unit-tested without a GitHub mock.

12. **Type-check passes** — `deno check src/index.ts` is clean after all changes.

---

## New Types

Add to `src/types.ts` in a new `// ── Burndown types ──` section:

```typescript
/** Response shape for scrum_get_burndown. */
export interface BurndownResponse {
  sprint: BurndownSprintMeta;
  data_source: "audit_log" | "issue_close_proxy";
  warning?: string;
  series: BurndownDayPoint[];
  ideal: IdealDayPoint[];
  stories: BurndownStory[];
}

export interface BurndownSprintMeta {
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  duration_days: number;
  days_remaining: number;
}

export interface BurndownDayPoint {
  date: string; // YYYY-MM-DD
  remaining_points: number;
  completed_points: number;
}

export interface IdealDayPoint {
  date: string; // YYYY-MM-DD
  remaining_points: number;
}

export interface BurndownStory {
  number: number;
  title: string;
  points: number; // 0 if unpointed
  status: string | null;
  completed_at: string | null; // ISO-8601 or null if not yet done
}
```

These types are the public contract. Intermediate shapes used only inside the tool implementation stay local to `scrum-read.ts`.

---

## Part 1 — `rest<T>()` in `src/services/github.ts`

### Why `{ data, linkHeader }` instead of just `T`

The audit log path requires following `Link: <url>; rel="next"` response headers across multiple pages. If `rest<T>()` returned only the parsed body, the audit log pagination loop would need a second HTTP round-trip just to discover the next URL. Returning `{ data: T; linkHeader: string | null }` at no extra cost lets callers paginate from a single call result.

Non-paginating callers (e.g. the issue timeline path) simply ignore `linkHeader`.

### Signature

```typescript
export interface RestResponse<T> {
  data: T;
  linkHeader: string | null;
}

/**
 * Make a single GitHub REST API request.
 *
 * Base URL: https://api.github.com
 * Auth:     Bearer GITHUB_TOKEN (same env var as graphql())
 * Timeout:  30 s (same AbortController pattern as graphql())
 *
 * Returns { data, linkHeader } so callers can paginate via the Link header
 * without a second HTTP call.
 *
 * Throws GitHubApiError on 401, 403, and non-2xx responses — same classification
 * as graphql().
 */
export const rest = async <T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    params?: Record<string, string>;
    body?: unknown;
    accept?: string;
  } = {},
): Promise<RestResponse<T>> => { ... }
```

### Implementation notes

- Base URL: `https://api.github.com`
- Default `Accept: application/vnd.github+json` — GitHub recommends this over `application/json`
- `X-GitHub-Api-Version: 2022-11-28` header — locks the API version explicitly
- Same `Bearer {GITHUB_TOKEN}` auth header from `getToken()`
- `params` entries appended as a query string via `URLSearchParams`
- Non-GET requests: `body` JSON-serialised; `Content-Type: application/json` added
- Response body parsed as `response.json() as T` — no `data` wrapper (REST is top-level)
- `linkHeader`: `response.headers.get("link") ?? null`
- Log line: `log.debug(\`→ rest:${method} ${path}\`, params)` and `← rest:${method} ${path} OK (${ms}ms)`

### Error handling (mirror `graphql()` exactly)

```typescript
if (err is AbortError)      → throw GitHubApiError("Request timed out after 30s")
if (response.status === 401) → throw GitHubApiError("Authentication failed...", 401)
if (response.status === 403) → throw GitHubApiError("Rate limit or permission denied...", 403)
if (!response.ok)            → throw GitHubApiError(`GitHub API error: HTTP ${status} ${statusText}`, status)
```

### `REQUIRED_PERMISSION` additions

```typescript
const REQUIRED_PERMISSION: Record<string, string> = {
  // ... existing entries ...
  get_issue_timeline: "Issues: Read",
  get_audit_log: "Organization: Read (Enterprise only — requires GHES or GHEC)",
};
```

---

## Part 2 — `scrum_get_burndown` in `src/tools/scrum-read.ts`

### Clean code design rationale

The handler has inherently more complexity than the other read tools because it branches between two data paths, aggregates timestamps, and builds two independent series. Without extraction, the handler becomes a 120-line function that does data fetching, branching, aggregation, and series construction all inline — violating both SRP and the "functions do one thing" rule.

The solution is to give each conceptual step its own named function. The handler then reads as a six-step orchestration, and every step is independently understandable and testable.

### Intermediate types (local to `scrum-read.ts`)

```typescript
/** Result of the completion-timestamp resolution step. */
interface CompletionResult {
  /** Issue number → ISO-8601 completion timestamp. Only includes stories that are done. */
  completions: Map<number, string>;
  data_source: "audit_log" | "issue_close_proxy";
  /** Present only on the proxy path. */
  warning?: string;
}

/** Minimal story shape needed to build the burndown series. */
interface BurndownStoryInput {
  number: number;
  title: string;
  points: number;
  status: string | null;
}
```

### Helper 1 — `buildSprintWindow`

Pure. No network.

```typescript
interface SprintWindow {
  name: string;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  daysRemaining: number;
}

/**
 * Compute the sprint window from an IterationEntry.
 * Normalises all Date objects to midnight UTC to avoid timezone edge cases
 * in day-boundary arithmetic (same fix applied in buildSprintMeta for scrum_get_sprint).
 */
const buildSprintWindow = (iterEntry: IterationEntry): SprintWindow => {
  const startDate = new Date(iterEntry.startDate);
  startDate.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + iterEntry.duration);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - today.getTime()) / msPerDay),
  );

  return {
    name: iterEntry.title,
    startDate,
    endDate,
    durationDays: iterEntry.duration,
    daysRemaining,
  };
};
```

### Helper 2 — `buildIdealLine`

Pure. No network. Zero data dependency.

```typescript
/**
 * Compute the straight-line ideal burndown from committedPoints to 0
 * across every calendar day in the sprint (start_date inclusive, end_date inclusive).
 */
const buildIdealLine = (
  window: SprintWindow,
  committedPoints: number,
): IdealDayPoint[] => {
  const ideal: IdealDayPoint[] = [];
  const msPerDay = 1000 * 60 * 60 * 24;
  const cursor = new Date(window.startDate);

  for (let dayIndex = 0; dayIndex <= window.durationDays; dayIndex++) {
    const date = cursor.toISOString().slice(0, 10);
    const remaining = committedPoints * (1 - dayIndex / window.durationDays);
    ideal.push({ date, remaining_points: Math.round(remaining * 10) / 10 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return ideal;
};
```

### Helper 3 — `buildDaySeries`

Pure. No network.

```typescript
/**
 * Build the actual burndown series: one entry per calendar day from sprint
 * start_date to min(today, end_date).
 *
 * A story is considered completed on day D if its completed_at timestamp falls
 * on or before the end of day D (UTC).
 */
const buildDaySeries = (
  stories: BurndownStoryInput[],
  completions: Map<number, string>,
  window: SprintWindow,
  committedPoints: number,
): BurndownDayPoint[] => {
  const series: BurndownDayPoint[] = [];
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999); // end of today

  const seriesEnd = window.endDate < today ? window.endDate : today;
  const msPerDay = 1000 * 60 * 60 * 24;
  const cursor = new Date(window.startDate);

  while (cursor <= seriesEnd) {
    const endOfDay = new Date(cursor);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const dateStr = cursor.toISOString().slice(0, 10);

    let completedPoints = 0;
    for (const story of stories) {
      const completedAt = completions.get(story.number);
      if (completedAt && new Date(completedAt) <= endOfDay) {
        completedPoints += story.points;
      }
    }

    series.push({
      date: dateStr,
      remaining_points: committedPoints - completedPoints,
      completed_points: completedPoints,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return series;
};
```

### Helper 4 — `extractLinkHeader`

Pure. No network. Exported for testing.

```typescript
/**
 * Parse the GitHub REST API `Link` header and return the URL for rel="next",
 * or null if the header is absent or there is no next page.
 *
 * Link header format: <url>; rel="next", <url>; rel="last"
 */
export const extractLinkHeader = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
};
```

### Helper 5 — `fetchAuditLogCompletions`

Network. Enterprise only. Throws `GitHubApiError` (status 403) on non-Enterprise accounts — caller catches this and falls back to the proxy path.

```typescript
/**
 * Fetch completion timestamps from the GitHub Enterprise audit log.
 * Paginates until the last event timestamp exceeds sprint.endDate.
 *
 * Only available on GitHub Enterprise Cloud / Enterprise Server.
 * Throws GitHubApiError(403) on free/Team plans — callers must catch and fall back.
 */
const fetchAuditLogCompletions = async (
  storyNumbers: Set<number>,
  window: SprintWindow,
  org: string,
  doneStatusName: string,
  statusFieldName: string,
): Promise<Map<number, string>> => { ... }
```

Internal implementation notes:

- Query: `GET /orgs/{org}/audit-log?phrase=action:projects_v2_item.field_value_updated&order=asc&per_page=100`
- Filter entries: `data.field_type === "single_select"`, `data.field_name === statusFieldName`, `data.value === doneStatusName`
- Match `data.project_item_node_id` to sprint story set — note: the audit log exposes project item node IDs, not issue numbers. A lookup table from node ID to issue number must be passed in or computed. See the note in Implementation Order about this.
- Paginate via `extractLinkHeader(linkHeader)` until the last entry's `created_at` exceeds `window.endDate.toISOString()`
- Returns `Map<number, string>` — issue number → ISO completion timestamp (last entry wins if a story moved to Done more than once)

### Helper 6 — `fetchIssueCloseCompletions`

Network. Available on all plan tiers. N REST calls (one per story).

```typescript
/**
 * Fetch completion timestamps by using issue close events as a proxy for
 * "moved to Done". One REST call per story.
 *
 * Only includes stories that have a `closed` event within the sprint window.
 * Stories marked Done on the board but not closed as issues will have no entry —
 * the caller adds them to the response's uncounted list.
 *
 * Available on all GitHub plan tiers.
 */
const fetchIssueCloseCompletions = async (
  stories: BurndownStoryInput[],
  window: SprintWindow,
  owner: string,
  repo: string,
): Promise<Map<number, string>> => { ... }
```

Internal implementation notes:

- For each story: `GET /repos/{owner}/{repo}/issues/{number}/timeline?per_page=100`
- Scan events for the **last** `closed` event whose `created_at` falls within `[window.startDate, window.endDate]`
- Stories with no qualifying close event get no entry in the map (completed_at will be null)
- Do not parallelise in v1 — sequential is simpler and N ≤ ~50 for a typical sprint is fast enough within the 5,000 req/hr REST limit

### Helper 7 — `resolveCompletionTimestamps`

Orchestrates the two paths. The handler calls only this function — it never branches on `data_source` directly.

```typescript
/**
 * Resolve completion timestamps for sprint stories, trying the audit log first
 * and falling back to issue close events on 403.
 *
 * Returns a CompletionResult with:
 *   completions  — Map of issue number → ISO completion timestamp
 *   data_source  — which path succeeded
 *   warning      — present on the proxy path; the agent should surface this to the user
 */
const resolveCompletionTimestamps = async (
  stories: BurndownStoryInput[],
  window: SprintWindow,
  config: RuntimeConfig,
  owner: string,
  repo: string,
): Promise<CompletionResult> => {
  const doneStatusName = findStatusDisplayName(config, "done", "Done");
  const statusFieldName = config.yml.field_names.status;

  try {
    const completions = await fetchAuditLogCompletions(
      new Set(stories.map((s) => s.number)),
      window,
      owner,
      doneStatusName,
      statusFieldName,
    );
    return { completions, data_source: "audit_log" };
  } catch (err) {
    if (!(err instanceof GitHubApiError) || err.statusCode !== 403) throw err;
    // 403 = not an Enterprise account; degrade gracefully
  }

  const completions = await fetchIssueCloseCompletions(
    stories,
    window,
    owner,
    repo,
  );
  return {
    completions,
    data_source: "issue_close_proxy",
    warning: "Burndown timestamps are inferred from issue close events, not board field changes. " +
      "This is a proxy that is only accurate if your team closes GitHub Issues when moving " +
      "stories to Done on the board. Stories marked Done but not closed will show " +
      "completed_at: null.",
  };
};
```

### The handler — orchestration only

After the helpers above, the registered handler body becomes a clean six-step sequence:

```typescript
async (params: z.infer<typeof GetBurndownSchema>) => {
  try {
    const { owner, ownerType, projectNumber } = getBootstrapConfig();
    const repo = getRepo();
    const config = await loadConfig({ github: gh, owner, ownerType, projectNumber, repo });

    // 1. Resolve sprint
    const sprintRef = params.sprint ?? "current";
    const iterationId = resolveSprint(sprintRef, config);
    if (iterationId === null) {
      return errorResponse("scrum_get_burndown does not support null sprint (backlog). Pass a sprint name or \"current\".");
    }
    const iterEntry = config.iterations.all.find((i) => i.id === iterationId);
    if (!iterEntry) throw new Error(`Sprint "${sprintRef}" resolved to an unknown iteration ID.`);

    // 2. Fetch sprint stories
    const allItems = await fetchAllItems(config, owner, ownerType);
    const stories = allItems
      .filter((item) => {
        const fv = item.fieldValues.nodes.find((v) => v.field?.id === config.fields.sprintFieldId);
        return fv?.iterationId === iterationId;
      })
      .map((item) => buildBurndownStoryInput(item, config))
      .filter((s): s is BurndownStoryInput => s !== null);

    // 3. Compute sprint window
    const window = buildSprintWindow(iterEntry);
    const committedPoints = stories.reduce((sum, s) => sum + s.points, 0);

    // 4. Resolve completion timestamps (audit log → issue close proxy fallback)
    const { completions, data_source, warning } = await resolveCompletionTimestamps(
      stories, window, config, owner, repo,
    );

    // 5. Build series and ideal line
    const series = buildDaySeries(stories, completions, window, committedPoints);
    const ideal  = buildIdealLine(window, committedPoints);

    // 6. Assemble response
    const burndownStories: BurndownStory[] = stories.map((s) => ({
      number:       s.number,
      title:        s.title,
      points:       s.points,
      status:       s.status,
      completed_at: completions.get(s.number) ?? null,
    }));

    const sprint: BurndownSprintMeta = {
      name:          window.name,
      start_date:    window.startDate.toISOString().slice(0, 10),
      end_date:      window.endDate.toISOString().slice(0, 10),
      duration_days: window.durationDays,
      days_remaining: window.daysRemaining,
    };

    const response: BurndownResponse = warning
      ? { sprint, data_source, warning, series, ideal, stories: burndownStories }
      : { sprint, data_source, series, ideal, stories: burndownStories };

    return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
  }
},
```

Where `errorResponse` is a shared module-level helper (or reuse the existing error pattern):

```typescript
const errorResponse = (message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ message }) }],
});
```

And `buildBurndownStoryInput` is a focused helper (distinct from `buildStoryFromRaw` — same rationale as `buildEnrichedStory` in Story 9 — but even more minimal since burndown only needs number, title, points, and status):

```typescript
/**
 * Build the minimal story shape needed for burndown computation.
 * Returns null for DraftIssues and items without content.
 * Distinct from buildStoryFromRaw — burndown needs fewer fields and avoids
 * the cost of populating fields not used in series construction.
 */
const buildBurndownStoryInput = (
  item: RawItem,
  config: RuntimeConfig,
): BurndownStoryInput | null => {
  const content = item.content;
  if (!content || typeof content.number !== "number") return null;

  const { storyPointsFieldId, statusFieldId } = config.fields;
  let points = 0;
  let status: string | null = null;

  for (const fv of item.fieldValues.nodes) {
    const id = fv.field?.id;
    if (!id) continue;
    if (id === statusFieldId && fv.name) {
      status = fv.name;
    } else if (
      storyPointsFieldId &&
      id === storyPointsFieldId &&
      typeof fv.number === "number"
    ) {
      points = fv.number;
    }
  }

  return { number: content.number, title: content.title, points, status };
};
```

---

## Audit Log Path — The Node ID Problem

The audit log returns `data.project_item_node_id` (a `PVTI_...` string), not the issue number. To map an audit log entry to a story in the sprint, we need to correlate these.

**Solution:** Before calling `fetchAuditLogCompletions`, build a lookup map from the sprint stories already fetched:

```typescript
// item.id is the project item node ID (PVTI_...)
// content.number is the issue number
const nodeIdToNumber = new Map<string, number>(
  allItems
    .filter((item) => /* same sprint filter */)
    .map((item) => [item.id, item.content?.number])
    .filter((pair): pair is [string, number] => pair[1] !== undefined),
);
```

Pass this map into `fetchAuditLogCompletions` alongside `storyNumbers`, so it can translate audit log node IDs back to issue numbers.

Updated signature:

```typescript
const fetchAuditLogCompletions = async (
  nodeIdToNumber: Map<string, number>,
  window: SprintWindow,
  org: string,
  doneStatusName: string,
  statusFieldName: string,
): Promise<Map<number, string>>
```

This keeps the function pure on its inputs — it never fetches back to GitHub to look up issue numbers separately.

---

## File Changes

| File                           | Change                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/github.ts`       | Add `RestResponse<T>` interface; add `rest<T>()` function; add `get_issue_timeline` and `get_audit_log` to `REQUIRED_PERMISSION`                                                                                                                                                                                                                                                        |
| `src/types.ts`                 | Add `BurndownResponse`, `BurndownSprintMeta`, `BurndownDayPoint`, `IdealDayPoint`, `BurndownStory`                                                                                                                                                                                                                                                                                      |
| `src/tools/scrum-read.ts`      | Add import for `GetBurndownSchema` from schemas; add local interfaces `CompletionResult`, `BurndownStoryInput`; add helpers `buildSprintWindow`, `buildIdealLine`, `buildDaySeries`, `extractLinkHeader`, `fetchAuditLogCompletions`, `fetchIssueCloseCompletions`, `resolveCompletionTimestamps`, `buildBurndownStoryInput`; register `scrum_get_burndown` in `registerScrumReadTools` |
| `src/tools/scrum-read_test.ts` | Add unit tests for all pure helpers                                                                                                                                                                                                                                                                                                                                                     |

`src/schemas/scrum.ts` — `GetBurndownSchema` is already done. No change needed.

---

## Testing Plan

All tests in `src/tools/scrum-read_test.ts`. Network-bound helpers (`fetchAuditLogCompletions`, `fetchIssueCloseCompletions`, `resolveCompletionTimestamps`) are **not** unit-tested here — they are integration-layer concerns. Every pure helper is tested directly.

### `extractLinkHeader`

| Test case             | Input                                          | Expected                         |
| --------------------- | ---------------------------------------------- | -------------------------------- |
| Single `next` link    | `'<https://api.github.com/page2>; rel="next"'` | `"https://api.github.com/page2"` |
| Last page (no `next`) | `'<url>; rel="last"'`                          | `null`                           |
| Null header           | `null`                                         | `null`                           |
| Multiple rels         | `'<url1>; rel="prev", <url2>; rel="next"'`     | `"url2"`                         |

### `buildSprintWindow`

| Test case                         | Scenario                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- |
| Active sprint with days remaining | `daysRemaining > 0`; `endDate = startDate + duration`                     |
| Sprint that ended yesterday       | `daysRemaining === 0`                                                     |
| Timezone boundary                 | UTC midnight normalisation applied; `days_remaining` does not shift by ±1 |

### `buildIdealLine`

| Test case                | Scenario                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| 10-day sprint, 20 points | `ideal[0].remaining_points === 20`; `ideal[10].remaining_points === 0`; array length === 11 |
| 0 committed points       | All entries are `0`                                                                         |
| Mid-sprint rounding      | Values rounded to 1 decimal place                                                           |

### `buildDaySeries`

| Test case                     | Scenario                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| No completions                | All entries have `completed_points: 0`, `remaining_points: committedPoints`              |
| Story completed on day 3      | Days 0–2: `completed_points` unchanged; day 3 onward: +points                            |
| Sprint not yet started        | Series has one entry for today if today < startDate is false; empty if today < startDate |
| Sprint ended (past)           | Series ends at `endDate`, not today                                                      |
| Multiple completions same day | Both deducted from that day's `remaining_points`                                         |
| 0-point story completes       | `completed_points` unaffected; `remaining_points` unaffected                             |

### `buildBurndownStoryInput`

| Test case                    | Scenario                                    |
| ---------------------------- | ------------------------------------------- |
| Normal issue item            | Returns `{ number, title, points, status }` |
| DraftIssue (no `number`)     | Returns `null`                              |
| Unpointed story              | Returns `points: 0`                         |
| `storyPointsFieldId` is null | No crash; returns `points: 0`               |

---

## Implementation Order

| Step | What                                                                                                                         | Time   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1    | Add `RestResponse<T>` interface and `rest<T>()` to `github.ts`; add `REQUIRED_PERMISSION` entries                            | 20 min |
| 2    | Add burndown types to `src/types.ts`                                                                                         | 10 min |
| 3    | Add `CompletionResult`, `BurndownStoryInput`, `SprintWindow` interfaces to `scrum-read.ts`                                   | 5 min  |
| 4    | Add `buildSprintWindow`, `buildIdealLine`, `buildDaySeries`, `extractLinkHeader` — pure helpers                              | 20 min |
| 5    | Add `buildBurndownStoryInput` — minimal projection from `RawItem`                                                            | 10 min |
| 6    | Add `fetchIssueCloseCompletions` — issue timeline REST path                                                                  | 20 min |
| 7    | Add `fetchAuditLogCompletions` — audit log REST path (with node ID map)                                                      | 25 min |
| 8    | Add `resolveCompletionTimestamps` — orchestrates steps 6 and 7                                                               | 10 min |
| 9    | Register `scrum_get_burndown` handler in `registerScrumReadTools`                                                            | 15 min |
| 10   | `deno check src/index.ts` — verify no type errors                                                                            | 5 min  |
| 11   | Write unit tests for `extractLinkHeader`, `buildSprintWindow`, `buildIdealLine`, `buildDaySeries`, `buildBurndownStoryInput` | 45 min |
| 12   | Cross-check return shape against README tool contract                                                                        | 5 min  |

**Estimated total effort:** ~3 hours

---

## Dependencies

| Dependency                                           | Status  | Notes                                 |
| ---------------------------------------------------- | ------- | ------------------------------------- |
| `GetBurndownSchema` in `src/schemas/scrum.ts`        | ✅ Done | Already implemented                   |
| `resolveSprint` in `src/services/resolver.ts`        | ✅ Done | Resolves SprintRef → iteration ID     |
| `loadConfig` / `RuntimeConfig`                       | ✅ Done | Provides field IDs, iteration entries |
| `fetchAllItems` in `src/tools/scrum-read.ts`         | ✅ Done | Returns all project items paginated   |
| `findStatusDisplayName` in `src/tools/scrum-read.ts` | ✅ Done | Vocabulary-aware status name lookup   |
| `graphql()` in `src/services/github.ts`              | ✅ Done | Reference implementation for `rest()` |
| `GitHubApiError` class                               | ✅ Done | Used for REST error classification    |

---

## Risk Assessment

| Risk                                                                          | Impact | Mitigation                                                                                                             |
| ----------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Audit log `projects_v2_item.field_value_updated` action may not exist on GHEC | High   | Treat a zero-result audit log response (not a 403) as a graceful fallback; add a `data_source_note` field in that case |
| Issue not closed when moved to Done                                           | Medium | `warning` field explicitly tells the agent; agent surfaces this to user                                                |
| Large sprint (100+ stories) on issue close path                               | Medium | Sequential calls; 100 stories = ~100 REST calls, well within 5,000/hr limit; document this trade-off                   |
| `days_remaining` timezone off-by-one                                          | Low    | `setUTCHours(0,0,0,0)` applied consistently in `buildSprintWindow`; unit test covers this                              |
| Audit log node ID ↔ issue number mismatch                                     | Medium | `nodeIdToNumber` map built from the same `allItems` fetch that produces the story list — the mapping is always in sync |
| `rest<T>()` breaks on non-JSON responses (e.g., 204 No Content)               | Low    | Burndown only calls endpoints that return JSON; document the constraint in the function JSDoc                          |

---

## Open Questions (Carried from BURNDOWN.md)

| Question                                                                            | Status                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Does `projects_v2_item.field_value_updated` exist in the audit log for GHEC?        | Needs verification against a live Enterprise account |
| Should `include_weekends: boolean` be added to skip non-working days in the series? | Deferred — v1 includes all calendar days             |
| Should the ideal line use capacity rather than a straight line?                     | Deferred — straight line is the Scrum standard       |
