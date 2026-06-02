// =============================================================================
// src/adapters/github/internal/story-query-service.test.ts
//
// Unit tests for buildDependencyMap() - pure function, no mocks needed.
// Tests A-bug-1 (blocks/blocked_by direction), A-bug-2 (cross-repo stub nodes),
// and an integration test with real ProjectItem data from captured fixtures.
// =============================================================================

import { assertEquals, assertFalse } from "@std/assert";
import { buildDependencyMap } from "./story-query-service.ts";
import { makeConfig } from "./_test_utils.ts";
import { toIssueKey } from "../../../domain/types.ts";
import type { DependencyEntry, EntityRef, ItemType, Story } from "../../../domain/types.ts";
import type { IssueStory, ProjectItem } from "../types.ts";
import projectItemsP1 from "../generated/__fixtures__/project-items-p1.json" with { type: "json" };
import projectItemsP2 from "../generated/__fixtures__/project-items-p2.json" with { type: "json" };
import { buildStoryFromRaw } from "../mappers.ts";

// =============================================================================
// Test helpers (hand-crafted for edge case tests)
// =============================================================================

const makeRef = (id: string): EntityRef => ({ id });
const TEST_TYPE: ItemType = "feature" as ItemType;

/**
 * Build a DependencyEntry for test data.
 */
const makeDepEntry = (
  key: string,
  title?: string,
  refId?: string,
): DependencyEntry => ({
  key,
  title: title ?? null,
  ref: { id: refId ?? `PVTI_dep_${key}` },
});

/**
 * Build a minimal IssueStory for test data.
 * Only includes fields that buildDependencyMap actually reads:
 *   kind, key, ref.id, title, status, sprint, story_points, priority,
 *   epic?.name, blocked_by
 */
const makeIssueStory = (opts: {
  key: string;
  refId?: string;
  title?: string;
  status?: string;
  sprint?: string | null;
  story_points?: number | null;
  priority?: string | null;
  epic_name?: string | null;
  blocked_by?: DependencyEntry[];
}): IssueStory => ({
  kind: "issue",
  key: opts.key,
  ref: makeRef(opts.refId ?? `PVTI_${opts.key}`),
  title: opts.title ?? `Story ${opts.key}`,
  body: "",
  type: TEST_TYPE,
  status: opts.status ?? "In Progress",
  sprint: opts.sprint ?? null,
  story_points: opts.story_points ?? null,
  priority: opts.priority ?? null,
  assignees: [],
  labels: [],
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  url: `https://github.com/test/test/issues/${opts.key}`,
  epic: opts.epic_name ? { ref: { id: "MI_epic" }, name: opts.epic_name } : null,
  blocked_by: opts.blocked_by ?? [],
});

/**
 * Build a minimal ProjectItem (issue content) for the second-pass allItems lookup.
 * Only includes the fields buildStoryFromRaw reads.
 */
const makeProjectItem = (opts: { id: string; key: string; title: string }): ProjectItem => ({
  id: opts.id,
  type: "ISSUE",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  isArchived: false,
  content: {
    __typename: "Issue" as const,
    id: `I_${opts.key}`,
    number: parseInt(opts.key, 10) || 1,
    title: opts.title,
    body: "",
    url: `https://github.com/test/test/issues/${opts.key}`,
    state: "OPEN" as const,
    assignees: { nodes: [] },
    labels: { nodes: [] },
    milestone: null,
    repository: { name: "test", nameWithOwner: "test/test" },
  },
  fieldValues: { nodes: [] },
});

// =============================================================================
// Real fixture data — loaded from captured API responses
// =============================================================================

// JSON imports produce loose types; cast through unknown for ProjectV2ItemType
const allRealItems: ProjectItem[] = [
  ...(projectItemsP1.user?.projectV2?.items?.nodes ?? []),
  ...(projectItemsP2.user?.projectV2?.items?.nodes ?? []),
] as unknown as ProjectItem[];

// Pre-build stories from real items using the same production mapper
const config = makeConfig();
const realStories: Story[] = allRealItems
  .map((item) => buildStoryFromRaw(item, config))
  .filter((s): s is Story => s !== null);

// =============================================================================
// Test cases — edge cases with hand-crafted data
// =============================================================================

Deno.test("A-bug-1: dependency direction - A blocked by B", () => {
  // Story 10 is blocked by Story 20
  const storyA = makeIssueStory({
    key: "10",
    refId: "PVTI_10",
    priority: "Must",
    blocked_by: [makeDepEntry("20", "Story B", "PVTI_20")],
  });
  const storyB = makeIssueStory({
    key: "20",
    refId: "PVTI_20",
    priority: "Should",
  });

  const stories: Story[] = [storyA, storyB];
  const allItems: ProjectItem[] = [];

  const map = buildDependencyMap(stories, allItems, makeConfig());

  const keyA = toIssueKey("10");
  const keyB = toIssueKey("20");

  // A is blocked by B → A.blocked_by = [B_key], A.blocks = []
  assertEquals(map[keyA].blocked_by, [keyB], "A should be blocked by B");
  assertEquals(map[keyA].blocks, [], "A should not block anyone");
  assertFalse(map[keyA].blocks.includes(keyB), "A should not appear to block B");

  // B blocks A → B.blocks = [A_key], B.blocked_by = []
  assertEquals(map[keyB].blocks, [keyA], "B should block A");
  assertEquals(map[keyB].blocked_by, [], "B should not be blocked by anyone");
  assertFalse(map[keyB].blocked_by.includes(keyA), "B should not appear to be blocked by A");
});

Deno.test("A-bug-1: no dependencies - blocks and blocked_by are empty", () => {
  const story10 = makeIssueStory({ key: "10" });
  const story20 = makeIssueStory({ key: "20" });

  const stories: Story[] = [story10, story20];
  const allItems: ProjectItem[] = [];

  const map = buildDependencyMap(stories, allItems, makeConfig());

  for (const key of ["10", "20"]) {
    assertEquals(map[toIssueKey(key)].blocks, [], `${key}.blocks should be empty`);
    assertEquals(map[toIssueKey(key)].blocked_by, [], `${key}.blocked_by should be empty`);
  }
});

Deno.test("A-bug-2: cross-repo/off-board dependency → stub node", () => {
  // Story 10 is blocked by issue 99 which is NOT in allItems
  const dep = makeDepEntry("99", "External Issue", "PVTI_99");
  const story10 = makeIssueStory({
    key: "10",
    refId: "PVTI_10",
    blocked_by: [dep],
  });

  const stories: Story[] = [story10];
  const allItems: ProjectItem[] = []; // cross-repo: not in allItems

  const map = buildDependencyMap(stories, allItems, makeConfig());

  const stubKey = toIssueKey("99");
  const stub = map[stubKey];

  // Stub must exist
  assertEquals(typeof stub, "object", "stub node should exist");
  assertEquals(stub.key, stubKey);
  assertEquals(stub.title, "External Issue");
  assertEquals(stub.status, null, "stub status should be null");
  assertEquals(stub.sprint, null);
  assertEquals(stub.epic_name, null);
  assertEquals(stub.story_points, null);
  assertEquals(stub.priority, null);
  assertEquals(stub.resolved, false, "stub should be unresolved");
  assertEquals(stub.blocks, [toIssueKey("10")], "stub blocks story 10 (third pass)");
  assertEquals(stub.blocked_by, [], "stub blocked_by should be empty");

  // Story 10 should have the stub in its blocked_by
  assertEquals(map[toIssueKey("10")].blocked_by, [stubKey]);
});

Deno.test(
  "A-bug-2: out-of-scope dependency (in allItems but not in filtered stories) → unresolved node",
  () => {
    // Story 10 is blocked by issue 30, which exists in allItems but not in stories
    const story10 = makeIssueStory({
      key: "10",
      refId: "PVTI_10",
      blocked_by: [makeDepEntry("30", "Out-of-scope Story", "PVTI_30")],
    });

    const stories: Story[] = [story10];
    const unresolvedItem = makeProjectItem({
      id: "PVTI_30",
      key: "30",
      title: "Out-of-scope Story",
    });
    const allItems: ProjectItem[] = [unresolvedItem];

    const map = buildDependencyMap(stories, allItems, makeConfig());

    const key30 = toIssueKey("30");
    const node = map[key30];

    assertEquals(typeof node, "object", "unresolved node should exist");
    assertEquals(node.key, key30);
    assertEquals(node.resolved, false, "out-of-scope node should be unresolved");
    assertEquals(node.status, null, "no status field in mock config");
    assertEquals(node.blocks, [toIssueKey("10")], "unresolved node blocks story 10 (third pass)");
    assertEquals(node.blocked_by, []);
  },
);

Deno.test("A-bug-1: circular dependency A↔B - direction is consistent", () => {
  // Story 10 blocked by 20, AND 20 blocked by 10
  const story10 = makeIssueStory({
    key: "10",
    refId: "PVTI_10",
    blocked_by: [makeDepEntry("20", "Story B", "PVTI_20")],
  });
  const story20 = makeIssueStory({
    key: "20",
    refId: "PVTI_20",
    blocked_by: [makeDepEntry("10", "Story A", "PVTI_10")],
  });

  const stories: Story[] = [story10, story20];
  const allItems: ProjectItem[] = [];

  const map = buildDependencyMap(stories, allItems, makeConfig());

  const keyA = toIssueKey("10");
  const keyB = toIssueKey("20");

  // Both are in each other's blocked_by (upstream deps)
  assertEquals(map[keyA].blocked_by, [keyB]);
  assertEquals(map[keyB].blocked_by, [keyA]);

  // Both block each other (downstream)
  assertEquals(map[keyA].blocks, [keyB]);
  assertEquals(map[keyB].blocks, [keyA]);
});

Deno.test("draft stories are excluded from dependency map", () => {
  // Draft story should be skipped (kind !== "issue")
  const draft: Story = {
    kind: "draft",
    key: null,
    ref: makeRef("PVTI_draft"),
    title: "Draft Story",
    body: "",
    type: TEST_TYPE,
    status: null,
    sprint: null,
    story_points: null,
    priority: null,
    assignees: [],
    labels: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    url: null,
    epic: null,
    blocked_by: [],
  } as Story;

  const stories: Story[] = [draft];
  const allItems: ProjectItem[] = [];

  const map = buildDependencyMap(stories, allItems, makeConfig());

  assertEquals(Object.keys(map).length, 0, "draft stories should not appear in dependency map");
});

// =============================================================================
// Integration test — real data from captured fixtures
// =============================================================================

Deno.test({
  name: "buildDependencyMap - handles all real project items without throwing",
  fn() {
    // Smoke test: buildStoryFromRaw + buildDependencyMap should not throw
    // on real API response shapes. This catches runtime errors caused by
    // schema drift or unexpected null values in live API responses.
    assertEquals(realStories.length > 0, true, "should have real stories from fixtures");

    const map = buildDependencyMap(realStories, allRealItems, makeConfig());

    // Verify every issue story has a node in the map
    const issueStories = realStories.filter((s) => s.kind === "issue");
    for (const story of issueStories) {
      const key = toIssueKey(story.key!);
      assertEquals(typeof map[key], "object", `node should exist for issue story ${story.key}`);
      assertEquals(map[key].resolved, true, `node for ${story.key} should be resolved`);
    }

    // Verify the map has no orphaned blocks pointing to non-existent nodes
    for (const [, node] of Object.entries(map)) {
      for (const depKey of node.blocked_by) {
        assertEquals(
          typeof map[depKey],
          "object",
          `blocked_by target ${depKey} (from ${node.key}) must exist in map`,
        );
      }
      for (const blockKey of node.blocks) {
        assertEquals(
          typeof map[blockKey],
          "object",
          `blocks target ${blockKey} (computed for ${node.key}) must exist in map`,
        );
      }
    }
  },
});

Deno.test({
  name: "buildDependencyMap - real items have consistent direction (blocks ↔ blocked_by)",
  fn() {
    const map = buildDependencyMap(realStories, allRealItems, makeConfig());

    // For every node: for each depKey in blocked_by, the target's blocks
    // must include the source node's key.
    for (const [nodeKey, node] of Object.entries(map)) {
      for (const depKey of node.blocked_by) {
        const target = map[depKey];
        if (target) {
          assertEquals(
            target.blocks.includes(toIssueKey(nodeKey)),
            true,
            `${depKey}.blocks should include ${nodeKey} because ${nodeKey}.blocked_by includes ${depKey}`,
          );
        }
      }
    }
  },
});
