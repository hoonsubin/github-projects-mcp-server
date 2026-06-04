## Bug Audit: User vs Org vs Private Project Edge Cases

### 1. `setFieldType()` — Org Issue Type Relies on Pre-Resolved Issue ID

**File**: [`src/adapters/github/internal/field-value-mutator.ts`](src/adapters/github/internal/field-value-mutator.ts:309–375)

For org projects using `typeResolution.source === "org_issue_type"`, the `setFieldType` method at line 370 calls `SET_ISSUE_TYPE_MUTATION` which requires a real Issue node ID (I_...), not a project item ID (PVTI_...). The method accepts an optional `issueId` parameter — when this is `null` or `undefined`, it falls back to `resolveIssueNodeId(itemId)` at line 370. The fallback at line 395–423 uses `GET_PROJECT_ITEM_BY_ID_QUERY` and only accepts `__typename: "Issue"` content — it throws `DRAFT_ISSUE_CONSTRAINT` at line 410–418 for DraftIssue items.

**Trigger**: `scrum_set_field` with `field: "type"` on a Draft Issue in an org-owned project where the caller has not already performed an implicit draft-to-issue conversion. The caller must have converted the draft before reaching `setFieldType`, otherwise the fallback `resolveIssueNodeId()` throws.

**Upstream**: [`src/adapters/github/internal/story-mutation-service.ts`](src/adapters/github/internal/story-mutation-service.ts:394–406) — `setField("type")` in `StoryMutationService` conditionally converts the draft (lines 397–401) but only when `resolved.issueId === null` and `typeResolution.source === "org_issue_type"`. If the draft was already converted (issueId is non-null) but the conversion happened for a different reason, the code path still works. The fragility is that the fallback path (`resolveIssueNodeId`) cannot handle drafts.

---

### 2. `scrum_set_field type=null` Throws for Org Issue Types but Not Board Fields

**File**: [`src/adapters/github/internal/field-value-mutator.ts`](src/adapters/github/internal/field-value-mutator.ts:315–325)

When `value === null` and `typeResolution.source === "org_issue_type"`, the code at line 320–325 throws:

```
Type cannot be cleared when using organization issue types.
```

This contrasts with `typeResolution.source === "board_field"` (line 316–319), where null simply calls `clearField` to clear the board field. The behavior difference means `scrum_set_field { field: "type", value: null }` succeeds on user projects but throws on org projects — the tool description does not document this limitation.

---

### 3. Issue-Backed Field Writes — Option ID Source Ambiguity

**File**: [`src/adapters/github/internal/field-value-mutator.ts`](src/adapters/github/internal/field-value-mutator.ts:96–123, 196–203, 236–267)

Three field write methods (`setFieldStatus`, `setFieldStoryPoints`, `setFieldPriority`) check `issueBackedFields[fieldId]` to determine if the field is backed by an org-level issue field. When a field is issue-backed:

- [`setFieldPriority`](src/adapters/github/internal/field-value-mutator.ts:242) at line 242: `const optionId = (issueBacked.options ?? {})[value] ?? this.ctx.config.live.priorityOptions[value];`
- [`setFieldStatus`](src/adapters/github/internal/field-value-mutator.ts:99) at line 99: same pattern using `statusOptions`

The `issueBacked.options` map is populated from the org issue field catalog at [`bootstrap.ts`](src/adapters/github/bootstrap.ts:258–271) via `detectIssueBackedFields()`. The `live.priorityOptions` / `live.statusOptions` maps come from `buildOptionMaps()` at [`bootstrap-field-sources.ts`](src/adapters/github/bootstrap-field-sources.ts:95–140), which prefers project board options first (line 45–47) and falls back to org issue field options (line 48–51).

**Mechanism**: When the project board single-select field has empty options (common for issue-backed org fields), `singleSelectOptionMapForField` at line 48 falls back to the org issue field catalog. Both `issueBacked.options` and `live.priorityOptions` contain org-level option IDs. But when the board field options are non-empty (a migration state where both copies exist), the `live.priorityOptions` map contains project board option IDs while `issueBacked.options` contains org-level option IDs — the fallback `??` at line 242 would return a mismatched option ID. Writing a project board option ID via the `UPDATE_ISSUE_FIELD_MUTATION` (org-level mutation) could silently write a wrong or null value.

**Detection**: [`bootstrap.ts`](src/adapters/github/bootstrap.ts:490–503) checks `isCanonicalSingleSelectUnavailable` and only enables issue-backed field detection when the catalog is not unavailable. But this detection is per-field-name rather than per-field-ID, so a project board field with populated options will still be treated as issue-backed if a same-named org issue field exists — the code at line 265 `issueBackedFields[projectField.id] = ...` does not check whether the project field already has its own options.

---

### 4. User Identifier Resolution Only Handles `User` Type, Not `Organization` or `Bot`

**File**: [`src/adapters/github/internal/user-milestone-resolver.ts`](src/adapters/github/internal/user-milestone-resolver.ts:25–45)\
**Query**: [`src/adapters/github/operations.graphql`](src/adapters/github/operations.graphql:622–624) — `GetUserNodeId`

The GraphQL query `GetUserNodeId` at line 622 queries `user(login: $login) { id }`. GitHub's GraphQL schema has separate root fields for `user(login:)` and `organization(login:)`. Organization accounts and bot accounts (e.g. `dependabot[bot]`) are `Organization` type, not `User` type. The `user(login:)` query returns null for org/bot accounts.

**Callers**:

- [`story-mutation-service.ts:170–172`](src/adapters/github/internal/story-mutation-service.ts:170) — `createStory()` resolves assignee IDs via `resolveUserNodeIds()` for draft creation
- [`story-mutation-service.ts:321`](src/adapters/github/internal/story-mutation-service.ts:321) — `updateStory()` resolves assignee IDs for label/assignee updates
- [`field-value-mutator.ts:387–388`](src/adapters/github/internal/field-value-mutator.ts:387) — `setFieldAssignee()` resolves a single login via `resolveUserNodeId()`

When the assignee is an org account or bot login, the `user()` query returns null, and `GitHubApiError` is thrown at line 34–42: `User "${login}" not found.` — even though the account exists, just as an Organization rather than a User.

---

### 5. Search API — Private Repo Issues May Be Invisible

**File**: [`src/adapters/github/internal/search-query-builder.ts`](src/adapters/github/internal/search-query-builder.ts:24–53)\
**File**: [`src/adapters/github/internal/search-result-normalizer.ts`](src/adapters/github/internal/search-result-normalizer.ts:45–100)\
**File**: [`src/adapters/github/internal/assemblers/search-api-assembler.ts`](src/adapters/github/internal/assemblers/search-api-assembler.ts:35–97)

The GitHub Search API at `search(query: ...)` uses a different permission model than the GraphQL node API. Fine-grained PATs require explicit `repository:search` permission, and even classic PATs must have `repo` scope for private repos. The `buildSearchQueryString` at line 30–32 adds `repo:${owner}/${repo}` clauses for each tracked repo. If the token cannot search the repo, the search returns zero results — silently.

At [`search-api-assembler.ts:59–68`](src/adapters/github/internal/assemblers/search-api-assembler.ts:59), the search query is executed via `ExecutionEngine`. Results flow through `searchIssuesToProjectItems()` at [`search-result-normalizer.ts`](src/adapters/github/internal/search-result-normalizer.ts:45), which filters by `project.number === projectNumber`. If no search results come back (due to permission), the final result is an empty items array — no error is raised.

**Contrast**: The board-scan path (`ProjectItemsAssembler` at [`project-items-assembler.ts`](src/adapters/github/internal/assemblers/project-items-assembler.ts:29–55)) fetches items directly from the project via `projectV2.items(...)` GraphQL, which respects project-level permissions regardless of repo visibility. The search path is gated by repository search permissions, not project permissions — a user who can see the project board may not be able to search issues in a private tracked repo.

---

### 6. Draft Issue Promotion — Partial Failure on Labels/Epic/Type

**File**: [`src/adapters/github/internal/story-mutation-service.ts`](src/adapters/github/internal/story-mutation-service.ts:161–264)

`createStory()` creates items as Draft Issues first (line 176–188). When the story requires labels, epic, or org issue type, it promotes the draft to a real Issue at line 211 via `convertDraftToIssue()`. The promotion uses `CONVERT_DRAFT_ISSUE_MUTATION` which takes `repositoryId` — obtained from the **primary tracked repo only** at [`label-resolver.ts:54`](src/adapters/github/internal/label-resolver.ts:54).

**Failure scenario**: If the primary repo is private and the token lacks `Issues: write`, `convertDraftToIssue` throws at line 446–456. The Draft Issue was already created (line 190 has `itemId`), but the story reference is returned at line 263 — the caller gets `{ id: itemId }` back from `createStory()` without the labels/epic/type being applied. The handler at [`tools/handlers/write.ts:104–128`](src/tools/handlers/write.ts:104) then calls `composeStorySnapshot()` to build the response — this succeeds but returns a story without the expected fields, since only the draft was created.

**Upstream handler**: [`tools/handlers/write.ts`](src/tools/handlers/write.ts:100–129) — `handleCreateStory()` catches some failures via `catchBackend` at line 109–113 for sprint field errors, but does not wrap the `createStory()` call itself. A failure during draft-to-issue conversion (labels/epic/type) propagates as an unhandled exception from the handler, leaving a dangling Draft Issue on the board.

---

### 7. `owner_type: "user"` With Org Owner Name Produces Misleading Error

**File**: [`src/adapters/github/bootstrap.ts`](src/adapters/github/bootstrap.ts:302–338)

The bootstrap query `GET_OWNER_BOOTSTRAP_QUERY` at line 311–314 passes `isOrg: false` when `ownerType === "user"`. The GraphQL query at [`operations.graphql:790–851`](src/adapters/github/operations.graphql:790) uses `@skip(if: $isOrg)` for the `user()` branch and `@include(if: $isOrg)` for the `organization()` branch. When `isOrg: false`:

- `user(login: "myorg")` returns null (the login is an org, not a user)
- `organization(login: "myorg")` is skipped

At line 315: `projectNode = ownerResult.user?.projectV2` → null. The error at line 324 says:

```
Project #<number> not found for user '<orgName>'.
```

This is factually wrong — the project exists, the query simply used the wrong GraphQL root. The recovery message at line 331 says "Make sure owner_type matches the project's owner type" but the error itself still says "for user" even though the account may be an org.

Conversely, when `owner_type: "org"` with a personal account: line 318 assigns `org = ownerResult.organization` which is null, then `org?.projectV2` is null, producing the same error message but for the org root.

---

### 8. Cross-Repo Issue Number Collision

**File**: [`src/adapters/github/internal/resolve-issue-number.ts`](src/adapters/github/internal/resolve-issue-number.ts:44–63)

`fetchProjectItemByIssueNumber` at line 44 iterates through `tracked_repos` sequentially (line 51). For issue number N, it queries each repo's `repository(owner, repo).issue(number: N)`. If the same issue number exists in multiple tracked repos, the first repo's match wins (line 59 returns the first non-null item). When the project board contains items from multiple repos, the same issue number could refer to different items in different repos — the iteration order determines which one is returned, with no warning about the collision.

**Callers**: [`resolveProjectItemIdByIssueNumber`](src/adapters/github/internal/resolve-issue-number.ts:134) and [`AbstractProjectBackend.resolveRef()`](src/adapters/github/internal/resolve-issue-number.ts:134) use this to resolve `{ number }` refs to `{ id }` refs. `fetchProjectItemsByIssueNumbers` at line 65 has a search-based optimization that can also mis-resolve: the `SearchIssues` query at line 84 searches across all repos, and then individual `fetchProjectItemByIssueNumber` calls are made for found numbers — but each is still subject to the first-repo-wins semantics.

---

### 9. `addFieldOption` Uses Project Board Mutation for Issue-Backed Fields

**File**: [`src/adapters/github/internal/vocabulary-manager.ts`](src/adapters/github/internal/vocabulary-manager.ts:84–105)

`addSingleSelectOption` at line 84 calls `GET_FIELD_OPTIONS_QUERY` (line 88) and `UPDATE_FIELD_MUTATION` (line 100–103). These operate on the project board field node via `updateProjectV2Field`. When the project uses issue-backed fields (org-level), the project board single-select field may have empty options — the real options live on the org-level `IssueFieldSingleSelect`. Adding an option via `addSingleSelectOption` modifies the project board field's option list, not the org-level issue field's options. This means:

- `scrum_add_vocabulary kind=status_option` adds to the project board Status field
- For org projects where Status is backed by an org issue field, the new option only appears on the project board, not in the org issue field's option catalog
- Writes via `setIssueBackedField` at field-value-mutator.ts line 50–72 use the org field option IDs from `issueBacked.options` — options added via `scrum_add_vocabulary` won't be found there

**Result**: Adding a status or priority option via `scrum_add_vocabulary` for org projects with issue-backed fields appears to succeed (returns `created: true`) but the new option is not available for subsequent writes through the issue-backed field path, because the option ID lookup at field-value-mutator.ts line 99 (`issueBacked.options[value]`) doesn't find it. The `??` fallback to `live.statusOptions[value]` would also fail since that map was populated from the board field options at bootstrap.
