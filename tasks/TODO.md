# Todo

## Framework Layer Changes

The Framework layer has two existing files (`scrum-read.ts`, `scrum-write.ts`) and needs one new file. The changes fall into three categories.

---

### 1. New file: `src/tools/error-formatter.ts` (from §6e of REFACTORING.md)

`enrichError()`, `formatError()`, and `REQUIRED_PERMISSION` currently live in `services/github.ts`. Both tool files import `enrichError` directly from there — which creates a `tools → GitHub service` dependency that bypasses `ProjectBackend`.

The fix is to **extract those three things into `src/tools/error-formatter.ts`** and update the imports in both tool files. The `github_graphql` tool also imports `graphql` directly from `services/github.ts`; once the §6e split is done, it should import it from `adapters/github/http-client.ts` instead.

---

### 2. Bug: `yml` reference in `scrum-read.ts`

Before touching anything else, there's a live bug: `scrum-read.ts` passes `yml` (undefined in that scope) to five use-case calls — lines 96, 133, 167, 237, and 272. The function parameter is `scrumConfig`. Every one of those calls should pass `scrumConfig`. This is the most immediate thing to fix.

---

### 3. Tool handler updates (from §6b)

**`scrum-read.ts` — three tools need changes:**

`scrum_get_sprint` — the schema gains an `"all"` value for `sprint` and an optional `limit`. The handler needs to branch on whether `sprint === "all"` and return either `{ sprint: SprintSnapshot }` or `{ sprints: SprintSnapshot[], total_count }`. The description should reflect the new `"all"` option.

`scrum_get_backlog` — the description needs to mention the new `orphan_impediments` field in the return shape. The use-case signature may also change (depends on what §6b adds to `get-backlog.ts`), but the handler itself is thin and the description update is the main thing.

`scrum_get_history` — the schema gains a `limit` parameter. The return shape aligns with `scrum_get_sprint("all")` — it becomes `{ sprints: SprintSnapshot[], window, average_completed_points }`. The description should be updated to reflect velocity stats and the new shape.

**`scrum-write.ts` — two tools need changes:**

`scrum_log_impediment` — `affects` becomes **optional** (`affects?`). The current handler hardwires `params.affects` in comment text and comment calls — that logic needs to be conditional (or ideally delegated to the new `log-impediment.ts` use-case file that §6b introduces). The return shape changes from a `Story` object to `{ impediment: ImpedimentListing, affects: ... | null }`. The description needs updating to remove "required" language around `affects`.

`scrum_update_impediment` — **new tool**, entirely new registration block. Takes `{ ref: ImpedimentRef, status, resolution_notes? }` and returns `ImpedimentListing`. Delegates to the new `update-impediment.ts` use case.

---

### Summary table

| File                           | Change                                                                                                      | Source |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------ |
| `src/tools/error-formatter.ts` | **Create** — extract `enrichError`, `formatError`, `REQUIRED_PERMISSION`                                    | §6e    |
| `src/tools/scrum-read.ts`      | Fix `yml` → `scrumConfig` bug (5 sites)                                                                     | Bug    |
| `src/tools/scrum-read.ts`      | Update `enrichError` import to `./error-formatter.ts`                                                       | §6e    |
| `src/tools/scrum-read.ts`      | `scrum_get_sprint` — schema + handler + description for `"all"` + `limit`                                   | §6b    |
| `src/tools/scrum-read.ts`      | `scrum_get_backlog` — description update for `orphan_impediments`                                           | §6b    |
| `src/tools/scrum-read.ts`      | `scrum_get_history` — schema + handler + description for `limit` + new shape                                | §6b    |
| `src/tools/scrum-write.ts`     | Update `enrichError` import to `./error-formatter.ts`; `graphql` import to `adapters/github/http-client.ts` | §6e    |
| `src/tools/scrum-write.ts`     | `scrum_log_impediment` — `affects` optional, new return shape, updated description                          | §6b    |
| `src/tools/scrum-write.ts`     | `scrum_update_impediment` — **add new tool** registration                                                   | §6b    |

---

The logical order to execute this is: fix the `yml` bug first (it's a silent runtime failure), then create `error-formatter.ts` and update imports, then work through the tool handler changes. The tool changes in `scrum-read.ts` and `scrum-write.ts` depend on the use-case and schema changes in §6b being done first — the tool handlers are thin, so they're largely blocked on the lower layers.

Which piece do you want to start with?
