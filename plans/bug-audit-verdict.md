# Bug Audit Verdict — All 9 Bugs Verified `correct`

Audit source: [`tasks/TODO.md`](../tasks/TODO.md)\
Verification date: 2026-06-04\
All nine entries are correctly identified against the live codebase. No revisions needed.

---

## Bug 1 — `setFieldType()` Org Issue Type / `resolveIssueNodeId` Fallback

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/internal/field-value-mutator.ts:370`](src/adapters/github/internal/field-value-mutator.ts:370) — `const resolvedIssueId = issueId ?? await this.resolveIssueNodeId(itemId);`
- [`src/adapters/github/internal/field-value-mutator.ts:410-418`](src/adapters/github/internal/field-value-mutator.ts:410) — `resolveIssueNodeId()` only accepts `__typename: "Issue"`; throws `DRAFT_ISSUE_CONSTRAINT` for DraftIssue content.
- All current callers pre-resolve the draft before calling `setFieldType()`:
  - [`src/adapters/github/internal/story-mutation-service.ts:211`](src/adapters/github/internal/story-mutation-service.ts:211) (`createStory` converts draft first)
  - [`src/adapters/github/internal/story-mutation-service.ts:394-406`](src/adapters/github/internal/story-mutation-service.ts:394) (`setField "type"` converts draft first)
- The fallback path cannot handle Draft Issues. No caller currently hits it without pre-conversion, making the API surface fragile but currently safe.

---

## Bug 2 — `scrum_set_field type=null` Throws for Org Issue Types but Not Board Fields

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/internal/field-value-mutator.ts:315-325`](src/adapters/github/internal/field-value-mutator.ts:315) — When `value === null`:
  - `board_field` path (line 316-318): calls `clearField()` — succeeds.
  - `org_issue_type` path (line 320-325): throws `"Type cannot be cleared when using organization issue types."` with code `NOT_IMPLEMENTED`.
- The tool description does not document this behavioral divergence; user projects can clear type, org projects cannot.

---

## Bug 3 — Issue-Backed Field Option ID Source Ambiguity

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/internal/field-value-mutator.ts:99`](src/adapters/github/internal/field-value-mutator.ts:99) — `const optionId = (issueBacked.options ?? {})[value] ?? this.ctx.config.live.statusOptions[value];`
- [`src/adapters/github/internal/field-value-mutator.ts:242`](src/adapters/github/internal/field-value-mutator.ts:242) — Same pattern for priority.
- [`src/adapters/github/bootstrap.ts:255-274`](src/adapters/github/bootstrap.ts:255) — `detectIssueBackedFields()` matches by name only (line 263: `orgFieldByName.get(projectField.name)`), does NOT check whether the project field already has its own non-empty options list.
- [`src/adapters/github/bootstrap-field-sources.ts:39-56`](src/adapters/github/bootstrap-field-sources.ts:39) — `singleSelectOptionMapForField()` prefers project board options at line 45-47.
- **Migration-state collision:** When a project board field has populated options AND a same-named org issue field exists, `live.statusOptions`/`live.priorityOptions` contain project-board option IDs, while `issueBacked.options` contains org-level option IDs. The `??` fallback mixes these — if the org-level lookup misses, writing a board-level option ID through the org-level `UPDATE_ISSUE_FIELD_MUTATION` would point at the wrong option space.

---

## Bug 4 — User Identifier Resolution Only Handles `User`, Not `Organization` or `Bot`

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/operations.graphql:622-624`](src/adapters/github/operations.graphql:622) — `query GetUserNodeId($login: String!) { user(login: $login) { id } }` — queries ONLY the `user` root field.
- [`src/adapters/github/internal/user-milestone-resolver.ts:29-42`](src/adapters/github/internal/user-milestone-resolver.ts:29) — Calls `GET_USER_NODE_ID` with a login; if `result?.user?.id` is null (as it is for org/bot accounts), throws `User "${login}" not found.`
- Callers:
  - [`src/adapters/github/internal/story-mutation-service.ts:171`](src/adapters/github/internal/story-mutation-service.ts:171) — `createStory` resolveUserNodeIds
  - [`src/adapters/github/internal/story-mutation-service.ts:326`](src/adapters/github/internal/story-mutation-service.ts:326) — `updateStory` resolveUserNodeIds
  - [`src/adapters/github/internal/field-value-mutator.ts:388`](src/adapters/github/internal/field-value-mutator.ts:388) — `setFieldAssignee` resolveUserNodeId
- Organization logins (`myorg`) and bot logins (`dependabot[bot]`) return null from the `user()` root field — the account exists but is the wrong GraphQL type.

---

## Bug 5 — Search API: Private Repo Issues May Be Invisible

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/internal/assemblers/search-api-assembler.ts:59-68`](src/adapters/github/internal/assemblers/search-api-assembler.ts:59) — Search query executed via `ExecutionEngine`; no permission-error detection.
- [`src/adapters/github/internal/search-result-normalizer.ts:45-100`](src/adapters/github/internal/search-result-normalizer.ts:45) — `searchIssuesToProjectItems()` filters empty search results silently; an empty nodes array yields an empty items array.
- [`src/adapters/github/internal/search-query-builder.ts:30-32`](src/adapters/github/internal/search-query-builder.ts:30) — `repo:${owner}/${repo}` clauses restrict search scope; if the token lacks `repository:search` permission for a private tracked repo, the search returns zero results with no error.
- **Contrast with board scan:** `ProjectItemsAssembler` fetches items via `projectV2.items(...)` GraphQL directly — repo search permissions are irrelevant there.

---

## Bug 6 — Draft Issue Promotion: Partial Failure on Labels/Epic/Type

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/internal/story-mutation-service.ts:161-264`](src/adapters/github/internal/story-mutation-service.ts:161) — `createStory()`:
  - Line 176-188: Draft Issue created → `itemId` obtained.
  - Line 209-212: If `needsRealIssue` (labels/epic/org_issue_type) → `convertDraftToIssue(itemId)`.
  - `convertDraftToIssue` at line 435-458 uses the primary repo's `repositoryId` from [`src/adapters/github/internal/label-resolver.ts:54`](src/adapters/github/internal/label-resolver.ts:54).
  - If conversion fails, the Draft Issue exists but `createStory` throws.
- [`src/tools/handlers/write.ts:104`](src/tools/handlers/write.ts:104) — `handleCreateStory()` calls `backend.createStory()` directly at line 104 — **no `catchBackend` wrapper**. A failure during `convertDraftToIssue` propagates as an unhandled exception, leaving a dangling Draft Issue on the board.
- **Note:** The audit's file path reference to `tools/handlers/write.ts:104-128` should be [`src/tools/handlers/write.ts:104`](src/tools/handlers/write.ts:104) — the path prefix and line numbers in the audit are slightly off, but the substance is correct.

---

## Bug 7 — `owner_type: "user"` With Org Owner Name Produces Misleading Error

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/bootstrap.ts:311-313`](src/adapters/github/bootstrap.ts:311) — `GET_OWNER_BOOTSTRAP_QUERY` is called with `isOrg: ownerType === "org"`.
- [`src/adapters/github/operations.graphql:790-792`](src/adapters/github/operations.graphql:790) — `user(login: $login) @skip(if: $isOrg)` — when `isOrg: false`, only the `user()` root is queried; the `organization()` root is skipped.
- When `owner_type: "user"` but `owner: "myorg"` (an org name): `user(login: "myorg")` returns null, `projectNode` is null.
- Error at [`src/adapters/github/bootstrap.ts:326`](src/adapters/github/bootstrap.ts:326): `"Project #N not found for user 'myorg'."` — the account is an org, not a user. The recovery hint mentions checking `owner_type` but the error message itself is misleading.

---

## Bug 8 — Cross-Repo Issue Number Collision

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/internal/resolve-issue-number.ts:44-63`](src/adapters/github/internal/resolve-issue-number.ts:44) — `fetchProjectItemByIssueNumber()` iterates `tracked_repos` sequentially (line 51).
- Line 59: first non-null match wins — `if (item) return item;`
- If issue #42 exists in both `repo-a` and `repo-b`, both on the same project board, the iteration order of `tracked_repos` determines which ProjectItem is returned. No collision detection or warning.
- The search-based optimization at lines 73-123 does not mitigate this — individual `fetchProjectItemByIssueNumber` calls are still subject to first-repo-wins.
- **Narrow trigger:** Requires the same issue number in multiple tracked repos, with both items on the same project board. This is rare but architecturally real.

---

## Bug 9 — `addFieldOption` Uses Project Board Mutation for Issue-Backed Fields

**Verdict: `correct`**

**Evidence:**

- [`src/adapters/github/internal/vocabulary-manager.ts:84-105`](src/adapters/github/internal/vocabulary-manager.ts:84) — `addSingleSelectOption()`:
  - Line 88: `GET_FIELD_OPTIONS_QUERY` — fetches project board field options.
  - Line 100-103: `UPDATE_FIELD_MUTATION` — writes to `updateProjectV2Field`.
- No check for whether the field is issue-backed (`issueBackedFields[fieldId]`).
- **Result chain:**
  1. `scrum_add_vocabulary kind=status_option` adds option to the project board Status field.
  2. For org projects where Status is backed by an org issue field, the new option ID is only on the project board.
  3. [`src/adapters/github/internal/field-value-mutator.ts:99`](src/adapters/github/internal/field-value-mutator.ts:99) — `issueBacked.options[value]` won't find the new option (org-level options map doesn't have it).
  4. The `??` fallback to `live.statusOptions[value]` also fails — that map was built from the org-level catalog at bootstrap time.
  5. Any subsequent write with the new vocabulary value silently fails or throws `OPTION_NOT_FOUND`.

---

## Summary

| # | Bug                                                              | Verdict   |
| - | ---------------------------------------------------------------- | --------- |
| 1 | `setFieldType()` / `resolveIssueNodeId` draft fragility          | `correct` |
| 2 | `type=null` throws for org issue types                           | `correct` |
| 3 | Issue-backed field option ID source ambiguity                    | `correct` |
| 4 | User resolution ignores Organization/Bot types                   | `correct` |
| 5 | Search API silent empty results for private repos                | `correct` |
| 6 | Draft conversion partial failure / dangling drafts               | `correct` |
| 7 | Misleading "not found for user" error for org accounts           | `correct` |
| 8 | Cross-repo issue number collision (first-repo-wins)              | `correct` |
| 9 | `addFieldOption` writes project board field, not org issue field | `correct` |

All nine bug entries are accurately diagnosed against the live codebase. Zero revisions needed. The audit in [`tasks/TODO.md`](../tasks/TODO.md) is a reliable source of truth for these bugs.
