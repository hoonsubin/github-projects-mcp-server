# TODO — Bug Fix Strategy

> Created: 2026-05-10 | Assessment phase

---

## Bug #2 — GraphQL Syntax Error in `scrum_get_backlog` (P0 — Blocking)

**Issue:** `scrum_get_backlog` returns `Error: GraphQL errors: Expected NAME, actual: COLON (":") at [7, 21]`

**Reason:** In [`src/services/pagination.ts:215`](src/services/pagination.ts:215), `loginArg` already contains `login: $login` (full argument), but the template adds `: ${loginVar}` after it, producing `login: $login: $login` — invalid GraphQL.

```
Call chain: scrum_get_backlog → getBacklogUseCase → backend.getBacklogStories()
  → PaginatedProjectItemFetcher → buildItemsQuery() [BUG HERE]
```

**Actions to take:**

1. Edit [`src/services/pagination.ts`](src/services/pagination.ts) line 215
2. Change `${ownerKey}(${loginArg}: ${loginVar}) {` to `${ownerKey}(${loginArg}) {`
3. Delete `loginVar` on line 205 — `ownerType === "user" ? "$login" : "$login"` (both branches identical; variable becomes unused after step 2)
4. Run `deno test` to confirm no regressions
5. Verify `scrum_get_backlog` works for both user and org configs

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

## Execution Order

| Step | Bug     | Rationale                                                                    |
| ---- | ------- | ---------------------------------------------------------------------------- |
| 1    | #2 (P0) | Blocking runtime error — must be fixed first to restore `scrum_get_backlog`  |
| 2    | #3 (P1) | Security fix — should be addressed before any new code touches this function |
| 3    | #4 (P2) | Consistency fix — same pattern as #3, low risk; batch with #3 review pass    |
| 4    | #1 (P1) | Developer tooling fix — improves analysis reliability for Phase 4 cleanup    |

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
