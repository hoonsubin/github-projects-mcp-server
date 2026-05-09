# Story 10: Phase 2.5 — REST API + `scrum_get_burndown`

**Priority:** Should **Size:** L **Story Points:** 8 **Sprint:** Sprint 3 **Status:** Ready for Implementation

---

## Goal

Implement Phase 2.5: add a typed REST helper (`rest<T>()`) to the service layer and use it to power the `scrum_get_burndown` read tool. When complete, the agent will be able to ask _"how is the current sprint tracking?"_ and receive a day-by-day burndown series, an ideal line, and a per-story completion breakdown — all in a single tool call.

This is the first and only REST API usage in the server. Everything else is GraphQL. The story introduces a clean REST service primitive that follows the same disciplined contract as the existing `graphql()` helper, then builds `scrum_get_burndown` on top of it using the helper-extraction pattern already established in Story 9.

---

## Prerequisites — What Is Already Done

Before starting, verify the following are in place (all completed in Phases 1 and 2):

| Item | File | Status |
|---|---|---|
| `GetBurndownSchema` | `src/schemas/scrum.ts` | ✅ Done |
| `resolveSprint` | `src/services/resolver.ts` | ✅ Done |
| `loadConfig` / `RuntimeConfig` | `src/services/config.ts` | ✅ Done |
| `fetchAllItems` (paginated) | `src/tools/scrum-read.ts` | ✅ Done |
| `classifyLabels` | `src/tools/scrum-read.ts` | ✅ Done (Story 9) |
| `extractBoardFields` | `src/tools/scrum-read.ts` | ✅ Done (Story 9) |
| `GitHubApiError` class | `src/services/github.ts` | ✅ Done |
| `graphql()` helper | `src/services/github.ts` | ✅ Reference implementation for `rest()` |

Story 10 adds everything that is **not** on this list. No previously merged code changes.

---

## Background: Why Two Data Paths

GitHub does not expose intra-sprint project field change history over GraphQL at any plan tier. To know _when_ a story moved to Done, the tool must reach the REST API:

**Path A — Enterprise Audit Log** (`GET /orgs/{org}/audit-log`): precise field-change timestamps. GitHub Enterprise Cloud and Server only. Tried first; degrades on HTTP 403.

**Path B — Issue Close Proxy** (`GET /repos/{owner}/{repo}/issues/{number}/timeline`): uses the `closed` event timestamp as a proxy. Available on all plan tiers. Valid only if the team closes issues when marking them Done. The tool warns the agent when it falls back to this path.

The `data_source` field is always returned — the agent uses it to communicate accuracy to the user, never silently presenting proxy data as authoritative.

---

## Clean Code Analysis — Refactoring as Implementation Design

> _"The ratio of time spent reading versus writing code is well over 10:1."_
> — Robert C. Martin, *Clean Code*

Phase 2.5 is the most algorithmically complex handler in the server. Left unaddressed, all of its logic — REST calls, fallback branching, two independent series computations, per-story aggregation — would produce a 150-line handler that reads as a wall of imperative code and cannot be tested without a live GitHub connection.

The refactoring work in this story is **proactive** rather than corrective. Instead of writing the handler inline and extracting later, we apply clean code principles from the start:

### Clean Code Issue 1 — Handler must not do multiple things (SRP, Functions)

**The smell (hypothetical, if we did it the naive way):** A single `async (params) => { ... }` closure that loads config, resolves the sprint, fetches items, calls two different REST endpoints, branches on HTTP 403, builds a day series, builds an ideal line, and assembles the response — all in one body.

> _"A function should do one thing. If you can extract a meaningful named function from it with a name that is not a restatement of its implementation, it does more than one thing."_

**The fix:** Decompose the handler into seven named helpers. The handler body becomes a six-step orchestration sequence. Each step is a single named function call. No inline logic. This is the same pattern established by Story 9's `scrum_get_story` refactor — we apply it from the start here.

### Clean Code Issue 2 — Network calls must not be mixed with computation (Side Effects, SRP)

**The smell:** `buildDaySeries` takes a `Map<number, string>` of completion timestamps and computes remaining/completed points for each day — a pure calculation. If the timestamp resolution is done inside it, the function has a hidden side effect (network call) that its name doesn't advertise, and it becomes untestable in isolation.

> _"Side effects are lies. Your function promises to do one thing, but it also does other hidden things."_

**The fix:** Three functions with strictly separated concerns:
- `resolveCompletionTimestamps` — network, branching between data paths, returns a `CompletionResult`
- `buildDaySeries` — pure arithmetic, no network, takes a `Map<number, string>` as input
- `buildIdealLine` — pure arithmetic, no inputs from the network at all

### Clean Code Issue 3 — The `rest<T>()` return type must anticipate its callers (Minimal Surprise, Functions)

**The smell:** If `rest<T>()` returns only `T`, the audit log pagination loop requires a second `fetch` call just to read the `Link` header it already received. The caller's loop becomes: fetch → parse → discover next URL → fetch again.

> _"The ideal number of arguments for a function is zero... Arguments are hard. They require conceptual power."_ — and any argument that exists only to paper over a missing return value is a design smell in the API.

**The fix:** `rest<T>()` returns `RestResponse<T>` — a typed wrapper with both `data: T` and `linkHeader: string | null`. The header costs nothing extra (it's already on the response). Non-paginating callers simply ignore `linkHeader`. The function's name and signature honestly communicate what it provides.

### Clean Code Issue 4 — `buildBurndownStoryInput` must not reuse `buildStoryFromRaw` (DRY vs. wrong abstraction)

**The smell:** `buildStoryFromRaw` builds a full `Story` object with title, body, type, status, sprint, points, priority, assignees, labels, epic, timestamps, and URL. Burndown only needs `number`, `title`, `points`, and `status`. Reusing `buildStoryFromRaw` couples the burndown path to a much heavier projection and violates the principle that abstractions should fit their use case.

> _"Duplication may be the root of all evil in software. And yet... the wrong abstraction is worse than duplication."_

**The fix:** A separate, minimal `buildBurndownStoryInput` that returns `BurndownStoryInput`. It shares the `extractBoardFields` helper (correctly — that's the right abstraction level), but produces only the four fields burndown computation actually needs. No wasted field resolution, no coupling to the full `Story` type.

### Clean Code Issue 5 — `extractLinkHeader` must be exported and pure (Testability, Kent Beck Rule 1)

`extractLinkHeader` parses `Link: <url>; rel="next", <url>; rel="last"` headers with a regex. Regex parsing is easy to get wrong and hard to verify from a multi-step integration test. Exporting it as a pure, single-purpose function makes it trivially testable: five input/output pairs cover every edge case without any network involvement.

> _"Runs all the tests"_ — Kent Beck's Rule 1 of Simple Design. An untested regex that is only exercised via live API calls is not testable in the Clean Code sense.

---

## Acceptance Criteria

1. **`rest<T>()` in `src/services/github.ts`** — single-request helper. Same `AbortController` timeout (30 s), same 401/403/non-2xx error classification, same `log.debug` instrumentation as `graphql()`. Returns `RestResponse<T>` with both `data: T` and `linkHeader: string | null`.

2. **`REQUIRED_PERMISSION` map extended** — `get_issue_timeline: "Issues: Read"` and `get_audit_log: "Organization: Read (Enterprise only)"` added so `enrichError` can surface actionable hints on a 403.

3. **Burndown types in `src/types.ts`** — `BurndownResponse`, `BurndownSprintMeta`, `BurndownDayPoint`, `IdealDayPoint`, `BurndownStory` declared in a new `// ── Burndown types ──` section.

4. **Tool registration** — `scrum_get_burndown` registered inside `registerScrumReadTools` with MCP metadata (title, description, inputSchema via `GetBurndownSchema`, annotations: `{ readOnlyHint: true }`).

5. **Sprint targeting** — accepts optional `sprint: SprintRef`, defaults to `"current"`. Returns a clear error if the resolved sprint is `null` (i.e., the backlog — burndown does not apply to the backlog).

6. **`data_source` always returned** — either `"audit_log"` or `"issue_close_proxy"`. Never absent from the response.

7. **`warning` field on proxy path** — when falling back to issue close events, the response includes a `warning` string. The agent must surface this to the user before presenting the chart.

8. **`series` array** — one entry per calendar day from `sprint.start_date` to `min(today, sprint.end_date)`. Each entry: `{ date: YYYY-MM-DD, remaining_points, completed_points }`. UTC midnight used for all date arithmetic.

9. **`ideal` array** — one entry per calendar day from `sprint.start_date` to `sprint.end_date` (inclusive). Straight-line from `committed_points` on day 0 to `0` on the last day. Pure computation — no data dependency.

10. **`stories` array** — per-story summary with `number`, `title`, `points`, `status`, and `completed_at` (ISO-8601 or `null`). Unpointed stories included at `points: 0`.

11. **Handler reads as orchestration only** — the registered handler body contains only: config bootstrap, sprint resolution, `fetchAllItems` + filter, `buildSprintWindow`, `resolveCompletionTimestamps`, `buildDaySeries`, `buildIdealLine`, and response assembly. No inline branching, no inline date arithmetic.

12. **All pure helpers exported** — `extractLinkHeader`, `buildSprintWindow`, `buildIdealLine`, `buildDaySeries`, and `buildBurndownStoryInput` are all exported so tests can import them directly.

13. **Type-check passes** — `deno check src/index.ts` returns no errors after all changes.

14. **Unit tests** — all pure helpers covered in `src/tools/scrum-read_test.ts` without network mocks.

---

## New Types — `src/types.ts`

Add in a new `// ── Burndown types ──` section after the existing `// ── Backlog types ──` section:

```typescript
// ── Burndown types (scrum_get_burndown) ──────────────────────────────────────

/** Response shape for scrum_get_burndown. */
export interface BurndownResponse {
  sprint: BurndownSprintMeta;
  data_source: "audit_log" | "issue_close_proxy";
  warning?: string;
  series: BurndownDayPoint[];
  ideal: IdealDayPoint[];
  stories: BurndownStory[];
}

/** Sprint window metadata returned alongside the burndown series. */
export interface BurndownSprintMeta {
  name: string;
  start_date: string;        // YYYY-MM-DD
  end_date: string;          // YYYY-MM-DD
  duration_days: number;
  days_remaining: number;
}

/** One entry in the actual burndown series — one per calendar day. */
export interface BurndownDayPoint {
  date: string;              // YYYY-MM-DD
  remaining_points: number;
  completed_points: number;
}

/** One entry in the ideal burndown line — one per calendar day. */
export interface IdealDayPoint {
  date: string;              // YYYY-MM-DD
  remaining_points: number;
}

/** Lightweight per-story summary in the burndown response. */
export interface BurndownStory {
  number: number;
  title: string;
  points: number;            // 0 if the story has no points assigned
  status: string | null;
  completed_at: string | null; // ISO-8601 timestamp, or null if not yet done
}
```

These are the **public contract types** — the agent and any downstream consumer depends on this shape. Internal shapes used only inside the tool implementation stay local to `scrum-read.ts`.

---

## Part 1 — `rest<T>()` in `src/services/github.ts`

### Why `RestResponse<T>` instead of bare `T`

The audit log pagination loop must follow `Link: <url>; rel="next"` headers across pages. If `rest<T>()` returned only `T`, the loop would need a second HTTP call just to inspect a header already received on the first response — wasting a round-trip and breaking the single-responsibility of the helper.

Returning `{ data: T; linkHeader: string | null }` costs nothing (the header is always present on the response object) and lets all callers — paginating or not — work from a single call result. Non-paginating callers (the issue timeline path) simply ignore `linkHeader`.

### Types to add

```typescript
export interface RestResponse<T> {
  data: T;
  linkHeader: string | null;
}
```

### Signature

```typescript
/**
 * Make a single GitHub REST API request.
 *
 * Base URL: https://api.github.com
 * Auth:     Bearer GITHUB_TOKEN (same env var as graphql())
 * Timeout:  30 s via AbortController (same pattern as graphql())
 *
 * Returns { data, linkHeader } so callers can paginate via the Link header
 * without a second HTTP round-trip.
 *
 * Throws GitHubApiError on 401, 403, and non-2xx responses —
 * same classification as graphql().
 */
export const rest = async <T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    params?: Record<string, string>;
    body?: unknown;
    accept?: string;
  } = {},
): Promise<RestResponse<T>>
```

### Implementation contract

- Base URL: `https://api.github.com`
- Default `Accept: application/vnd.github+json` — GitHub's recommended header
- `X-GitHub-Api-Version: 2022-11-28` — locks the API version explicitly
- `Authorization: Bearer {GITHUB_TOKEN}` via `getToken()` (same as `graphql()`)
- `params` appended as a query string via `URLSearchParams`
- Non-GET: `body` JSON-serialised; `Content-Type: application/json` added
- Body parsed as `response.json() as T` — no `data` wrapper (REST responses are top-level, unlike GraphQL)
- Log lines: `log.debug(\`→ rest:GET ${path}\`, params)` on entry; `← rest:GET ${path} OK (${ms}ms)` on success
- Error handling mirrors `graphql()` exactly: `AbortError` → 30 s timeout message, `401` → auth failed, `403` → rate limit / permission denied, non-2xx → generic HTTP error

### `REQUIRED_PERMISSION` additions

```typescript
get_issue_timeline: "Issues: Read",
get_audit_log:      "Organization: Read (Enterprise only — requires GHES or GHEC)",
```

---

## Part 2 — Burndown Helpers in `src/tools/scrum-read.ts`

Add all helpers in a new `// ── Burndown helpers ──` section below the existing Story 9 helpers. Register the tool at the end of `registerScrumReadTools`.

### Local-only interfaces (not exported — burndown internals)

```typescript
/** Result of the completion-timestamp resolution step. */
interface CompletionResult {
  /** Issue number → ISO-8601 completion timestamp. Only includes done stories. */
  completions: Map<number, string>;
  data_source: "audit_log" | "issue_close_proxy";
  warning?: string;
}

/** Minimal story projection needed for burndown series computation. */
interface BurndownStoryInput {
  number: number;
  title: string;
  points: number;
  status: string | null;
}

/** Computed sprint window — pure derivation of an IterationEntry. */
interface SprintWindow {
  name: string;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  daysRemaining: number;
}
```

### Helper 1 — `buildSprintWindow` (exported, pure)

Derives the sprint window from an `IterationEntry`. Normalises all `Date` objects to UTC midnight to avoid timezone edge cases in day-boundary arithmetic — the same fix documented in Story 8's `buildSprintMeta`.

```typescript
/**
 * Compute the sprint window from an IterationEntry.
 * All Date objects are normalised to UTC midnight to guarantee
 * consistent day-boundary arithmetic regardless of the server's timezone.
 */
export const buildSprintWindow = (iterEntry: IterationEntry): SprintWindow => {
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

  return { name: iterEntry.title, startDate, endDate, durationDays: iterEntry.duration, daysRemaining };
};
```

### Helper 2 — `buildIdealLine` (exported, pure)

Straight-line from `committedPoints` on day 0 to `0` on the last day. No data dependency — computed entirely from sprint geometry.

```typescript
/**
 * Compute the ideal burndown line: one entry per calendar day from
 * start_date to end_date inclusive.
 *
 * Values are rounded to one decimal place to avoid floating-point noise
 * in JSON output (e.g., 13.333333... → 13.3).
 */
export const buildIdealLine = (
  window: SprintWindow,
  committedPoints: number,
): IdealDayPoint[] => {
  const ideal: IdealDayPoint[] = [];
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

### Helper 3 — `buildDaySeries` (exported, pure)

Builds the actual burndown series from completion timestamps already resolved by the network layer. The network/pure separation is deliberate — this function has no side effects.

```typescript
/**
 * Build the actual burndown series: one entry per calendar day from
 * sprint.start_date to min(today, sprint.end_date).
 *
 * A story counts as completed on day D if its completed_at timestamp
 * falls on or before the end of day D (UTC 23:59:59.999).
 */
export const buildDaySeries = (
  stories: BurndownStoryInput[],
  completions: Map<number, string>,
  window: SprintWindow,
  committedPoints: number,
): BurndownDayPoint[] => {
  const series: BurndownDayPoint[] = [];
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const seriesEnd = window.endDate < today ? window.endDate : today;
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

### Helper 4 — `extractLinkHeader` (exported, pure)

Parses the GitHub `Link` response header to find `rel="next"`. Exported because it contains regex logic that deserves its own unit tests — isolated from any network call.

```typescript
/**
 * Parse a GitHub REST API `Link` response header and return the URL for
 * rel="next", or null if absent or on the last page.
 *
 * Link header format: <url>; rel="next", <url>; rel="last"
 */
export const extractLinkHeader = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
};
```

### Helper 5 — `buildBurndownStoryInput` (exported)

A minimal projection from a `RawItem`. Distinct from `buildStoryFromRaw` — that function builds the full `Story` type including body, URL, timestamps, and epic. Burndown only needs four fields. Sharing `buildStoryFromRaw` would couple the burndown path to a heavier projection and resolve fields that are never consumed.

Both functions correctly share `extractBoardFields` — the field-value extraction logic is the right shared abstraction.

```typescript
/**
 * Project a RawItem to the four fields burndown computation needs.
 * Returns null for DraftIssues and items with no issue content.
 *
 * Distinct from buildStoryFromRaw: burndown needs only number, title,
 * points, and status — not body, URL, epic, assignees, or timestamps.
 * Reusing buildStoryFromRaw would resolve fields that are never consumed.
 */
export const buildBurndownStoryInput = (
  item: RawItem,
  config: RuntimeConfig,
): BurndownStoryInput | null => {
  const content = item.content;
  if (!content || typeof content.number !== "number") return null;

  const { status, story_points } = extractBoardFields(
    item.fieldValues.nodes,
    config.fields,
  );

  return {
    number: content.number,
    title: content.title,
    points: story_points ?? 0,
    status,
  };
};
```

### Helper 6 — `fetchAuditLogCompletions` (module-private, network)

Enterprise Audit Log path. Paginates until the last event timestamp exceeds `window.endDate`. Throws `GitHubApiError(403)` on free/Team plans — caller catches and falls back.

**The node-ID problem:** The audit log identifies project items by `data.project_item_node_id` (`PVTI_...`), not by issue number. The function therefore accepts a `nodeIdToNumber: Map<string, number>` built from the same `allItems` fetch already performed by the handler. This keeps the function honest — it never makes a secondary network call to resolve IDs.

```typescript
/** @internal Network-bound. Throws GitHubApiError(403) on non-Enterprise accounts. */
const fetchAuditLogCompletions = async (
  nodeIdToNumber: Map<string, number>,
  window: SprintWindow,
  org: string,
  doneStatusName: string,
  statusFieldName: string,
): Promise<Map<number, string>> => { ... }
```

Internal contract:
- `GET /orgs/{org}/audit-log?phrase=action:projects_v2_item.field_value_updated&order=asc&per_page=100`
- Filter entries where `data.field_type === "single_select"`, `data.field_name === statusFieldName`, `data.value === doneStatusName`
- Translate `data.project_item_node_id` → issue number via `nodeIdToNumber`
- Paginate via `extractLinkHeader(linkHeader)` until last entry's `created_at` exceeds `window.endDate`
- Last "moved to Done" wins if a story moved to Done more than once (e.g., un-Done then re-Done)
- Returns `Map<number, string>` — issue number → ISO completion timestamp

### Helper 7 — `fetchIssueCloseCompletions` (module-private, network)

Issue Close Proxy path. Available on all plan tiers. Sequential — N REST calls, one per story.

```typescript
/** @internal Network-bound. Available on all GitHub plan tiers. */
const fetchIssueCloseCompletions = async (
  stories: BurndownStoryInput[],
  window: SprintWindow,
  owner: string,
  repo: string,
): Promise<Map<number, string>> => { ... }
```

Internal contract:
- For each story: `GET /repos/{owner}/{repo}/issues/{number}/timeline?per_page=100`
- Find the **last** `closed` event whose `created_at` falls within `[window.startDate, window.endDate]`
- Stories with no qualifying close event get no entry (their `completed_at` will be `null`)
- Sequential, not parallelised in v1 — typical sprints are ≤ 50 stories, well within the 5 000 req/hr REST limit

### Helper 8 — `resolveCompletionTimestamps` (module-private, orchestration)

The single point where the audit-log/proxy branching decision is made. The handler calls only this function — it never branches on `data_source` directly.

```typescript
/**
 * Resolve completion timestamps for sprint stories.
 * Tries the Enterprise Audit Log first; falls back to issue close events on 403.
 *
 * The handler delegates all data-path branching here so its own body
 * remains a linear orchestration sequence with no conditional logic.
 */
const resolveCompletionTimestamps = async (
  stories: BurndownStoryInput[],
  nodeIdToNumber: Map<string, number>,
  window: SprintWindow,
  config: RuntimeConfig,
  owner: string,
  repo: string,
): Promise<CompletionResult> => {
  const doneStatusName = findDoneStatusName(config); // see note below
  const statusFieldName = config.yml.field_names.status;

  try {
    const completions = await fetchAuditLogCompletions(
      nodeIdToNumber, window, owner, doneStatusName, statusFieldName,
    );
    return { completions, data_source: "audit_log" };
  } catch (err) {
    if (!(err instanceof GitHubApiError) || err.statusCode !== 403) throw err;
    // 403 = not an Enterprise account; degrade gracefully to the proxy path
  }

  const completions = await fetchIssueCloseCompletions(stories, window, owner, repo);
  return {
    completions,
    data_source: "issue_close_proxy",
    warning:
      "Burndown timestamps are inferred from issue close events, not board field changes. " +
      "This is accurate only if your team closes GitHub Issues when moving stories to Done. " +
      "Stories marked Done but not closed will appear with completed_at: null.",
  };
};
```

`findDoneStatusName` is a focused, named helper that resolves the "Done" display name from `config.yml.status` — it avoids inline config traversal in `resolveCompletionTimestamps`:

```typescript
/**
 * Resolve the display name for the "done" status from config vocabulary.
 * Falls back to "Done" if the vocabulary entry is missing or has no display_name.
 */
const findDoneStatusName = (config: RuntimeConfig): string =>
  config.yml.status?.done?.display_name ?? "Done";
```

### The Handler — Orchestration Only

After all helpers, the registered handler body is a clean six-step sequence with no inline logic:

```typescript
async (params: z.infer<typeof GetBurndownSchema>) => {
  try {
    const { owner, ownerType, projectNumber } = getBootstrapConfig();
    const repo = getRepo();
    const config = await loadConfig({ github: gh, owner, ownerType, projectNumber, repo });

    // Step 1 — Resolve sprint
    const sprintRef = params.sprint ?? "current";
    const iterationId = resolveSprint(sprintRef, config);
    if (iterationId === null) {
      return burndownBacklogError();
    }
    const iterEntry = config.iterations.all.find((i) => i.id === iterationId);
    if (!iterEntry) throw new Error(`Sprint "${sprintRef}" resolved to an unknown iteration ID.`);

    // Step 2 — Fetch sprint stories
    const allItems = await fetchAllItems(config, owner, ownerType);
    const sprintItems = allItems.filter((item) => itemIsInIteration(item, iterationId, config));

    const stories = sprintItems
      .map((item) => buildBurndownStoryInput(item, config))
      .filter((s): s is BurndownStoryInput => s !== null);

    const nodeIdToNumber = buildNodeIdMap(sprintItems);

    // Step 3 — Compute sprint geometry
    const window = buildSprintWindow(iterEntry);
    const committedPoints = stories.reduce((sum, s) => sum + s.points, 0);

    // Step 4 — Resolve completion timestamps (audit log → proxy fallback)
    const { completions, data_source, warning } =
      await resolveCompletionTimestamps(stories, nodeIdToNumber, window, config, owner, repo);

    // Step 5 — Build series and ideal line
    const series = buildDaySeries(stories, completions, window, committedPoints);
    const ideal  = buildIdealLine(window, committedPoints);

    // Step 6 — Assemble and return
    const response = assembleBurndownResponse(
      window, data_source, warning, series, ideal, stories, completions,
    );

    return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
  }
},
```

Supporting named helpers (module-private, focused):

```typescript
// Keeps the handler free of inline branching for the backlog-ref guard.
const burndownBacklogError = () => ({
  content: [{
    type: "text" as const,
    text: JSON.stringify({
      message: "scrum_get_burndown requires a sprint reference. " +
        "Pass a sprint name or omit the field to default to the current sprint. " +
        "Burndown charts do not apply to the backlog.",
    }),
  }],
});

// Keeps the iteration filter readable at the call site.
const itemIsInIteration = (
  item: RawItem,
  iterationId: string,
  config: RuntimeConfig,
): boolean => {
  const fv = item.fieldValues.nodes.find(
    (v) => v.field?.id === config.fields.sprintFieldId,
  );
  return fv?.iterationId === iterationId;
};

// Builds the node-ID → issue-number lookup table from the same allItems fetch.
const buildNodeIdMap = (items: RawItem[]): Map<string, number> =>
  new Map(
    items
      .filter((item) => typeof item.content?.number === "number")
      .map((item) => [item.id, item.content!.number!]),
  );

// Assembles the final BurndownResponse — keeps object construction out of the handler.
const assembleBurndownResponse = (
  window: SprintWindow,
  data_source: "audit_log" | "issue_close_proxy",
  warning: string | undefined,
  series: BurndownDayPoint[],
  ideal: IdealDayPoint[],
  stories: BurndownStoryInput[],
  completions: Map<number, string>,
): BurndownResponse => {
  const sprint: BurndownSprintMeta = {
    name: window.name,
    start_date: window.startDate.toISOString().slice(0, 10),
    end_date: window.endDate.toISOString().slice(0, 10),
    duration_days: window.durationDays,
    days_remaining: window.daysRemaining,
  };

  const burndownStories: BurndownStory[] = stories.map((s) => ({
    number: s.number,
    title: s.title,
    points: s.points,
    status: s.status,
    completed_at: completions.get(s.number) ?? null,
  }));

  return warning
    ? { sprint, data_source, warning, series, ideal, stories: burndownStories }
    : { sprint, data_source, series, ideal, stories: burndownStories };
};
```

---

## File Changes

| File | Change |
|---|---|
| `src/services/github.ts` | Add `RestResponse<T>` interface; add `rest<T>()` function; add `get_issue_timeline` and `get_audit_log` to `REQUIRED_PERMISSION` |
| `src/types.ts` | Add `BurndownResponse`, `BurndownSprintMeta`, `BurndownDayPoint`, `IdealDayPoint`, `BurndownStory` in a new `// ── Burndown types ──` section |
| `src/tools/scrum-read.ts` | Add import for `rest`, `RestResponse` from `../services/github.ts`; add import for burndown types from `../types.ts`; add import for `GetBurndownSchema` from `../schemas/scrum.ts`; add all local interfaces and helpers in `// ── Burndown helpers ──` section; register `scrum_get_burndown` in `registerScrumReadTools` |
| `src/tools/scrum-read_test.ts` | Add unit tests for `extractLinkHeader`, `buildSprintWindow`, `buildIdealLine`, `buildDaySeries`, `buildBurndownStoryInput` |

`src/schemas/scrum.ts` and `src/index.ts` are **untouched** — `GetBurndownSchema` is already present; adding a tool inside `registerScrumReadTools` is transparent to `index.ts`.

---

## Testing Plan

All tests in `src/tools/scrum-read_test.ts`. Network-bound helpers (`fetchAuditLogCompletions`, `fetchIssueCloseCompletions`, `resolveCompletionTimestamps`) are integration-layer concerns — they are not unit-tested here. Every exported pure helper is tested directly.

### `extractLinkHeader`

| Test case | Input | Expected |
|---|---|---|
| Single `next` link | `'<https://api.github.com/page2>; rel="next"'` | `"https://api.github.com/page2"` |
| Last page (no `next`) | `'<url>; rel="last"'` | `null` |
| Null header | `null` | `null` |
| Multiple rels | `'<url1>; rel="prev", <url2>; rel="next"'` | `"url2"` |
| Extra whitespace around `;` | `'<url>;\t rel="next"'` | `"url"` |

### `buildSprintWindow`

| Test case | Scenario |
|---|---|
| Active sprint | `daysRemaining > 0`; `endDate = startDate + duration` |
| Sprint ended yesterday | `daysRemaining === 0` |
| Timezone boundary | UTC midnight normalisation applied; `days_remaining` is not off by ±1 |

### `buildIdealLine`

| Test case | Scenario |
|---|---|
| 10-day sprint, 20 pts | `ideal[0].remaining_points === 20`; `ideal[10].remaining_points === 0`; array length === 11 |
| 0 committed points | All entries are `remaining_points: 0` |
| Rounding | Values rounded to 1 decimal place (e.g. 13.333... → 13.3) |

### `buildDaySeries`

| Test case | Scenario |
|---|---|
| No completions | All entries: `completed_points: 0`, `remaining_points: committedPoints` |
| Story completes on day 3 | Days 0–2 unaffected; day 3 onward reflects completion |
| Sprint already ended | Series ends at `endDate`, not today |
| Multiple completions same day | Both deducted in that day's entry |
| 0-pt story completes | `completed_points` and `remaining_points` unaffected |
| Story completed before sprint start | Not counted (timestamp outside sprint window) |

### `buildBurndownStoryInput`

| Test case | Scenario |
|---|---|
| Normal issue item | Returns `{ number, title, points, status }` |
| DraftIssue (no `number`) | Returns `null` |
| Unpointed story | Returns `points: 0` |
| `storyPointsFieldId` is null in config | No crash; returns `points: 0` |

---

## Implementation Order

| Step | File | What | Est. |
|---|---|---|---|
| 1 | `src/services/github.ts` | Add `RestResponse<T>` interface; implement `rest<T>()`; add `REQUIRED_PERMISSION` entries | 20 min |
| 2 | `src/types.ts` | Add burndown types block | 10 min |
| 3 | `src/tools/scrum-read.ts` | Add local interfaces: `CompletionResult`, `BurndownStoryInput`, `SprintWindow` | 5 min |
| 4 | `src/tools/scrum-read.ts` | Add pure helpers: `buildSprintWindow`, `buildIdealLine`, `buildDaySeries`, `extractLinkHeader` | 25 min |
| 5 | `src/tools/scrum-read.ts` | Add `findDoneStatusName`, `buildBurndownStoryInput` | 10 min |
| 6 | `src/tools/scrum-read.ts` | Add `fetchIssueCloseCompletions` (proxy path) | 20 min |
| 7 | `src/tools/scrum-read.ts` | Add `fetchAuditLogCompletions` with `nodeIdToNumber` map (audit log path) | 25 min |
| 8 | `src/tools/scrum-read.ts` | Add `resolveCompletionTimestamps` orchestrator | 10 min |
| 9 | `src/tools/scrum-read.ts` | Add module-private helpers: `burndownBacklogError`, `itemIsInIteration`, `buildNodeIdMap`, `assembleBurndownResponse` | 15 min |
| 10 | `src/tools/scrum-read.ts` | Register `scrum_get_burndown` in `registerScrumReadTools` | 15 min |
| 11 | — | `deno check src/index.ts` — must pass clean | 5 min |
| 12 | `src/tools/scrum-read_test.ts` | Write unit tests for all five exported pure helpers | 45 min |
| 13 | — | Cross-check response shape against `docs/BURNDOWN.md` tool contract | 5 min |

**Estimated total effort: ~3.5 hours**

---

## Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `GetBurndownSchema` in `src/schemas/scrum.ts` | ✅ Done | `z.object({ sprint: SprintRefSchema.optional() }).strict()` |
| `resolveSprint` in `src/services/resolver.ts` | ✅ Done | Resolves `SprintRef` → iteration ID or `null` |
| `loadConfig` / `RuntimeConfig` | ✅ Done | Provides field IDs, iteration entries, vocabulary |
| `fetchAllItems` in `src/tools/scrum-read.ts` | ✅ Done | Returns all project items, paginated |
| `extractBoardFields` in `src/tools/scrum-read.ts` | ✅ Done | Shared field-value extraction; `buildBurndownStoryInput` calls this |
| `GitHubApiError` class | ✅ Done | Used for REST error classification and the 403 fallback trigger |
| `graphql()` in `src/services/github.ts` | ✅ Done | Reference implementation — `rest()` mirrors its patterns exactly |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Audit log `projects_v2_item.field_value_updated` action doesn't exist or differs on GHEC | High | Treat a zero-result audit log (not a 403) as a graceful fallback; add `data_source_note` field if needed |
| Issues not closed when moved to Done (proxy path inaccuracy) | Medium | `warning` field explicitly tells the agent; agent must surface this before presenting the chart |
| Audit log returns node IDs not matching `allItems` node IDs | Medium | `buildNodeIdMap` is built from the same `allItems` fetch — the mapping is always in sync |
| `days_remaining` timezone off-by-one | Low | `setUTCHours(0,0,0,0)` applied consistently; unit test covers this boundary |
| `rest<T>()` called with a non-JSON response (e.g., 204 No Content) | Low | Burndown only calls endpoints that return JSON; document this constraint in the function JSDoc |
| Large sprint (> 100 stories) on proxy path | Low | Sequential calls; 100 stories = ~100 REST calls, well within 5,000/hr limit; document the trade-off |

---

## Open Questions (Carried from `docs/BURNDOWN.md`)

| Question | Status |
|---|---|
| Does `projects_v2_item.field_value_updated` exist in the audit log for GHEC? | Needs verification against a live Enterprise account before Step 7 |
| Should `include_weekends: boolean` be added to skip non-working days? | Deferred — v1 includes all calendar days |
| Should the ideal line use team capacity rather than a straight line? | Deferred — straight line is the Scrum standard; capacity-adjusted ideal is a v2 option |
