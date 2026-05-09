# Story A: Quality Fixes (§5)

**Epic:** [Refactoring Plan](../REFACTORING.md)\
**Priority:** P0 — Prerequisite for all structural work\
**Dependencies:** None (first group to execute)

---

## Title: Fix Known Quality Issues Before Structural Refactoring

As a **developer maintaining the MCP server**,\
I want to fix all known quality issues in the codebase,\
So that I can proceed with structural refactoring without propagating bugs or technical debt.

---

## Acceptance Criteria

1. `scrum_get_backlog` tool description matches actual JSON response keys
2. Dead code (`_classifyReadiness`) is removed
3. Inconsistent status name resolution is consolidated into a single helper
4. Bootstrap boilerplate is extracted into a reusable helper
5. `deno check src/index.ts` passes clean
6. No behavioral changes — all fixes are internal improvements

---

## Subtasks

### A1: Fix `scrum_get_backlog` Tool Description Readiness Keys

**Title:** Fix `scrum_get_backlog` tool description to match actual response keys

As a **developer using the MCP server**,\
I want the `scrum_get_backlog` tool description to accurately reflect the response schema,\
So that agents parsing the response can correctly access readiness data.

**Acceptance Criteria:**

1. Tool description uses `ready`, `partially_ready`, `not_ready` instead of `sprint_ready`, `in_refinement`, `future_candidate`
2. No changes to the actual JSON response shape — only the description is corrected
3. Agent documentation references the correct keys

**Files:**

- [`src/tools/scrum-read.ts`](../../src/tools/scrum-read.ts) — update tool description

**Severity:** High — agents will fail to parse readiness data with wrong keys

---

### A2: Delete Dead Code `_classifyReadiness`

**Title:** Remove dead code `_classifyReadiness` function

As a **developer maintaining the codebase**,\
I want to remove unused functions,\
So that the codebase stays clean and developers aren't confused about which function to use.

**Acceptance Criteria:**

1. `_classifyReadiness` function is completely removed from [`src/tools/scrum-read.ts`](../../src/tools/scrum-read.ts)
2. No other code references this function
3. Actual readiness computation via [`src/services/readiness.ts`](../../src/services/readiness.ts) remains intact
4. `deno check src/index.ts` passes

---

### A3: Consolidate Status Name Resolution Functions

**Title:** Consolidate `findStatusDisplayName` and `findDoneStatusName` into single helper

As a **developer maintaining the codebase**,\
I want a single authoritative function for resolving status display names,\
So that there is no risk of type mismatch between incompatible casts of `yml.status`.

**Acceptance Criteria:**

1. Audit the actual `config.yml` schema to determine the correct `yml.status` type
2. Create `resolveStatusDisplayName(config, statusKey, fallback)` helper
3. Replace all callers of both `findStatusDisplayName` and `findDoneStatusName` with the new helper
4. Delete the unused function
5. `deno check src/index.ts` passes
6. No behavioral change — same results as before

---

### A4: Extract `loadRuntimeConfig()` Bootstrap Helper

**Title:** Extract bootstrap boilerplate into `loadRuntimeConfig()` helper

As a **developer writing tool handlers**,\
I want a single helper to load runtime configuration,\
So that each handler reduces to one expressive line and the code is DRY.

**Acceptance Criteria:**

1. Create `loadRuntimeConfig()` returning `{ config, owner, ownerType, repo }`
2. All 7 tool handlers in [`src/tools/scrum-read.ts`](../../src/tools/scrum-read.ts) use the new helper
3. Each handler body becomes one line: `const { config, owner, ownerType, repo } = loadRuntimeConfig();`
4. `deno check src/index.ts` passes
5. No behavioral change

> **Lifecycle note:** `loadRuntimeConfig()` is temporary scaffolding. In Story B (step B5), it is
> superseded by `getBootstrapConfig()` + `loadConfig()` from `src/adapters/github/config-loader.ts`
> and is deleted. Do not over-engineer this helper — its only job is eliminating the 4-line
> repetition until the backend abstraction is wired in.

---

## Verification Checklist

- [x] A1: Tool description corrected
- [x] A1: Regression verified — invoke `scrum_get_backlog` and confirm response contains `ready`, `partially_ready`, `not_ready` keys (not the old `sprint_ready`, `in_refinement`, `future_candidate`)
- [x] A2: Dead code deleted
- [x] A3: Status resolution consolidated
- [x] A4: Bootstrap helper extracted
- [x] `deno check src/index.ts` passes
- [x] All existing tests pass
- [x] No behavioral changes introduced
