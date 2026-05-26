# TODO — Remaining Implementation Work

Tracks outstanding gaps from the REFACTORING.md tool-surface redesign. Updated after code review of Group A (2026-05-25): wiring is complete but two correctness issues were found. Groups B, C, D are unstarted.

---

## Status at a Glance

| Group | Topic                      | Status                     |
| ----- | -------------------------- | -------------------------- |
| A     | Dependency graph wiring    | ⚠️ Wired — two bugs remain |
| B     | MCP resource for templates | 🔲 Not started             |
| C1    | Sprint-scoped epics        | 🔲 Not started             |
| C2    | Sprint goal                | 🔲 Not started             |
| C3    | workPct in orient          | 🔲 Not started             |
| D1    | Rename tool                | 🔲 Not started             |
| D2    | Deprecate old tool name    | 🔲 Not started (after D1)  |

**Recommended execution order:** A-bugs → D1 (quick) → B1→B2→B3 → C1→C2→C3 → D2

---

## Group A — Dependency Graph Bug Fixes (done)

**Context:** `findItems()` now calls `buildDependencyMap()` when `include_dependencies: true` (A1 ✅), unresolved out-of-scope nodes are looked up in `allItems` (A2 ✅), and draft stories are filtered by the `kind !== "issue"` guard (A3 ✅). However, two correctness issues were found during review.

---

### A-bug-1 — `blocks` / `blocked_by` direction is inverted

**File:** `src/adapters/github/internal/story-query-service.ts`

**Problem:** The first pass of `buildDependencyMap()` (around line 426) iterates over `story.blocked_by` (upstream dependencies — things A is waiting on) and pushes their keys into the **`blocks`** array. This is backwards: it makes node A appear to block its own blockers. The third pass then reverses that relationship, compounding the error.

`Story.blocked_by` = "stories that must be done before this one starts" (from type comment in `domain/types.ts`). `DependencyNode.blocks` = "stories that this node blocks" (reverse direction). A story's upstream dependencies must go into `blocked_by`, not `blocks`.

**Broken trace** (story A is blocked by B):

- After first pass: `A.blocks = [B]`, `A.blocked_by = []`
- After third pass: `A.blocks = [B]` (unchanged — "A blocks B" ❌), `B.blocked_by = [A]` ("B is blocked by A" ❌)

**What to change:**

In the first pass, rename the local variable from `blocks` to `blocked_by_keys` and assign it to `blocked_by` in the map entry (not `blocks`). Start `blocks: []` — it will be populated by the third pass.

In the third pass, change the reversal to iterate `node.blocked_by` instead of `node.blocks`, and push into the **`blocks`** array of the dependency target.

```typescript
// ── First pass: resolved nodes — CORRECTED ────────────────────────────────
for (const story of stories) {
  if (story.kind !== "issue") continue;
  const key = toIssueKey(story.key);
  const blocked_by_keys: IssueKey[] = [];

  for (const dep of story.blocked_by) {
    const target = storyById.get(dep.ref.id);
    if (target && target.kind === "issue") {
      blocked_by_keys.push(toIssueKey(target.key));
    }
  }

  map[key] = {
    key,
    title: story.title,
    status: story.status,
    sprint: story.sprint,
    epic_name: story.epic?.name ?? null,
    story_points: story.story_points,
    priority: story.priority,
    resolved: true,
    blocks: [], // populated by third pass
    blocked_by: blocked_by_keys, // upstream deps — correct direction
  };
}

// ── Third pass: derive `blocks` from each node's `blocked_by` — CORRECTED ──
for (const [nodeKey, node] of Object.entries(map)) {
  for (const depKey of node.blocked_by) {
    if (map[depKey]) {
      map[depKey].blocks.push(toIssueKey(nodeKey));
    }
  }
}
// Remove the reverseDeps intermediate and the second loop that overwrites blocked_by.
```

**Verification:** With A blocked by B:

- `A.blocked_by = [B_key]` ✅ — A waits on B
- `B.blocks = [A_key]` ✅ — B blocks A
- `A.blocks = []` ✅
- `B.blocked_by = []` ✅

---

### A-bug-2 — Cross-repo dependency targets are silently dropped

**File:** `src/adapters/github/internal/story-query-service.ts`

**Problem:** In the second pass of `buildDependencyMap()`, when a `blocked_by` ref cannot be found in `allItemsById` (cross-repo or off-board item), the code does `continue` and the dependency disappears from the graph entirely. The spec (REFACTORING.md §A2, step 4) requires these to appear as stub nodes with `status: null, resolved: false`.

The `DependencyEntry` already carries `dep.key` (issue number string) and `dep.title` (may be null) — enough to emit a meaningful stub even without an `allItems` lookup.

**What to change:**

In the second pass, after the `if (!item) continue` block, add a branch that creates a stub node using `dep.key` and `dep.title` from the `DependencyEntry` itself:

```typescript
// ── Second pass: unresolved nodes — CORRECTED ─────────────────────────────
for (const story of stories) {
  if (story.kind !== "issue") continue;
  for (const dep of story.blocked_by) {
    if (map[dep.key]) continue; // already in map (resolved in first pass)

    const item = allItemsById.get(dep.ref.id);
    if (!item) {
      // Cross-repo or off-board: emit a stub node with what we know.
      map[dep.key] = {
        key: toIssueKey(dep.key),
        title: dep.title ?? null,
        status: null,
        sprint: null,
        epic_name: null,
        story_points: null,
        priority: null,
        resolved: false,
        blocks: [],
        blocked_by: [],
      };
      continue;
    }

    const depStory = buildStoryFromRaw(item, this.config);
    if (!depStory || depStory.kind !== "issue") continue;
    const key = toIssueKey(depStory.key);
    map[key] = {
      key,
      title: depStory.title,
      status: depStory.status,
      sprint: depStory.sprint,
      epic_name: depStory.epic?.name ?? null,
      story_points: depStory.story_points,
      priority: depStory.priority,
      resolved: false,
      blocks: [],
      blocked_by: [],
    };
  }
}
```

**Verification:** A story blocked by a cross-repo issue still appears in the map with `resolved: false` and `status: null`. The `blocks`/`blocked_by` fields for stub nodes are populated correctly by the third pass the same as any other node.

---

## Group B — MCP Resource for Templates (done)

**Context:** Template URIs (`scrum://template/{type}`) are listed in `scrum_orient`'s `platform_state.template_uris`, but no MCP resource is registered to serve them. The deprecated tool stub `scrum_get_template` in `src/tools/scrum-read.ts` (line 410) exists only to point agents toward the resource that doesn't yet exist. Do B1 → B2 → B3 in order.

---

### B1 — Implement template content provider

**New file:** `src/scrum/template-resource.ts`

Create a use-case function that resolves a template body for a given `ItemType`.

**Logic:**

1. Accept `type: ItemType`, `fileReader: FileReaderPort`, `scrumConfig: ScrumConfig` as inputs.
2. Check if `scrumConfig` declares a template path for the requested type (via `scrumConfig.templates?.[type]` or equivalent config shape — read `domain/config.ts` for the exact field name).
3. If a path is declared, call `fileReader.fetchRepoFile(path)` and return the content.
4. If no template is configured, fall back to the canonical description in `references/item-types.md` (fetch via `fileReader.fetchRepoFile()`).
5. Return `{ content: string; mimeType: "text/markdown" }`.

**Ports used:** `FileReaderPort` (already defined in `src/scrum/ports.ts`) — check the exact method signature before implementing.

---

### B2 — Register resource in composition root

**File:** `src/index.ts`

After the `registerScrumReadTools(...)` call (line 124), add a `server.resource(...)` call using the MCP SDK's `ResourceTemplate` API.

```typescript
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { templateResourceUseCase } from "./scrum/template-resource.ts";

// inside createMcpServer(), after registerScrumReadTools():
server.resource(
  "scrum-template",
  new ResourceTemplate("scrum://template/{type}", { list: undefined }),
  async (uri, { type }) => {
    const content = await templateResourceUseCase(
      type as string,
      fileReader,
      scrumConfig,
    );
    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }],
    };
  },
);
```

Check the MCP SDK version (`deno.json` / `package.json`) for the exact `server.resource()` signature before writing this — the SDK is at v1.x and the method name may differ from the snippet above. Consult `ts.sdk.modelcontextprotocol.io`.

---

### B3 — Remove deprecated `scrum_get_template` tool stub

**File:** `src/tools/scrum-read.ts`\
**Lines:** ~409–445 (the `scrum_get_template` registration block)

Delete the entire `server.registerTool("scrum_get_template", ...)` block once B2 is live and manually verified (read `scrum://template/feature` via the MCP resource protocol and confirm the response contains markdown). Do not remove it before B2 is verified.

---

## Group C — Orient Enhancements (done)

**Context:** `orientUseCase()` in `src/scrum/orient.ts` has three hardcoded stubs: `goal: null` (line 82), `workPct = 0` (line 88), and epics are not sprint-scoped. C1 feeds data that C2 and C3 also need, so implement in order: C1 → C2 → C3.

---

### C1 — Sprint-scoped epic filtering

**Problem:** `orientUseCase()` calls `backend.getEpics()` (line 56) and filters only by `status !== "done"`. Epics with no items in the active sprint are included, which bloats the orient response with irrelevant context.

**Required behavior:** Return only epics that have ≥1 item assigned to the active sprint.

**Files to change:**

1. **`src/adapters/github/internal/epic-service.ts`** — Add `sprintIterationId: string | null` parameter to `getEpics()`. When non-null, after fetching all milestones, filter them to those with at least one open issue in the sprint. This requires a second lookup: query `StoryQueryService.findItems({ scope: "sprint", sprint_ref: sprintIterationId })` and collect the unique `epic.ref.id` values; keep only milestones whose id is in that set. When `sprintIterationId` is null, return all open epics (existing behavior).

2. **`src/adapters/github/backend.ts`** — In `getPlatformState()` or the `getEpics()` call site, pass `config.iterations.active?.id ?? null` to `EpicService.getEpics()`.

3. **`src/scrum/ports.ts`** — If `getEpics()` is declared on the `ProjectReader` port, add the optional `sprintIterationId?: string | null` parameter to its signature there too so the interface stays in sync.

**Edge case:** No active sprint → `sprintIterationId` is null → fall back to all open epics (existing behavior is the fallback, no regression).

---

### C2 — Sprint goal population

**Problem:** `buildSprintContext()` inside `orientUseCase()` (line 74–90) hardcodes `goal: null`. The `SprintInfo` type at `src/scrum/ports.ts:92` has no `goal` field yet.

**Files to change:**

1. **`src/scrum/ports.ts`** — Add `goal: string | null` to the `SprintInfo` interface.

2. **`src/adapters/github/config-loader.ts`** — `IterationEntry` (domain/types.ts line 407) does not carry a `description` field. The GitHub GraphQL bootstrap query (`GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY` / `GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY` in `src/adapters/github/queries.ts`) may not fetch iteration descriptions. Check whether the iteration configuration shape from the API includes a `description` field; if so, add it to `IterationEntry` and surface it in `RuntimeConfig.iterations.active`.

3. **`src/adapters/github/mappers.ts`** — In `toSprintInfo()` (around line 297), populate `goal` from `IterationEntry.description` (or `null` if the API does not provide it).

4. **`src/scrum/orient.ts`** — In `buildSprintContext()` (line 82), replace `goal: null` with `goal: info.goal ?? null` once the `SprintInfo` field exists.

**Note on GitHub API:** GitHub's Projects iteration fields expose `description` per iteration in GraphQL. Verify this by checking the bootstrap query response shape — the field is on `configuration.iterations[].description`. If it's missing from the query, add `description` to the iteration fragment.

---

### C3 — workPct computation

**Problem:** `buildSprintContext()` passes `0` as `workPct` to `sprintContextFromSprintInfo()` (orient.ts line 88), so `riskStance` is always computed against 0% completion regardless of actual sprint progress.

**Files to change:**

1. **`src/adapters/github/internal/story-query-service.ts`** — Add a new method `computeSprintCompletion(iterationId: string): Promise<{ completed: number; total: number }>`. Implementation: call `findItems({ scope: "sprint", sprint_ref: iterationId })`, then sum `story_points` where status is a "done" canonical key vs. total. Return `{ completed, total }`.

2. **`src/scrum/ports.ts`** — Expose this as a port method on `ProjectReader`: `getSprintCompletion(iterationId: string): Promise<{ completed: number; total: number }>`. (Or fold it into an existing analytics method if appropriate — check `get-analytics.ts`.)

3. **`src/scrum/orient.ts`** — Before calling `buildSprintContext()`, call `backend.getSprintCompletion(state.iterations.active.id)`. Compute `workPct = total > 0 ? Math.round((completed / total) * 100) : 0`. Pass it to `sprintContextFromSprintInfo()` instead of the hardcoded `0`.

**Edge case:** No story-points field on the board → `total = 0` → `workPct = 0` (same as current behavior, no regression).

---

## Group D — Tool Rename

**Context:** `scrum_get_story` should be exposed under the name `scrum_get_item_detail` per the redesign proposal. The handler logic and its input contract (supporting both `id` and `number`) are already fully implemented. Only the registration name differs. D1 and D2 are decoupled — D1 can ship immediately; D2 waits for agent retraining.

---

### D1 — Register `scrum_get_item_detail` alongside existing name

**File:** `src/tools/scrum-read.ts`\
**Lines:** ~70–70 (after the existing `scrum_get_story` registration block)

Extract the existing handler into a named `const getItemDetailHandler = async (...) => ...` before the first `server.registerTool("scrum_get_story", ...)` call. Then register it twice:

```typescript
server.registerTool("scrum_get_story", { title: "...", /* existing config */ }, getItemDetailHandler);

server.registerTool("scrum_get_item_detail", {
  title: "Get Item Detail",
  description: `Return full details for a single backlog item.
    Prefer \`id\` (from a prior listing) for exact lookup.
    Use \`number\` only when you have the issue number and no \`id\`.
    /* ... rest of updated description ... */`,
  inputSchema: /* same schema as scrum_get_story */,
}, getItemDetailHandler);
```

Both tools share the exact same handler. No logic changes.

---

### D2 — Deprecate `scrum_get_story`

**File:** `src/tools/scrum-read.ts`\
**Timing:** Ship only after D1 has been live long enough for the agent to retrain on `scrum_get_item_detail`.

Replace the `scrum_get_story` handler with an error stub following the same pattern as the existing `scrum_get_template` deprecation (line 409):

```typescript
server.registerTool("scrum_get_story", {
  title: "Get Story (deprecated)",
  description: `[DEPRECATED] Use scrum_get_item_detail instead.`,
  inputSchema: { type: "object" as const, properties: {} },
}, async () => ({
  content: [{
    type: "text" as const,
    text: JSON.stringify({
      error: true,
      message: "scrum_get_story has been renamed to scrum_get_item_detail.",
      replacement: "scrum_get_item_detail",
    }),
  }],
}));
```

---

## Verification Checklist

| Item    | How to verify                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------- |
| A-bug-1 | Unit test: A blocked by B → `A.blocked_by = [B]`, `B.blocks = [A]`, `A.blocks = []`, `B.blocked_by = []` |
| A-bug-2 | Unit test: `blocked_by` ref not in `allItems` → stub node in map with `status: null, resolved: false`    |
| B1–B2   | MCP client: read `scrum://template/feature` → response contains markdown, `mimeType: "text/markdown"`    |
| B3      | After B2 verified: confirm `scrum_get_template` is absent from tool list before deleting                 |
| C1      | Orient with active sprint → epics count ≤ total epic count; epics without sprint items are absent        |
| C2      | Orient with goal configured in sprint → `iterations.active.goal` is non-null string                      |
| C3      | Orient mid-sprint with 5/10 sp done → `riskStance` reflects ~50% completion, not 0%                      |
| D1      | `scrum_get_item_detail({ number: 42 })` returns same payload as `scrum_get_story({ number: 42 })`        |
| D2      | `scrum_get_story(...)` returns error JSON pointing to `scrum_get_item_detail`                            |
