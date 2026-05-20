# Unit Test Plan: `src/scrum/get-history.ts`

## Module Under Test

[`src/scrum/get-history.ts`](../src/scrum/get-history.ts:1) exports one public function:

```ts
export const getHistoryUseCase = async (
  backend: HistoryPort & ImpedimentPort,
  scrumConfig: ScrumConfig,
  window: number,
): Promise<GetHistoryResult>
```

### Return Type

```ts
interface GetHistoryResult {
  sprints: SprintSnapshot[];
  window: number;
  average_completed_points: number;
}
```

### Dependencies (ports)

| Port             | Method Used                         | Purpose                                             |
| ---------------- | ----------------------------------- | --------------------------------------------------- |
| `HistoryPort`    | `getCompletedSprintHistory(window)` | Fetches completed sprint entries                    |
| `ImpedimentPort` | `getSprintImpediments(sprint)`      | Fetches impediments per sprint                      |
| `ImpedimentPort` | `updateImpediment(...)`             | **Not called** — stub only for interface compliance |

### Internal Helpers (tested indirectly via public API)

1. [`projectStoriesToListings()`](../src/scrum/get-history.ts:31) — maps `BurndownStoryInput[]` → `StoryListing[]` (writable=false, priority=null)
2. [`computeTotals()`](../src/scrum/get-history.ts:49) — computes `by_status`, `committed_points`, `completed_points` using [`isTerminalStatus()`](../src/domain/rules/status.ts:16)
3. [`entryToSnapshot()`](../src/scrum/get-history.ts:72) — async, converts `SprintHistoryEntry` → `SprintSnapshot`, fetches impediments

---

## Pattern Reference

The test file follows the conventions established in:

- [`src/scrum/get-burndown.test.ts`](../src/scrum/get-burndown.test.ts:1) — focused port mock, fixture factories, grouped tests
- [`src/scrum/get-backlog.test.ts`](../src/scrum/get-backlog.test.ts:1) — `createMockBackend()`, `createMockConfig()`, `make*` factories

---

## Fixture Factories

| Factory                              | Returns                        | Notes                                                                                                    |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `makeSprintInfo(overrides?)`         | `SprintInfo`                   | Same shape as get-burndown fixture                                                                       |
| `makeBurndownStoryInput(overrides?)` | `BurndownStoryInput`           | Includes optional `ref`                                                                                  |
| `makeSprintHistoryEntry(overrides?)` | `SprintHistoryEntry`           | Wraps `info: SprintInfo` + `stories: BurndownStoryInput[]`                                               |
| `makeImpedimentListing(overrides?)`  | `ImpedimentListing`            | status: "open" \| "in_progress" \| "resolved"                                                            |
| `createMockBackend(overrides?)`      | `HistoryPort & ImpedimentPort` | Focused — only 3 methods: `getCompletedSprintHistory`, `getSprintImpediments`, `updateImpediment` (stub) |
| `createMockConfig(overrides?)`       | `ScrumConfig`                  | Same pattern as existing tests                                                                           |

---

## Test Groups

### Group A — Window Parameter Passthrough (2 tests)

| Test                                            | What it verifies                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Window is passed to `getCompletedSprintHistory` | Mock captures the `window` argument; default is forwarded verbatim |
| Window appears in the result                    | `result.window` equals the input window                            |

### Group B — Empty History (1 test)

| Test                                | What it verifies                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Empty history returns correct shape | `getCompletedSprintHistory` returns `[]` → `{ sprints: [], window, average_completed_points: 0 }` |

### Group C — SprintSnapshot Shape Mapping (2 tests)

| Test                                    | What it verifies                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sprint geometry fields mapped correctly | `sprint.name`, `start_date`, `end_date`, `duration_days`, `days_remaining=0`                                                          |
| StoryListing projection                 | `writable: false`, `priority: null`, `ref.key` from `String(s.number)`, `ref.id` from `s.ref?.id ?? ""`, `sprint` = entry sprint name |

### Group D — Totals Computation (3 tests)

| Test                                                              | What it verifies                                  |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| committed_points = sum of all story points                        | Multiple stories with various point values        |
| completed_points = sum of points for terminal-status stories only | Some stories Done, some not                       |
| by_status grouping + null status → "(none)"                       | Stories with `status: null` grouped as `"(none)"` |

### Group E — Terminal Status Detection (2 tests)

| Test                                    | What it verifies                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Config-driven terminal status           | `config.scrum.status` declares a terminal status other than "Done"; stories with that status count as completed |
| Fallback to "Done" when no terminal key | Empty `config.scrum.status` → "Done" is the terminal status                                                     |

### Group F — Impediment Fetching (2 tests)

| Test                                                  | What it verifies                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `getSprintImpediments` called with correct SprintName | `toSprintName(entry.info.name)` is passed to the backend          |
| Impediments appear in snapshot                        | `snapshot.impediments` matches the returned `ImpedimentListing[]` |

### Group G — Average Completed Points (3 tests)

| Test                                     | What it verifies                                                     |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Single sprint average                    | `average = completed_points` (rounded to 2 decimals)                 |
| Multiple sprints average                 | `average = sum(all completed_points) / count`, rounded to 2 decimals |
| Zero completed points across all sprints | `average_completed_points = 0`                                       |

### Group H — Multiple Sprint Entries (1 test)

| Test                  | What it verifies                                               |
| --------------------- | -------------------------------------------------------------- |
| All entries processed | `result.sprints.length === entries.length`, ordering preserved |

---

## Mock Backend Contract

```ts
type MockBackend = HistoryPort & ImpedimentPort;

// Methods:
getCompletedSprintHistory(window: number): Promise<SprintHistoryEntry[]>
getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]>
updateImpediment(ref, status, resolutionNotes?): Promise<ImpedimentListing>  // stub
```

The mock uses the same pattern as `get-burndown.test.ts` — a factory function that accepts partial overrides.

---

## Output File

`src/scrum/get-history.test.ts`

## Commands for Verification

```bash
deno test src/scrum/get-history.test.ts
deno lint src/scrum/get-history.test.ts
```
