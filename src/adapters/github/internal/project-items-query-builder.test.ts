// Query builder profile selection for board scans.

import { assertStringIncludes } from "@std/assert";
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
