# Plan: Mapper Layer — GraphQL Fixture & Snapshot Test Strategy

> **Context:** The GitHub adapter's mapper layer (`src/adapters/github/mappers.ts`) has zero direct tests. All functions — `buildStoryFromRaw`, `buildEnrichedStory`, `extractBoardFields`, `buildCommentList`, `buildLinkedPrList`, `resolveDependencyRefs` — are pure but untested. The existing service tests (`story-mutation-service.test.ts`, `story-query-service.test.ts`) use minimal hand-crafted response stubs that omit most of the real GitHub API shape, leaving field-mapping regressions completely invisible.
>
> **Handover note for coding agent:** This document is self-contained. Execute the phases in order. All fixture JSON files, test code, config shapes, and TypeScript types are specified in full. Do not skip the verification step at the end of each phase.

---

## Why snapshot testing here

The mapper functions are pure data transformers: GitHub API response shape → domain `Story` objects. The risk is not control flow — it is shape drift. If `extractBoardFields` silently stops reading the iteration field, or `buildStoryFromRaw` drops `blocked_by` entries, no existing test catches it.

`assertSnapshot` is the right tool because:

- The full domain object is the contract, not just one field
- Snapshots serve as a human-readable record of what the mapper produces from a real-shaped input
- Any future change to the mapper, the `ProjectItem` type, or `operations.graphql` fragments that changes mapper output will fail the snapshot, requiring a deliberate `--update`

`assertEquals` is used where a single field relationship is being tested (not a whole object), because it produces a cleaner failure message than a snapshot diff.

---

## Architecture of the test approach

```
testdata/*.json          ← sanitized GitHub API response fixtures
     │
     ▼
mappers.test.ts          ← pure function tests (permissions: "none" per test)
     │                      loads fixtures at module level with top-level await
     ▼
assertSnapshot()         ← golden outputs in __snapshots__/mappers.test.ts.snap
assertEquals()           ← for single-field assertions
```

Fixtures are loaded **once at module level** using top-level `await Deno.readTextFile()`. This runs before any `Deno.test()` call, at module initialisation time — before per-test `permissions: "none"` is enforced. The `permissions: "none"` on individual test functions constrains what those test closures may do, not what the module initialiser may do. This is correct and idiomatic Deno.

---

## MIME/Import map addition required

Add `@std/testing` to `deno.json` imports if not already present:

```json
"@std/testing": "jsr:@std/testing@^1"
```

`assertSnapshot` is imported from `@std/testing/snapshot`.

---

## Phase 1 — Create fixture files

**New directory:** `src/adapters/github/testdata/`

Four fixture files. The canonical way to create and refresh these is with the live-capture script:

```bash
deno task capture-fixtures           # write fixtures from live GitHub API
deno task capture-fixtures --dry-run # preview without writing
```

The script (`scripts/capture-test-fixtures.ts`) reads `.github/scrum/config.yml`, authenticates with `GITHUB_TOKEN`, fetches real project items, selects representative samples, runs `GetIssueDetails` on the best issue, and writes all four files. See **Refreshing Fixtures** at the end of this document for full details.

If you need to create fixtures without API access (e.g. in a CI environment with no token), use the hand-crafted JSON below. All node IDs, logins, and project IDs are fake. The field shapes are derived directly from the `ItemContent`, `ItemFieldValues`, and `GetIssueDetails` fragment/query definitions in `operations.graphql` and the `ItemFieldValue`, `ProjectItem`, `ProjectItemIssueContent`, `ProjectItemDraftContent`, `MilestoneRefNode`, `IssueRefNode`, and `AssigneeNodes` types in `types.ts`.

### `testdata/project-item-issue.json`

An `Issue`-type `ProjectItem` with all five board fields populated (status, sprint, story_points, priority, type). Includes a milestone (epic), an assignee, a label, and one `blockedBy` dependency.

```json
{
  "id": "PVTI_item1",
  "type": "ISSUE",
  "createdAt": "2026-01-01T10:00:00Z",
  "updatedAt": "2026-01-10T12:00:00Z",
  "isArchived": false,
  "content": {
    "__typename": "Issue",
    "id": "I_issue1",
    "number": 42,
    "title": "As a user I want to log in",
    "body": "## Acceptance Criteria\n- [ ] Login form renders\n- [ ] Session token stored",
    "url": "https://github.com/test-owner/test-repo/issues/42",
    "state": "OPEN",
    "assignees": { "nodes": [{ "login": "alice" }] },
    "labels": { "nodes": [{ "name": "backend", "color": "0075ca" }] },
    "milestone": { "id": "MI_epic1", "title": "Q1 Auth Epic" },
    "repository": { "name": "test-repo", "nameWithOwner": "test-owner/test-repo" },
    "blockedBy": {
      "nodes": [{ "id": "I_dep1", "number": 39, "title": "Set up DB schema" }]
    }
  },
  "fieldValues": {
    "nodes": [
      {
        "__typename": "ProjectV2ItemFieldSingleSelectValue",
        "name": "In Progress",
        "color": "YELLOW",
        "optionId": "opt_ip",
        "field": { "id": "PVTF_status", "name": "Status" }
      },
      {
        "__typename": "ProjectV2ItemFieldIterationValue",
        "title": "Sprint 5",
        "startDate": "2026-01-01",
        "duration": 14,
        "iterationId": "IT_active",
        "field": { "id": "PVTF_sprint", "name": "Sprint" }
      },
      {
        "__typename": "ProjectV2ItemFieldNumberValue",
        "number": 3,
        "field": { "id": "PVTF_points", "name": "Story Points" }
      },
      {
        "__typename": "ProjectV2ItemFieldSingleSelectValue",
        "name": "Should",
        "color": "BLUE",
        "optionId": "opt_should",
        "field": { "id": "PVTF_priority", "name": "Priority" }
      },
      {
        "__typename": "ProjectV2ItemFieldSingleSelectValue",
        "name": "User Story",
        "color": "GREEN",
        "optionId": "opt_us",
        "field": { "id": "PVTF_type", "name": "Type" }
      }
    ]
  }
}
```

### `testdata/project-item-draft.json`

A `DraftIssue`-type `ProjectItem` with one board field (status). Has no milestone, URL, or blockedBy — consistent with the DraftIssue GraphQL shape.

```json
{
  "id": "PVTI_draft1",
  "type": "DRAFT_ISSUE",
  "createdAt": "2026-01-05T09:00:00Z",
  "updatedAt": "2026-01-05T09:00:00Z",
  "isArchived": false,
  "content": {
    "__typename": "DraftIssue",
    "id": "DI_draft1",
    "title": "Spike: investigate auth library options",
    "body": "Research JWT vs session tokens. Timebox 2h.",
    "assignees": { "nodes": [{ "login": "bob" }] }
  },
  "fieldValues": {
    "nodes": [
      {
        "__typename": "ProjectV2ItemFieldSingleSelectValue",
        "name": "In Progress",
        "color": "YELLOW",
        "optionId": "opt_ip",
        "field": { "id": "PVTF_status", "name": "Status" }
      }
    ]
  }
}
```

### `testdata/project-item-no-fields.json`

An `Issue`-type `ProjectItem` with an empty `fieldValues` array. Verifies that `buildStoryFromRaw` returns all board fields as `null` gracefully.

```json
{
  "id": "PVTI_bare1",
  "type": "ISSUE",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z",
  "isArchived": false,
  "content": {
    "__typename": "Issue",
    "id": "I_bare1",
    "number": 1,
    "title": "Unplanned item — no board fields set",
    "body": "",
    "url": "https://github.com/test-owner/test-repo/issues/1",
    "state": "OPEN",
    "assignees": { "nodes": [] },
    "labels": { "nodes": [] },
    "milestone": null,
    "repository": { "name": "test-repo", "nameWithOwner": "test-owner/test-repo" },
    "blockedBy": { "nodes": [] }
  },
  "fieldValues": { "nodes": [] }
}
```

### `testdata/issue-details.json`

A `GetIssueDetails` query response. Includes one comment with a real author and one `CrossReferencedEvent` linked PR. This is the shape `StoryQueryService.getStoryDetail` feeds to `buildEnrichedStory`, `buildCommentList`, and `buildLinkedPrList`.

```json
{
  "node": {
    "id": "I_issue1",
    "number": 42,
    "title": "As a user I want to log in",
    "body": "## Acceptance Criteria\n- [ ] Login form renders\n- [ ] Session token stored",
    "url": "https://github.com/test-owner/test-repo/issues/42",
    "createdAt": "2026-01-01T10:00:00Z",
    "updatedAt": "2026-01-10T12:00:00Z",
    "assignees": { "nodes": [{ "login": "alice" }] },
    "labels": { "nodes": [{ "name": "backend" }] },
    "milestone": { "id": "MI_epic1", "title": "Q1 Auth Epic" },
    "blockedBy": {
      "nodes": [{ "id": "I_dep1", "number": 39, "title": "Set up DB schema" }]
    },
    "comments": {
      "nodes": [
        {
          "id": "IC_c1",
          "author": { "login": "bob" },
          "body": "Reviewed — LGTM. One nit: rename `token` → `sessionToken`.",
          "createdAt": "2026-01-09T14:00:00Z",
          "url": "https://github.com/test-owner/test-repo/issues/42#issuecomment-1"
        }
      ]
    },
    "timelineItems": {
      "nodes": [
        {
          "source": {
            "number": 55,
            "title": "feat: add login form",
            "url": "https://github.com/test-owner/test-repo/pull/55",
            "state": "OPEN",
            "isDraft": false
          }
        }
      ]
    }
  }
}
```

### Verification

```bash
deno task test  # no new test file yet — verify fixtures are valid JSON
```

Alternatively validate with:

```bash
for f in src/adapters/github/testdata/*.json; do
  deno eval "JSON.parse(await Deno.readTextFile('$f'))" && echo "$f OK"
done
```

---

## Phase 2 — Update `_test_utils.ts`: add `type_mapping` to `makeConfig`

**File to modify:** `src/adapters/github/internal/_test_utils.ts`

The `makeConfig()` factory currently sets `backends: { github: {} }`. The mapper's `extractBoardFields` reads `config.scrumConfig.backends.github.type_mapping` to resolve display names (e.g. `"User Story"`) to canonical type keys (e.g. `"user_story"`). Without this, `buildStoryFromRaw` on the fixture item returns `type: null` instead of `type: "user_story"`.

Add `type_mapping` to the default config in `makeConfig`:

```ts
export function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    scrumConfig: {
      project: { name: "Test" },
      scrum: { priority: [], status: {} },
      backends: {
        github: {
          // type_mapping is read by extractBoardFields to resolve display names
          // (e.g. "User Story") to canonical keys (e.g. "user_story").
          // Matches the display names used in the fixture field values.
          type_mapping: {
            user_story: { display: "User Story" },
            bug: { display: "Bug" },
            feature: { display: "Feature" },
          },
        },
      },
    },
    projectId: "PVT_project1",
    fields: {
      sprintFieldId: "PVTF_sprint",
      statusFieldId: "PVTF_status",
      storyPointsFieldId: "PVTF_points",
      priorityFieldId: "PVTF_priority",
      epicFieldId: null,
      assigneeFieldId: null,
      typeFieldId: "PVTF_type",
    },
    statusOptions: { "In Progress": "opt_ip" },
    priorityOptions: { "Must": "opt_must" },
    typeOptions: { user_story: "opt_us", bug: "opt_bug", feature: "opt_feature" },
    typeTemplatePaths: {},
    iterations: {
      active: { id: "IT_active", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
      next: { id: "IT_next", title: "Sprint 6", startDate: "2026-01-15", duration: 14 },
      completed: [],
      all: [
        { id: "IT_active", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
        { id: "IT_next", title: "Sprint 6", startDate: "2026-01-15", duration: 14 },
      ],
    },
    ...overrides,
  };
}
```

**Important:** Callers that pass `scrumConfig` overrides must include the `type_mapping` key if their test requires type resolution. Since `...overrides` is a shallow spread, a `scrumConfig` override replaces the whole `scrumConfig` object, including the default `type_mapping`. If a test does not care about type resolution, the override can omit `type_mapping` — `extractBoardFields` falls back to an empty map and returns `type: null`.

### Verification

```bash
deno lint src/adapters/github/internal/_test_utils.ts
deno fmt --check src/adapters/github/internal/_test_utils.ts
deno task test  # existing tests must still pass
```

---

## Phase 3 — Create `mappers.test.ts`

**New file:** `src/adapters/github/mappers.test.ts`

Full implementation below. The file has five test groups (A–E). All test functions use `permissions: "none"`. Fixtures are loaded at module level using top-level `await`.

```ts
// =============================================================================
// src/adapters/github/mappers.test.ts
//
// Snapshot and unit tests for the GitHub adapter mapper functions.
//
// Test strategy:
//   - Fixtures in testdata/ provide structurally complete GitHub API responses.
//   - assertSnapshot() captures the full domain object output as the golden contract.
//   - assertEquals() is used for single-field assertions where a snapshot diff
//     would be noisy relative to what is actually being tested.
//   - All test functions use permissions: "none" — they are pure functions.
//   - Fixtures are loaded at module level (top-level await) before test
//     functions execute — this is outside the per-test permission boundary.
// =============================================================================

import { assertSnapshot } from "@std/testing/snapshot";
import { assertEquals } from "@std/assert";
import {
  buildCommentList,
  buildEnrichedStory,
  buildLinkedPrList,
  buildStoryFromRaw,
  resolveDependencyRefs,
} from "./mappers.ts";
import { makeConfig } from "./internal/_test_utils.ts";
import type { IssueDetailsInput } from "./mappers.ts";
import type { ItemFieldValue, ProjectItem } from "./types.ts";

// ── Fixtures (loaded once at module init, before any test function runs) ──────

const issueItem = JSON.parse(
  await Deno.readTextFile("src/adapters/github/testdata/project-item-issue.json"),
) as ProjectItem;

const draftItem = JSON.parse(
  await Deno.readTextFile("src/adapters/github/testdata/project-item-draft.json"),
) as ProjectItem;

const bareItem = JSON.parse(
  await Deno.readTextFile("src/adapters/github/testdata/project-item-no-fields.json"),
) as ProjectItem;

const issueDetailsRaw = JSON.parse(
  await Deno.readTextFile("src/adapters/github/testdata/issue-details.json"),
) as { node: IssueDetailsInput };
const issueDetails = issueDetailsRaw.node;

// ── Config ────────────────────────────────────────────────────────────────────

// Default makeConfig() includes type_mapping for "User Story" → "user_story".
// See _test_utils.ts for the full mapping. All fixture field values use these
// display names, so assertSnapshot output should show resolved canonical types.
const config = makeConfig();

// ══════════════════════════════════════════════════════════════════════════════
// Group A — buildStoryFromRaw
// ══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "buildStoryFromRaw — issue with all board fields populated (snapshot)",
  permissions: "none",
  async fn(t) {
    const story = buildStoryFromRaw(issueItem, config);
    await assertSnapshot(t, story);
  },
});

Deno.test({
  name: "buildStoryFromRaw — issue with no board fields → all null (snapshot)",
  permissions: "none",
  async fn(t) {
    const story = buildStoryFromRaw(bareItem, config);
    await assertSnapshot(t, story);
  },
});

Deno.test({
  name: "buildStoryFromRaw — draft issue (snapshot)",
  permissions: "none",
  async fn(t) {
    const story = buildStoryFromRaw(draftItem, config);
    await assertSnapshot(t, story);
  },
});

Deno.test({
  name: "buildStoryFromRaw — null content returns null",
  permissions: "none",
  fn() {
    const item = { ...issueItem, content: null } as ProjectItem;
    assertEquals(buildStoryFromRaw(item, config), null);
  },
});

Deno.test({
  name: "buildStoryFromRaw — type display name resolves to canonical key",
  permissions: "none",
  fn() {
    // issueItem has Type field = "User Story"; makeConfig maps "User Story" → "user_story"
    const story = buildStoryFromRaw(issueItem, config);
    assertEquals(story?.type, "user_story");
  },
});

Deno.test({
  name: "buildStoryFromRaw — unknown type display name resolves to null",
  permissions: "none",
  fn() {
    // Replace the type field value with an unmapped display name
    const customItem: ProjectItem = {
      ...issueItem,
      fieldValues: {
        nodes: issueItem.fieldValues.nodes.map((fv) =>
          fv.field?.id === "PVTF_type" ? { ...fv, name: "UnknownType" } : fv
        ),
      },
    };
    const story = buildStoryFromRaw(customItem, config);
    assertEquals(story?.type, null);
  },
});

Deno.test({
  name: "buildStoryFromRaw — board fields extracted from correct field IDs",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(issueItem, config);
    assertEquals(story?.status, "In Progress");
    assertEquals(story?.sprint, "Sprint 5");
    assertEquals(story?.story_points, 3);
    assertEquals(story?.priority, "Should");
  },
});

Deno.test({
  name: "buildStoryFromRaw — field value with wrong field ID is ignored",
  permissions: "none",
  fn() {
    // Move the status field value to an unrecognized field ID
    const customItem: ProjectItem = {
      ...issueItem,
      fieldValues: {
        nodes: issueItem.fieldValues.nodes.map((fv) =>
          fv.field?.id === "PVTF_status"
            ? { ...fv, field: { id: "PVTF_unknown", name: "Unknown" } }
            : fv
        ),
      },
    };
    const story = buildStoryFromRaw(customItem, config);
    assertEquals(story?.status, null);
  },
});

Deno.test({
  name: "buildStoryFromRaw — blocked_by entries mapped from issue content",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(issueItem, config);
    assertEquals(story?.blocked_by.length, 1);
    assertEquals(story?.blocked_by[0].key, "39");
    assertEquals(story?.blocked_by[0].title, "Set up DB schema");
    // ref.id is issue node ID at this stage — resolveDependencyRefs maps it later
    assertEquals(story?.blocked_by[0].ref.id, "I_dep1");
  },
});

Deno.test({
  name: "buildStoryFromRaw — draft issue has empty blocked_by",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(draftItem, config);
    assertEquals(story?.blocked_by, []);
  },
});

Deno.test({
  name: "buildStoryFromRaw — issue with no assignees returns empty array",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(bareItem, config);
    assertEquals(story?.assignees, []);
  },
});

Deno.test({
  name: "buildStoryFromRaw — milestone mapped to epic ref and name",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(issueItem, config);
    if (story?.kind !== "issue") throw new Error("expected issue story");
    assertEquals(story.epic?.ref.id, "MI_epic1");
    assertEquals(story.epic?.name, "Q1 Auth Epic");
  },
});

Deno.test({
  name: "buildStoryFromRaw — no milestone → epic is null",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(bareItem, config);
    if (story?.kind !== "issue") throw new Error("expected issue story");
    assertEquals(story.epic, null);
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// Group B — buildEnrichedStory
// ══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "buildEnrichedStory — full issue details with empty field values (snapshot)",
  permissions: "none",
  async fn(t) {
    // Board fields come from the project item field values, not from the issue node.
    // Passing [] simulates the case where GetItemFields is unavailable (catchBackend).
    const story = buildEnrichedStory(issueDetails, "PVTI_item1", [], config);
    await assertSnapshot(t, story);
  },
});

Deno.test({
  name: "buildEnrichedStory — field values merged from project item (snapshot)",
  permissions: "none",
  async fn(t) {
    // Pass the field value nodes from the issue fixture to test full enrichment.
    const fieldValueNodes = issueItem.fieldValues.nodes as ItemFieldValue[];
    const story = buildEnrichedStory(issueDetails, "PVTI_item1", fieldValueNodes, config);
    await assertSnapshot(t, story);
  },
});

Deno.test({
  name: "buildEnrichedStory — status and sprint come from item field values, not issue node",
  permissions: "none",
  fn() {
    const fieldValueNodes = issueItem.fieldValues.nodes as ItemFieldValue[];
    const story = buildEnrichedStory(issueDetails, "PVTI_item1", fieldValueNodes, config);
    assertEquals(story.status, "In Progress");
    assertEquals(story.sprint, "Sprint 5");
    assertEquals(story.story_points, 3);
  },
});

Deno.test({
  name: "buildEnrichedStory — blocked_by mapped from issue node",
  permissions: "none",
  fn() {
    const story = buildEnrichedStory(issueDetails, "PVTI_item1", [], config);
    assertEquals(story.blocked_by.length, 1);
    assertEquals(story.blocked_by[0].key, "39");
    assertEquals(story.blocked_by[0].ref.id, "I_dep1");
  },
});

Deno.test({
  name: "buildEnrichedStory — uses provided itemId as story ref.id",
  permissions: "none",
  fn() {
    const story = buildEnrichedStory(issueDetails, "PVTI_custom_id", [], config);
    assertEquals(story.ref.id, "PVTI_custom_id");
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// Group C — buildCommentList
// ══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "buildCommentList — maps author, body, createdAt, url (snapshot)",
  permissions: "none",
  async fn(t) {
    const comments = buildCommentList(
      issueDetails.comments!.nodes as Parameters<typeof buildCommentList>[0],
    );
    await assertSnapshot(t, comments);
  },
});

Deno.test({
  name: "buildCommentList — ghost author when author is null",
  permissions: "none",
  fn() {
    const result = buildCommentList(
      [
        {
          author: null,
          body: "anonymous comment",
          createdAt: "2026-01-01T00:00:00Z",
          url: "https://example.com",
        },
      ] as Parameters<typeof buildCommentList>[0],
    );
    assertEquals(result[0].author, "(ghost)");
    assertEquals(result[0].body, "anonymous comment");
  },
});

Deno.test({
  name: "buildCommentList — empty nodes returns empty array",
  permissions: "none",
  fn() {
    assertEquals(buildCommentList([]), []);
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// Group D — buildLinkedPrList
// ══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "buildLinkedPrList — maps PR number, title, url, state, is_draft (snapshot)",
  permissions: "none",
  async fn(t) {
    const prs = buildLinkedPrList(
      issueDetails.timelineItems!.nodes as Parameters<typeof buildLinkedPrList>[0],
    );
    await assertSnapshot(t, prs);
  },
});

Deno.test({
  name: "buildLinkedPrList — skips entries with null source",
  permissions: "none",
  fn() {
    const result = buildLinkedPrList([{ source: null }] as Parameters<typeof buildLinkedPrList>[0]);
    assertEquals(result, []);
  },
});

Deno.test({
  name: "buildLinkedPrList — skips entries where source has no number",
  permissions: "none",
  fn() {
    // source exists but number is absent (not a PR, or partial data)
    const result = buildLinkedPrList(
      [
        { source: { title: "PR", url: "https://x.com", state: "OPEN", isDraft: false } as never },
      ] as Parameters<typeof buildLinkedPrList>[0],
    );
    assertEquals(result, []);
  },
});

Deno.test({
  name: "buildLinkedPrList — empty nodes returns empty array",
  permissions: "none",
  fn() {
    assertEquals(buildLinkedPrList([]), []);
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// Group E — resolveDependencyRefs
// ══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "resolveDependencyRefs — maps issue node ID to project item ID",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(issueItem, config)!;
    // Before resolution, ref.id is the issue node ID "I_dep1" from blockedBy
    assertEquals(story.blocked_by[0].ref.id, "I_dep1");

    // Simulate the dep item being in allItems with project item ID "PVTI_dep1"
    const depItem: ProjectItem = {
      ...bareItem,
      id: "PVTI_dep1",
      content: {
        ...bareItem.content as Extract<ProjectItem["content"], { __typename: "Issue" }>,
        id: "I_dep1",
        number: 39,
        title: "Set up DB schema",
      },
    };
    const resolved = resolveDependencyRefs([story], [issueItem, depItem]);
    assertEquals(resolved[0].blocked_by[0].ref.id, "PVTI_dep1");
  },
});

Deno.test({
  name: "resolveDependencyRefs — falls back to issue number match when node ID not found",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(issueItem, config)!;
    // Dep item has a different issue node ID — fallback must match by issue number "39"
    const depItem: ProjectItem = {
      ...bareItem,
      id: "PVTI_dep1",
      content: {
        ...bareItem.content as Extract<ProjectItem["content"], { __typename: "Issue" }>,
        id: "I_different_node_id",
        number: 39,
      },
    };
    const resolved = resolveDependencyRefs([story], [depItem]);
    assertEquals(resolved[0].blocked_by[0].ref.id, "PVTI_dep1");
  },
});

Deno.test({
  name: "resolveDependencyRefs — leaves ref.id unchanged when dep not in allItems",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(issueItem, config)!;
    const resolved = resolveDependencyRefs([story], []);
    // ref.id stays as the issue node ID — cross-repo dependency, no mapping available
    assertEquals(resolved[0].blocked_by[0].ref.id, "I_dep1");
  },
});

Deno.test({
  name: "resolveDependencyRefs — no-op for stories with no blocked_by entries",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(bareItem, config)!;
    const resolved = resolveDependencyRefs([story], [issueItem]);
    assertEquals(resolved[0].blocked_by, []);
  },
});

Deno.test({
  name: "resolveDependencyRefs — skips DraftIssue items in allItems (no issue node)",
  permissions: "none",
  fn() {
    const story = buildStoryFromRaw(issueItem, config)!;
    // allItems contains only a draft — resolution should not match and leave ref unchanged
    const resolved = resolveDependencyRefs([story], [draftItem]);
    assertEquals(resolved[0].blocked_by[0].ref.id, "I_dep1");
  },
});
```

### Verification (before snapshot generation)

Check that the test file compiles cleanly with no type errors before generating snapshots:

```bash
deno lint src/adapters/github/mappers.test.ts
deno fmt --check src/adapters/github/mappers.test.ts
deno check src/adapters/github/mappers.test.ts
```

---

## Phase 4 — Generate and commit snapshots

Run the test file once with `--update` to write the initial golden snapshots:

```bash
deno test --allow-read --allow-env=GITHUB_TOKEN,NODE_ENV --allow-write \
  --update src/adapters/github/mappers.test.ts
```

The `--allow-write` flag is needed only on the first `--update` run — it allows `assertSnapshot` to create the `.snap` file. Subsequent runs in CI do not need `--allow-write`.

Inspect the generated file before committing:

```bash
cat src/adapters/github/__snapshots__/mappers.test.ts.snap
```

Verify it contains readable domain object representations for all snapshot tests. Commit the snapshot file alongside the test file and fixture files.

### Full verification after committing snapshots

```bash
deno lint src/adapters/github/mappers.test.ts
deno fmt --check src/adapters/github/mappers.test.ts
deno task test
```

All tests must pass including the new ones. The `--update` flag must NOT be passed in CI — a stale snapshot is a test failure, not an auto-fix.

---

## Updating snapshots intentionally

When a mapper function is legitimately changed (e.g. a new field added to `IssueStory`, or a default value changed), update the snapshots deliberately:

```bash
deno test --allow-read --allow-env=GITHUB_TOKEN,NODE_ENV --allow-write \
  --update src/adapters/github/mappers.test.ts
```

Review the diff in the `.snap` file before committing — this is the safety gate. An unexpected snapshot change indicates an unintentional regression.

---

## Refreshing Fixtures

### The `capture-fixtures` task

```bash
deno task capture-fixtures
```

**Script:** `scripts/capture-test-fixtures.ts`\
**Permissions:** `--allow-env=GITHUB_TOKEN,DEBUG,NODE_ENV --allow-net --allow-read --allow-write`

The script does the following in sequence:

1. Reads `.github/scrum/config.yml` to get `owner`, `owner_type`, and `project_number`.
2. Calls a minimal bootstrap query (`GetUserProjectId` / `GetOrgProjectId`) to resolve the project's node ID. This is cheaper than the full bootstrap used by the server.
3. Fetches the first 50 project items using an inline GraphQL query that mirrors the `ItemContent` + `ItemFieldValues` fragment shapes from `operations.graphql`. This ensures fixture shape matches what `buildStoryFromRaw` actually receives.
4. Selects fixtures by scoring: the best issue is the one with the most board fields populated, preferring items with `blockedBy` entries and a milestone.
5. Runs `GET_ISSUE_DETAILS_QUERY` (imported directly from `queries.ts`) on the selected issue's content ID, so the fixture is the exact response the server sends for `getStoryDetail`.
6. Derives `project-item-no-fields.json` programmatically by stripping `fieldValues.nodes` — no extra API call.
7. Falls back to a synthetic draft fixture with a warning if the project has no `DRAFT_ISSUE` items.

### Flags

| Flag                 | Effect                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--dry-run`          | Prints fixture JSON to stdout, writes nothing to disk. Use to inspect what would be captured before committing. |
| `--update-snapshots` | After writing fixtures, runs `deno test --update` on `mappers.test.ts` to regenerate `.snap` files in one step. |

### Full refresh workflow (one command)

```bash
deno task capture-fixtures --update-snapshots
```

This fetches fresh data, writes all four fixture files, and regenerates the snapshot golden file. Review the diff on `__snapshots__/mappers.test.ts.snap` before committing — an unexpected change means a mapper regression was caught.

### Separate snapshot-only update

If you changed a mapper function intentionally (e.g. added a field to `IssueStory`) but did not change fixtures:

```bash
deno task update-snapshots
```

This runs `deno test --update` across the entire `src/` tree. All snapshot tests that changed output will have their `.snap` files updated.

### When to re-run `capture-fixtures`

- When `operations.graphql` fragment shapes change (new fields added to `ItemContent`, `ItemFieldValues`, or `GetIssueDetails`).
- When the `ProjectItem` or `ItemFieldValue` types in `types.ts` change to include new fields the API returns.
- Periodically (e.g. per sprint) to ensure fixtures reflect real data from the live board rather than drifting out of date.
- When onboarding a new project — run once to seed initial fixtures from the new board.

### What the script does NOT do

- It does not sanitize personally identifiable information (user logins, issue titles). If your board contains sensitive information, review fixtures before committing.
- It does not fetch more than 50 items. If your project has no issues in the first 50 items, add an issue to the board and retry.
- It does not update `project-item-no-fields.json` with a real unfielded item — it always derives this by stripping `fieldValues` from the best issue. This is intentional: truly unfielded items are rare in practice.

---

## What is NOT covered by this plan (by design)

| Area                                | Reason not included                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `StoryQueryService.getStoryDetail`  | Control-flow service method; best extended in `story-query-service.test.ts` using the existing queue spy pattern                       |
| `StoryQueryService.findItems`       | Same — filter logic is best tested with spy-enqueued responses, not mapper fixtures                                                    |
| `extractBoardFields` (private)      | Fully covered as a side effect of all `buildStoryFromRaw` tests; it is private to `mappers.ts` and cannot be directly imported         |
| Live GitHub API responses           | Out of scope for a unit test plan; if desired, write a `scripts/capture-fixtures.ts` that calls the real API and writes to `testdata/` |
| `buildBurndownStoryInput`           | Thin wrapper over `extractBoardFields` — low risk; can be added in a follow-up with a single fixture-based snapshot test               |
| `toSprintInfo`, `resolveSprintGoal` | Already covered or trivially simple; out of scope here                                                                                 |

---

## File inventory

| File                                                       | Action                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/adapters/github/testdata/project-item-issue.json`     | **Create** — Issue with all 5 board fields, milestone, assignee, label, one dep        |
| `src/adapters/github/testdata/project-item-draft.json`     | **Create** — DraftIssue with status field and assignee                                 |
| `src/adapters/github/testdata/project-item-no-fields.json` | **Create** — Issue with empty fieldValues                                              |
| `src/adapters/github/testdata/issue-details.json`          | **Create** — GetIssueDetails response with one comment and one linked PR               |
| `src/adapters/github/internal/_test_utils.ts`              | **Modify** — add `type_mapping` to `makeConfig` default; update `all` iterations array |
| `src/adapters/github/mappers.test.ts`                      | **Create** — Groups A–E, ~30 tests                                                     |
| `src/adapters/github/__snapshots__/mappers.test.ts.snap`   | **Generate** — first-run `--update`, then commit                                       |
| `scripts/capture-test-fixtures.ts`                         | **Create** — live-capture script (already written; see script file)                    |
| `deno.json`                                                | **Modify** — add `capture-fixtures` and `update-snapshots` tasks (already added)       |
