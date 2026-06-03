// Query builder profile selection for board scans.

import { assert, assertStringIncludes } from "@std/assert";
import { ProjectItemsQueryBuilder } from "./project-items-query-builder.ts";

Deno.test("ProjectItemsQueryBuilder - full query uses ItemContent fragment", () => {
  const query = new ProjectItemsQueryBuilder("user").buildQuery();
  assertStringIncludes(query, "...ItemContent");
  assertStringIncludes(query, "fragment ItemContent on ProjectV2Item");
  assertStringIncludes(query, "blockedBy(first:");
});

Deno.test("ProjectItemsQueryBuilder - aggregate query uses ItemContentAggregate", () => {
  const query = new ProjectItemsQueryBuilder("user").buildAggregateQuery();
  assertStringIncludes(query, "...ItemContentAggregate");
  assertStringIncludes(query, "fragment ItemContentAggregate on ProjectV2Item");
  assertStringIncludes(query, "...ItemFieldValues");
  if (query.includes("blockedBy(first:")) {
    throw new Error("aggregate query must not fetch blockedBy");
  }
});

Deno.test("ProjectItemsQueryBuilder - all queries use first: 50 page size", () => {
  const builder = new ProjectItemsQueryBuilder("org");
  for (const q of [builder.buildQuery(), builder.buildAggregateQuery()]) {
    assertStringIncludes(q, "first: 50");
    assert(!q.includes("first: 100"), "page size must not be 100");
  }
});

Deno.test("ProjectItemsQueryBuilder - no server-side query filter (all filtering is client-side)", () => {
  // GitHub Projects v2 query: arg has unreliable behavior across board configurations.
  // Sprint/iteration filtering is not supported server-side; is:unarchived was found to
  // drop all items on some live boards. All filtering stays client-side.
  const builder = new ProjectItemsQueryBuilder("user");
  for (const q of [builder.buildQuery(), builder.buildAggregateQuery()]) {
    assert(!q.includes(`query:`), "queries must not include a query: filter argument");
  }
});
