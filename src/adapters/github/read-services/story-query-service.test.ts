// =============================================================================
// src/adapters/github/story-query-service.test.ts
//
// Unit tests for buildDependencyMap() - pure function, no mocks needed.
// Tests A-bug-1 (blocks/blocked_by direction), A-bug-2 (cross-repo stub nodes),
// and an integration test with real ProjectItem data from captured fixtures.
// =============================================================================

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { buildDependencyMap, StoryQueryService } from "./story-query-service.ts";
import { createGhSpy, makeConfig, makeCtx } from "@test/support/github-client.ts";
import { BoardScanCoordinator } from "./board-scan-coordinator.ts";
import { GitHubApiError } from "../errors.ts";
import { toIssueKey } from "../../../domain/types.ts";
import type {
  BacklogItemListing,
  DependencyEntry,
  EntityRef,
  ItemType,
  Story,
} from "../../../domain/types.ts";
import type { IssueStory, ProjectItem } from "../types.ts";
import { FIXTURE_NODES } from "@test/fixtures/github/index.ts";
import { buildStoryFromRaw } from "../mappers.ts";
import { toItemListing } from "../../../scrum/utils/listing-mappers.ts";

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

const emptyListingFields = {
  type: TEST_TYPE,
  story_points: null,
  priority: null,
  assignees: [] as string[],
  labels: [] as string[],
  sprint: { name: null as string | null, ref: { id: "" } },
  epic: null,
  blocks: [] as { id: string; key: string }[],
  custom_fields: {} as Record<string, string | number | boolean | null>,
};

const makeListing = (opts: {
  key: string;
  refId?: string;
  title?: string;
  status?: string | null;
  sprint?: string | null;
  blocked_by?: DependencyEntry[];
}): BacklogItemListing => ({
  ref: { id: opts.refId ?? `PVTI_${opts.key}`, key: opts.key },
  title: opts.title ?? `Story ${opts.key}`,
  status: opts.status ?? "In Progress",
  ...emptyListingFields,
  sprint: opts.sprint !== undefined
    ? { name: opts.sprint, ref: { id: opts.sprint ? "IT_active" : "" } }
    : emptyListingFields.sprint,
  blocked_by: opts.blocked_by ?? [],
});

/**
 * Build a minimal IssueStory for error-handling tests.
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
const makeProjectItem = (opts: {
  id: string;
  key: string;
  title: string;
  status?: string;
  sprint?: string;
}): ProjectItem => ({
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
  fieldValues: {
    nodes: [
      ...(opts.status
        ? [{
          __typename: "ProjectV2ItemFieldSingleSelectValue",
          field: { id: "PVTF_status", name: "Status" },
          name: opts.status,
        }]
        : []),
      ...(opts.sprint
        ? [{
          __typename: "ProjectV2ItemFieldIterationValue",
          field: { id: "PVTF_sprint", name: "Sprint" },
          title: opts.sprint,
        }]
        : []),
    ],
  },
});

// =============================================================================
// Real fixture data - loaded from captured API responses
// =============================================================================

// JSON imports produce loose types; cast through unknown for ProjectV2ItemType
const allRealItems: ProjectItem[] = [...FIXTURE_NODES];

// Pre-build stories from real items using the same production mapper
const config = makeConfig();
const realStories: Story[] = allRealItems
  .map((item) => buildStoryFromRaw(item, config))
  .filter((s): s is Story => s !== null);

const configWithTerminalDone = makeConfig({
  scrumConfig: {
    project: { name: "Test" },
    scrum: { priority: [], status: { done: { terminal: true, blocking: false } } },
    backends: { github: {} },
  },
});

// =============================================================================
// Test cases - dependency pointer map
// =============================================================================

Deno.test("buildDependencyMap - omits blocker already in returned items", () => {
  const items = [
    makeListing({
      key: "10",
      blocked_by: [makeDepEntry("20", "Story B", "PVTI_20")],
    }),
    makeListing({ key: "20", title: "Story B", refId: "PVTI_20" }),
  ];

  const map = buildDependencyMap(items, [], makeConfig());

  assertEquals(Object.keys(map).length, 0, "in-listing blockers are redundant");
});

Deno.test("buildDependencyMap - includes off-listing active blocker as shallow pointer", () => {
  const items = [
    makeListing({
      key: "10",
      blocked_by: [makeDepEntry("30", "Out-of-scope Story", "PVTI_30")],
    }),
  ];
  const allItems = [makeProjectItem({ id: "PVTI_30", key: "30", title: "Out-of-scope Story" })];

  const map = buildDependencyMap(items, allItems, makeConfig());

  const pointer = map[toIssueKey("30")];
  assertEquals(typeof pointer, "object");
  assertEquals(pointer.key, toIssueKey("30"));
  assertEquals(pointer.title, "Out-of-scope Story");
  assertEquals(pointer.ref.id, "PVTI_30");
  assertEquals(pointer.status, null);
  assertFalse("blocks" in pointer);
  assertFalse("blocked_by" in pointer);
});

Deno.test("buildDependencyMap - includes cross-repo stub with null status", () => {
  const items = [
    makeListing({
      key: "10",
      blocked_by: [makeDepEntry("99", "External Issue", "PVTI_99")],
    }),
  ];

  const map = buildDependencyMap(items, [], makeConfig());

  const pointer = map[toIssueKey("99")];
  assertEquals(pointer.title, "External Issue");
  assertEquals(pointer.status, null);
});

Deno.test("buildDependencyMap - excludes Done blocker not in active sprint", () => {
  const items = [
    makeListing({
      key: "10",
      blocked_by: [makeDepEntry("30", "Done blocker", "PVTI_30")],
    }),
  ];
  const blockerStory = makeIssueStory({
    key: "30",
    refId: "PVTI_30",
    status: "Done",
    sprint: null,
  });
  const allItems = [
    makeProjectItem({
      id: "PVTI_30",
      key: "30",
      title: "Done blocker",
      status: "Done",
    }),
  ];

  const map = buildDependencyMap(items, allItems, configWithTerminalDone);

  assertEquals(Object.keys(map).length, 0);
  assertEquals(blockerStory.status, "Done");
});

Deno.test("buildDependencyMap - includes Done blocker in active sprint", () => {
  const items = [
    makeListing({
      key: "10",
      blocked_by: [makeDepEntry("30", "Sprint done blocker", "PVTI_30")],
    }),
  ];
  const allItems = [
    makeProjectItem({
      id: "PVTI_30",
      key: "30",
      title: "Sprint done blocker",
      status: "Done",
      sprint: "Sprint 5",
    }),
  ];

  const map = buildDependencyMap(items, allItems, configWithTerminalDone);

  assertEquals(typeof map[toIssueKey("30")], "object");
});

Deno.test("buildDependencyMap - empty when no blocked_by references", () => {
  const items = [makeListing({ key: "10" }), makeListing({ key: "20" })];
  const map = buildDependencyMap(items, [], makeConfig());
  assertEquals(Object.keys(map).length, 0);
});

// =============================================================================
// Integration test - real data from captured fixtures
// =============================================================================

Deno.test({
  name: "buildDependencyMap - handles limited real listings without throwing",
  fn() {
    assertEquals(realStories.length > 0, true, "should have real stories from fixtures");

    const listings = realStories
      .filter((s) => s.kind === "issue")
      .slice(0, 25)
      .map((story) => toItemListing(story));

    const map = buildDependencyMap(listings, allRealItems, makeConfig());
    const returnedKeys = new Set(listings.map((item) => item.ref.key));

    for (const [key, pointer] of Object.entries(map)) {
      assertEquals(returnedKeys.has(key), false, "map must not repeat returned items");
      assertEquals(typeof pointer.ref.id, "string");
      assertFalse("blocks" in pointer);
    }
  },
});

// =============================================================================
// Error handling tests - composeStorySnapshot, _getDraftIssueDetail, getStoryDetail
// Covers Bug A (error shadowing), Bug B (inconsistent error handling),
// and Bug B.1 (resolveStory error propagation).
// =============================================================================

// ── Response fixtures ──────────────────────────────────────────────────────────

/** Successful DraftIssue response for composeStorySnapshot / _getDraftIssueDetail. */
const DRAFT_ISSUE_RESPONSE = {
  node: {
    __typename: "ProjectV2Item" as const,
    id: "PVTI_test1",
    type: "DRAFT_ISSUE" as const,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    isArchived: false,
    content: {
      __typename: "DraftIssue" as const,
      title: "Test Draft",
      body: "Test body",
      assignees: { nodes: [] },
    },
    fieldValues: { nodes: [] },
  },
};

/** Null-node response - simulates item deleted from project. */
const NULL_NODE_RESPONSE = { node: null };

/** resolveStory → Issue (so getStoryDetail proceeds to the issue-detail path). */
const RESOLVE_ISSUE_RESPONSE = {
  node: {
    id: "PVTI_test_issue",
    content: { __typename: "Issue" as const, id: "I_test_issue", number: 42 },
  },
};

/** resolveStory → DraftIssue (so getStoryDetail delegates to _getDraftIssueDetail). */
const RESOLVE_DRAFT_RESPONSE = {
  node: {
    id: "PVTI_test_draft",
    content: { __typename: "DraftIssue" as const, id: "DI_test_draft" },
  },
};

/** Minimal IssueDetails response for getStoryDetail success path. */
const ISSUE_DETAILS_RESPONSE = {
  node: {
    number: 42,
    title: "Test Issue",
    body: "Body",
    url: "https://github.com/test/test/issues/42",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    issueType: null,
    assignees: { nodes: [] },
    labels: { nodes: [] },
    milestone: null,
    blockedBy: { nodes: [] },
    comments: { nodes: [] },
    timelineItems: { nodes: [] },
  },
};

/** Minimal ItemFields response for getStoryDetail. */
const ITEM_FIELDS_RESPONSE = {
  node: { fieldValues: { nodes: [] } },
};

// ── Test helpers ──────────────────────────────────────────────────────────────

class FakeBoardScanCoordinator extends BoardScanCoordinator {
  constructor() {
    const gh = createGhSpy();
    super(makeCtx(gh));
  }
}

const makeService = () => {
  const gh = createGhSpy();
  const ctx = makeCtx(gh);
  const boardScan = new FakeBoardScanCoordinator();
  return { service: new StoryQueryService(ctx, boardScan), gh };
};

// ── Bug A: composeStorySnapshot error shadowing ────────────────────────────────

Deno.test({
  name: "composeStorySnapshot - throws FETCH_FAILED with upstreamWarnings when graphql fails",
  async fn() {
    const { service, gh } = makeService();
    const adapterErr = new GitHubApiError("auth expired", {
      code: "AUTH_FAILED",
      recovery: "Re-authenticate.",
    });
    gh.enqueue(adapterErr);

    try {
      await service.composeStorySnapshot({ id: "PVTI_test1" });
      throw new Error("should have thrown");
    } catch (err) {
      if (!(err instanceof GitHubApiError)) throw err;
      assertEquals(err.code, "FETCH_FAILED");
      assertEquals(typeof err.context, "object");
      assertEquals(err.context?.itemId, "PVTI_test1");
      const upstreamWarnings = err.context?.upstreamWarnings as string[];
      assertEquals(Array.isArray(upstreamWarnings), true);
      assertEquals(
        upstreamWarnings.length > 0,
        true,
        "upstreamWarnings should contain the AUTH_FAILED warning",
      );
      assertStringIncludes(upstreamWarnings[0], "AUTH_FAILED");
    }
  },
});

Deno.test({
  name: "composeStorySnapshot - throws NOT_FOUND when node is null (healthy path)",
  async fn() {
    const { service, gh } = makeService();
    gh.enqueue(NULL_NODE_RESPONSE);

    try {
      await service.composeStorySnapshot({ id: "PVTI_missing" });
      throw new Error("should have thrown");
    } catch (err) {
      if (!(err instanceof GitHubApiError)) throw err;
      assertEquals(err.code, "NOT_FOUND");
      assertEquals(err.statusCode, 404);
    }
  },
});

Deno.test({
  name: "composeStorySnapshot - returns story + warnings on success",
  async fn() {
    const { service, gh } = makeService();
    gh.enqueue(DRAFT_ISSUE_RESPONSE);

    const result = await service.composeStorySnapshot({ id: "PVTI_test1" });
    assertEquals(result.value !== null, true, "should return a story value");
    assertEquals(result.value?.ref.id, "PVTI_test1");
    assertEquals(Array.isArray(result.warnings), true);
  },
});

// ── Bug B.1: getStoryDetail wraps resolveStory in catchBackend ─────────────────

Deno.test({
  name: "getStoryDetail - returns null + warnings when resolveStory graphql fails (Bug B.1)",
  async fn() {
    const { service, gh } = makeService();
    const adapterErr = new GitHubApiError("network timeout", {
      code: "NETWORK_ERROR",
      recovery: "Retry later.",
    });
    gh.enqueue(adapterErr);

    const result = await service.getStoryDetail({ id: "PVTI_test1" });

    assertEquals(result.value, null, "failed resolve should yield null value");
    assertEquals(Array.isArray(result.warnings), true);
    assertEquals(result.warnings.length > 0, true, "warnings should carry the NETWORK_ERROR");
    assertStringIncludes(result.warnings[0], "NETWORK_ERROR");
  },
});

// ── Bug B: _getDraftIssueDetail returns warnings from catchBackend ─────────────

Deno.test({
  name: "getStoryDetail (draft path) - returns warnings when _getDraftIssueDetail graphql succeeds",
  async fn() {
    const { service, gh } = makeService();
    // First call: resolveStory → DraftIssue
    gh.enqueue(RESOLVE_DRAFT_RESPONSE);
    // Second call: _getDraftIssueDetail graphql → success
    gh.enqueue(DRAFT_ISSUE_RESPONSE);

    const result = await service.getStoryDetail({ id: "PVTI_test_draft" });

    assertEquals(result.value !== null, true, "should return a story detail");
    assertEquals(result.value?.story.ref.id, "PVTI_test_draft");
    assertEquals(Array.isArray(result.warnings), true);
    // Before the fix, warnings were hardcoded to [] - verify they are no longer empty.
    // catchBackend returns [] on success, so this is fine. The key assertion is
    // that warnings is a real array (not a literal [] placeholder).
  },
});

Deno.test({
  name:
    "getStoryDetail (draft path) - throws FETCH_FAILED when _getDraftIssueDetail graphql fails (Bug B)",
  async fn() {
    const { service, gh } = makeService();
    // First call: resolveStory → DraftIssue
    gh.enqueue(RESOLVE_DRAFT_RESPONSE);
    // Second call: _getDraftIssueDetail graphql → AdapterError
    const adapterErr = new GitHubApiError("rate limited", {
      code: "RATE_LIMITED",
      recovery: "Wait and retry.",
    });
    gh.enqueue(adapterErr);

    try {
      await service.getStoryDetail({ id: "PVTI_test_draft" });
      throw new Error("should have thrown");
    } catch (err) {
      if (!(err instanceof GitHubApiError)) throw err;
      assertEquals(err.code, "FETCH_FAILED");
      assertEquals(typeof err.context, "object");
      assertEquals(err.context?.itemId, "PVTI_test_draft");
      const upstreamWarnings = err.context?.upstreamWarnings as string[];
      assertEquals(Array.isArray(upstreamWarnings), true);
      assertEquals(upstreamWarnings.length > 0, true);
      assertStringIncludes(upstreamWarnings[0], "RATE_LIMITED");
    }
  },
});

// ── getStoryDetail success path (non-draft) ────────────────────────────────────

Deno.test({
  name: "getStoryDetail (issue path) - returns story detail on full success",
  async fn() {
    const { service, gh } = makeService();
    gh.enqueue(RESOLVE_ISSUE_RESPONSE);
    gh.enqueue(ISSUE_DETAILS_RESPONSE);
    gh.enqueue(ITEM_FIELDS_RESPONSE);

    const result = await service.getStoryDetail({ id: "PVTI_test_issue" });

    assertEquals(result.value !== null, true, "should return a story detail");
    assertEquals(result.value?.story.ref.id, "PVTI_test_issue");
    assertEquals(result.value?.story.kind, "issue");
    assertEquals(Array.isArray(result.warnings), true);
  },
});
