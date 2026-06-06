// =============================================================================
// src/adapters/github/internal/pagination.test.ts
//
// Tests for PaginatedProjectItemFetcher and isBacklogItem.
//
// Group A — Fixture-based tests (real API response shapes)
//   Fixture data is captured from the live GitHub API via `deno task capture-fixtures`.
//   These tests catch two categories of runtime error that unit-only tests miss:
//     1. Silent empty-return bugs (collect() returns [] without throwing)
//     2. GraphQL schema drift (field selections that GitHub silently drops or errors)
//
// Group B — Predicate + backlog filtering
//
// Group C — Synthetic edge cases (empty project, not-found, org owner)
// =============================================================================

import { assert, assertEquals, assertRejects } from "@std/assert";
import { isBacklogItem, PaginatedProjectItemFetcher } from "./pagination.ts";
import { ProjectItemsQueryBuilder } from "./project-items-query-builder.ts";
import { createGhSpy, makeCtx } from "./_test_utils.ts";
import { GitHubApiError } from "../errors.ts";

// ── Fixture imports ───────────────────────────────────────────────────────────
// JSON captured from the live API via `deno task capture-fixtures`.
// Re-run that task after schema changes or when the project board changes significantly.

import { FIXTURE_PAGE_1, FIXTURE_PAGE_2 } from "./_test_fixtures.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Derived counts from the consolidated fixture module so tests stay valid.
const P1_NODES = FIXTURE_PAGE_1.user.projectV2.items.nodes;
const P2_NODES = FIXTURE_PAGE_2.user.projectV2.items.nodes;
const FIXTURE_TOTAL = P1_NODES.length + P2_NODES.length;

// Pre-built queries matching the fixture owner types.
const USER_QUERY = new ProjectItemsQueryBuilder("user").buildQuery();
const ORG_QUERY = new ProjectItemsQueryBuilder("org").buildQuery();

// ── Synthetic response builders ───────────────────────────────────────────────

const makeEmptyPage = (ownerType: "user" | "org" = "user") => {
  const page = {
    totalCount: 0,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [],
  };
  return ownerType === "user"
    ? { user: { projectV2: { id: "PVT_test", items: page } } }
    : { organization: { projectV2: { id: "PVT_test", items: page } } };
};

const makeNotFoundPage = (ownerType: "user" | "org" = "user") => {
  return ownerType === "user" ? { user: null } : { organization: null };
};

// ═══════════════════════════════════════════════════════════════════════════════
// Group A — Fixture-based tests
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "collect() - returns all items across two fixture pages",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    const items = await fetcher.collect(() => true);

    assertEquals(items.length, FIXTURE_TOTAL);
    assertEquals(gh.graphqlCalls.length, 2);
  },
});

Deno.test({
  name: "collect() - items are non-empty (regression: collect() previously returned [])",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    const items = await fetcher.collect(() => true);

    // The core regression: before the fix, this was always 0.
    assert(items.length > 0, `Expected items, got 0 — fetchFirstPage() was not called`);
  },
});

Deno.test({
  name: "collect() - every item has a non-empty id",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    const items = await fetcher.collect(() => true);

    for (const item of items) {
      assert(item.id.length > 0, `Item missing id: ${JSON.stringify(item)}`);
    }
  },
});

Deno.test({
  name:
    "collect() - field values contain accessible field.id (regression: GraphQL union selection)",
  async fn() {
    // This test catches the query bug where `field { id name }` was placed directly
    // on the ProjectV2ItemFieldValue union. GitHub silently dropped the field selection,
    // making every fieldValue.field undefined. The fix uses `... on ProjectV2FieldCommon`.
    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    const items = await fetcher.collect(() => true);

    const itemsWithFields = items.filter((item) => item.fieldValues.nodes.length > 0);
    assert(itemsWithFields.length > 0, "Expected at least one item with field values");

    for (const item of itemsWithFields) {
      for (const fv of item.fieldValues.nodes) {
        if (fv.field !== undefined) {
          assert(
            typeof fv.field.id === "string" && fv.field.id.length > 0,
            `field.id missing or empty on fieldValue __typename=${fv.__typename} itemId=${item.id}`,
          );
        }
      }
    }

    // At least one fieldValue must have a resolved field.id — if this is 0 the
    // union selection is broken and items would silently have no field metadata.
    const resolvedFieldCount = itemsWithFields
      .flatMap((item) => item.fieldValues.nodes)
      .filter((fv) => fv.field?.id).length;

    assert(
      resolvedFieldCount > 0,
      `No fieldValues had a resolved field.id — GraphQL union fragment may be broken`,
    );
  },
});

Deno.test({
  name: "collect() - first page is fetched lazily on first call (not in constructor)",
  async fn() {
    // Confirms the lazy-init guard: graphql must not be called until collect() runs.
    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    assertEquals(gh.graphqlCalls.length, 0, "No calls should happen in constructor");

    await fetcher.collect(() => true);
    assert(gh.graphqlCalls.length > 0, "collect() must trigger at least one graphql call");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group B — Predicate filtering and isBacklogItem
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "collect() - predicate limits returned items without skipping pages",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    // Filter for items with "feature" label via field values — excludes DONE item (bug only)
    const filtered = await fetcher.collect(
      (item) =>
        item.fieldValues.nodes.some(
          (fv) => fv.labels?.nodes?.some((l) => l?.name === "feature") ?? false,
        ),
    );

    assert(filtered.length > 0, "Expected at least one adapter-layer item");
    assert(
      filtered.length < FIXTURE_TOTAL,
      `Predicate should have excluded non-adapter-layer items; got ${filtered.length} of ${FIXTURE_TOTAL}`,
    );
    // Both pages must still be fetched — predicate must not short-circuit pagination.
    assertEquals(gh.graphqlCalls.length, 2);
  },
});

Deno.test({
  name: "collect() - predicate returning false for all items yields []",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    const none = await fetcher.collect(() => false);

    assertEquals(none.length, 0);
    assertEquals(gh.graphqlCalls.length, 2); // both pages still fetched
  },
});

Deno.test({
  name: "isBacklogItem() - returns false for items with a sprint field value",
  fn() {
    const sprintFieldId = "PVTF_sprint";
    const itemWithSprint = {
      id: "PVTI_1",
      fieldValues: {
        nodes: [
          { field: { id: sprintFieldId }, iterationId: "IT_abc" },
        ],
      },
    };
    // deno-lint-ignore no-explicit-any
    assertEquals(isBacklogItem(itemWithSprint as any, sprintFieldId), false);
  },
});

Deno.test({
  name: "isBacklogItem() - returns true for items missing sprint field entirely",
  fn() {
    const sprintFieldId = "PVTF_sprint";
    const itemWithoutSprint = {
      id: "PVTI_2",
      fieldValues: { nodes: [] },
    };
    // deno-lint-ignore no-explicit-any
    assertEquals(isBacklogItem(itemWithoutSprint as any, sprintFieldId), true);
  },
});

Deno.test({
  name: "isBacklogItem() - returns true when sprint field present but iterationId is null",
  fn() {
    const sprintFieldId = "PVTF_sprint";
    const itemWithNullIteration = {
      id: "PVTI_3",
      fieldValues: {
        nodes: [
          { field: { id: sprintFieldId }, iterationId: null },
        ],
      },
    };
    // deno-lint-ignore no-explicit-any
    assertEquals(isBacklogItem(itemWithNullIteration as any, sprintFieldId), true);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group C — Synthetic edge cases
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "collect() - returns [] on project with zero items",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(makeEmptyPage("user"));

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    const items = await fetcher.collect(() => true);

    assertEquals(items.length, 0);
    assertEquals(gh.graphqlCalls.length, 1);
  },
});

Deno.test({
  name: "collect() - throws GitHubApiError when project is not found",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(makeNotFoundPage("user"));

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    await assertRejects(
      () => fetcher.collect(() => true),
      GitHubApiError,
    );
  },
});

Deno.test({
  name: "collect() - uses organization key for org-owned projects",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(makeEmptyPage("org"));

    const fetcher = new PaginatedProjectItemFetcher(makeCtx(gh), ORG_QUERY);
    const items = await fetcher.collect(() => true);

    assertEquals(items.length, 0);
  },
});

Deno.test({
  name: "collect() - single page project makes exactly one graphql call",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(makeEmptyPage("user"));

    const fetcher = new PaginatedProjectItemFetcher(
      makeCtx(gh, { ghConfig: { owner_type: "user" as const } }),
      USER_QUERY,
    );
    await fetcher.collect(() => true);

    assertEquals(gh.graphqlCalls.length, 1);
  },
});
