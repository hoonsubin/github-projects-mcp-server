# TODO — Bug Fix Strategy

> Created: 2026-05-10 | Assessment phase

---

## Bug #3 — GraphQL Injection in `resolveUserNodeId()` (P1 — Security)

**Issue:** User input (`login`) is interpolated directly into a GraphQL query string instead of using variables.

**Reason:** In [`src/adapters/github/backend.ts:374`](src/adapters/github/backend.ts:374), the query uses string interpolation:

```typescript
`query { user(login: "${login}") { id } }`;
```

This could break with special characters in usernames (e.g., `user'o"b`) and is a security vulnerability if attacker-controlled input reaches this function.

**Actions to take:**

1. Edit [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts) lines 372-381
2. Refactor to use GraphQL variables (consistent with other queries in the codebase):

```diff
- `query { user(login: "${login}") { id } }`,
+ `query GetUser($login: String!) { user(login: $login) { id } }`,
+   { login },
```

3. Run `deno test` to confirm no regressions
4. Test with special-character usernames (e.g., `user'o"b`, `user-name`, `user_name`)

---

## Bug #4 — GraphQL Interpolation in `fetchRepoNodeId()` (P2 — Consistency)

**Issue:** `fetchRepoNodeId()` in [`src/adapters/github/backend.ts:343`](src/adapters/github/backend.ts:343) interpolates `this.owner` and `this.repo` directly into a GraphQL string, the same pattern as Bug #3:

```typescript
`query { repository(owner: "${this.owner}", name: "${this.repo}") { id } }`;
```

**Why lower severity than Bug #3:** `this.owner` and `this.repo` are set from the server config YAML (`.github/scrum/config.yml`), not from runtime caller input. An attacker would need write access to the config file, not just to a tool argument. Still, it is inconsistent — every other `graphql()` call in `backend.ts` uses proper variables, and the adjacent `milestonesQuery` (line ~402) already does the right thing with `$owner`/`$repo`.

**Actions to take:**

1. Edit [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts) `fetchRepoNodeId()` (~line 342)
2. Refactor to use GraphQL variables:

```diff
- `query { repository(owner: "${this.owner}", name: "${this.repo}") { id } }`,
+ `query GetRepo($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { id } }`,
+ { owner: this.owner, repo: this.repo },
```

3. Run `deno test` to confirm no regressions

---

## Bug #1 — Multi-line Import False Positives in Diagram Generator (P1 — Correctness)

**Issue:** `extractImportedNames()` in [`scripts/diagram/ImportExtractor.ts`](scripts/diagram/ImportExtractor.ts) returns `[]` for multi-line destructured imports, causing ~30 false positives in `docs/proj-diagram.md`.

**Reason:** The function uses `lines.find()` to locate the single line containing `from '...'`. For multi-line imports, the matched line is `} from "../types.ts"` which contains no `{...}`. The named-import regex matches nothing.

**Confirmed false positives:** `BurndownResponse`, `BurndownSprintMeta`, `ItemContentType`, all `ports.ts` boundary types, all `queries.ts`/`mappers.ts` exports, all `schemas/scrum.ts` schemas.

**Actions to take:**

1. Edit [`scripts/diagram/ImportExtractor.ts`](scripts/diagram/ImportExtractor.ts)
2. Replace single-line `lines.find()` with a loop that collects the full import statement (from `import` keyword to `from '...'`), joins the lines, then applies regex on the joined string
3. Run diagram generator and verify false positives are eliminated
4. Regenerate `docs/proj-diagram.md` with accurate unused-export analysis
5. Add unit tests for multi-line import cases

---

## Bug #7 — `enrichError()` Is Dead in Production (P1 — Agent Observability)

**Issue:** `src/services/github.ts` exports `enrichError()` with pattern-matched `→ Fix:` hints covering every known GitHub API failure mode — explicitly designed to help small/local LLMs self-diagnose. Every tool handler in `scrum-write.ts` and `scrum-read.ts` calls `formatError(err)` instead. `enrichError` has never run in production.

**Root Cause:** The function was added but the call sites were never updated. The JSDoc on `enrichError` even says `// Usage: replace formatError(err) with enrichError(err, { operation: "..." })` — it was intended as a drop-in replacement but the migration was never done.

**Impact on agents:** When the agent in the attached trace saw `Error: Project item "I_kwDO..." is not an Issue`, it had no actionable guidance. With `enrichError`, the message could have said "The story was created successfully — this error occurred during the post-creation read. Retrieve the story with scrum_get_story." The agent instead went into debug mode and retried, creating duplicate issues.

**Actions to take:**

1. In [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts): replace every `formatError(err)` in `catch` blocks with `enrichError(err, { operation: "<tool_name>" })`, using the tool name as the operation context (e.g. `"create_story"`, `"set_field"`, `"plan_sprint"`)
2. In [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts): same replacement for all `catch` blocks
3. Ensure `enrichError` is imported wherever `formatError` was imported — both are exported from `src/services/github.ts`
4. Run `deno test` to confirm no regressions

**Note:** The `scrum_create_story` handler also needs the post-creation `getStoryDetail` call wrapped in its own `try/catch` (separate from the outer one) so a read failure after successful creation returns `isError: false` with a partial-success shape rather than `isError: true`. See Bug #5 for the related root cause.

---

## Bug #8 — `scrum_orient` Exposes Raw Field Option UUIDs (P2 — Agent Usability)

**Issue:** The `scrum_orient` response returns field `options` as raw GitHub UUIDs (e.g. `["f75ad846", "47fc9ee4", ...]`) alongside `missing_options` as display names (e.g. `["Backlog", "Ready", ...]`). An agent cannot cross-reference these to know which vocabulary names are already configured vs. missing.

**Root Cause:** The orient tool returns the raw option IDs from the GitHub Projects API without mapping them to their display names. The display names are available from the same API call that returns the IDs — they're just not being surfaced.

**Impact on agents:** From the agent trace, the orient response showed configured options as opaque UUIDs and missing options as human-readable names. The agent had no way to verify whether e.g. "Backlog" was already set up (as `f75ad846`) or truly absent. The server is supposed to bridge the vocabulary gap — exposing UUIDs defeats that purpose.

**Actions to take:**

1. Locate the `scrum_orient` handler and the underlying orient use-case — find where field options are fetched from the GitHub Projects API
2. Replace the `options: [uuid, uuid, ...]` shape with `configured_options: ["Backlog", "Ready", ...]` (display names) — the server resolves the ID-to-name mapping internally
3. Remove raw UUIDs from the orient response entirely; agents should never need them
4. Run `deno test` and manually verify orient output shape

---

## Execution Order

| Step | Bug     | Rationale                                                                                         |
| ---- | ------- | ------------------------------------------------------------------------------------------------- |
| 1    | #2 (P0) | Blocking runtime error — must be fixed first to restore `scrum_get_backlog`                       |
| 2    | #5 (P0) | Blocking: `scrum_create_story` returns wrong ID, causing false failure and duplicate issue risk   |
| 3    | #7 (P1) | Agent observability — `enrichError` makes every error actionable; do before any new agent testing |
| 4    | #3 (P1) | Security fix — should be addressed before any new code touches this function                      |
| 5    | #6 (P1) | Priority set as label instead of board field — correctness fix for story creation                 |
| 6    | #4 (P2) | Consistency fix — same pattern as #3, low risk; batch with #3 review pass                         |
| 7    | #8 (P2) | Orient UUID exposure — agent usability; no data loss risk                                         |
| 8    | #1 (P1) | Developer tooling fix — improves analysis reliability for Phase 4 cleanup                         |

## Bug #5 — `createStory()` Returns Wrong ID, Breaking `getStoryDetail()` (P0 — Blocking)

**Issue:** After `createStory()` successfully creates a GitHub Issue, the handler in [`src/tools/scrum-write.ts:243`](src/tools/scrum-write.ts:243) calls `backend.getStoryDetail(storyRef)` which fails with:
`Error: Project item "I_kwDOSJo3Ms8AAAABB0jamw" is not an Issue (it may be a Draft or Pull Request). Only Issues are supported as Stories.`

**Root Cause:** `createStory()` returns `{ number: issue.number, id: issue.id }` where `id` is the **GitHub Issue node ID** (`I_kwDO...`). However, `resolveStory()` in [`src/services/resolver.ts:184`](src/services/resolver.ts:184) treats `ref.id` as a **project item ID** (`PVTI_...`).

```
Call chain:
  scrum_create_story handler (scrum-write.ts:213)
    → backend.createStory() returns { number: 22, id: "I_kwDO..." }  ← issue node ID
    → backend.getStoryDetail(storyRef)
      → resolveStory() treats storyRef.id as project item ID
        → node(id: "I_kwDO...") returns null (not a valid project item)
          → throws "not an Issue (it may be a Draft or Pull Request)"
```

**Fix:** Have `createStory()` return the project item ID (`PVTI_...`) from the `addProjectV2ItemById` mutation result, not the issue node ID. The `addProjectV2ItemById` mutation on line 587-594 returns `{ item { id } }` — capture this and use it as the project item ID.

```diff
  // Step 6: Call addProjectV2ItemById to add to project board
- await this.gh.graphql(
+ const addItemResult = await this.gh.graphql(
    `mutation AddItem($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`,
    { projectId: this.config.projectId, contentId: issue.id },
  );

- return { number: issue.number, id: issue.id };
+ return { number: issue.number, id: issue.id, itemId: addItemResult.addProjectV2ItemById?.item?.id };
```

**Note:** `getStoryDetail()` needs to be updated to accept the new `itemId` field in `StoryRef`, or we need a separate return type.

---

## Bug #6 — Priority Set as Label Instead of Board Field (P1 — Correctness)

**Issue:** When creating a story with `priority: "Must"`, the priority is applied as a repository label (`priority_must`) instead of as a project board field value. The priority does not appear in the GitHub Projects board view.

**Root Cause:** In [`src/adapters/github/backend.ts:499-524`](src/adapters/github/backend.ts:499-524), the `createStory()` method resolves the priority to a label and adds it to `labelIds`, but never calls `setField()` to set the priority on the project board.

```typescript
// Current (WRONG): priority becomes a label
priorityLabelId = await this.resolveOrCreateLabel(
  `priority_${input.priority.toLowerCase()}`,
);
labelIds.push(priorityLabelId);

// Missing: setField(storyRef, "priority", input.priority) on the board
```

**Fix:** After creating the story and getting the project item ID, call `setField()` to set the priority board field value:

```diff
  // After Step 6, after getting issue ref:
  const storyRef = { number: issue.number, id: issue.id, itemId: addItemResult.addProjectV2ItemById?.item?.id };

+ // Set priority as board field
+ if (input.priority) {
+   await this.setField(storyRef, "priority", input.priority);
+ }
```

---

## Cross-Cutting Notes

- Bugs #2, #3, and #4 all affect `backend.ts` or its call chain — apply all three during a single review pass.
- Bugs #3 and #4 are the same pattern; fix them together so the codebase is consistent after the pass.
- Fixing Bug #1 before Phase 4 cleanup (REFACTORING.md §5a) will produce an accurate unused-export diagram, helping identify truly dead code in `src/types.ts`.
