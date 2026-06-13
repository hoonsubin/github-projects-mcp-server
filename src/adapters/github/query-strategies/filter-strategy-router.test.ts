// =============================================================================
// src/adapters/github/filter-strategy-router.test.ts
//
// Gate C - routing determinism: every filter shape resolves to exactly one profile.
// =============================================================================

import { assertEquals } from "@std/assert";
import { classifyFilter } from "./filter-strategy-router.ts";
import type { ResolvedItemFilter } from "../../../scrum/ports.ts";

const baseFilter = (): ResolvedItemFilter => ({
  scope: "all",
  keys: [],
  search: "",
  types: [],
  statuses: [],
  priority: "",
  epic_id: "",
  labels: [],
  assignee: "",
  estimated: undefined,
  has_blockers: undefined,
  sprint_ref: null,
  include_dependencies: false,
  fields: "full" as const,
  limit: 50,
});

Deno.test("classifyFilter - keys present → direct_lookup", () => {
  const profile = classifyFilter({ ...baseFilter(), keys: ["42", "99"] });
  assertEquals(profile.kind, "direct_lookup");
  if (profile.kind === "direct_lookup") {
    assertEquals(profile.keys, ["42", "99"]);
  }
});

// scope=sprint and scope=backlog always route to project_items so that
// board-field data (iteration IDs, terminal status) is available for filtering.
// search_api is only reachable when scope=all (no sprint/backlog semantics needed).

Deno.test("classifyFilter - search only, scope=all → project_items (draft parity)", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    scope: "all",
    search: "auth",
  });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - labels only, scope=all → project_items (draft parity)", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    scope: "all",
    labels: ["bug"],
  });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - assignee only, scope=all → project_items (draft parity)", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    scope: "all",
    assignee: "octocat",
  });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - scope=all with search → project_items (draft parity)", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    scope: "all",
    search: "refactor",
  });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - status only → project_items", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    statuses: ["In Progress"],
  });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - sprint_ref only → project_items", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    sprint_ref: "current",
  });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - type + priority → project_items", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    types: ["feature"],
    priority: "Must",
  });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - search + status → mixed", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    search: "login",
    statuses: ["Done"],
  });
  assertEquals(profile.kind, "mixed");
});

Deno.test("classifyFilter - labels + sprint_ref → mixed", () => {
  const profile = classifyFilter({
    ...baseFilter(),
    labels: ["enhancement"],
    sprint_ref: "next",
  });
  assertEquals(profile.kind, "mixed");
});

Deno.test("classifyFilter - empty filter + scope=all → project_items", () => {
  const profile = classifyFilter(baseFilter());
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - empty filter + scope=sprint → project_items", () => {
  const profile = classifyFilter({ ...baseFilter(), scope: "sprint" });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - empty filter + scope=backlog → project_items", () => {
  const profile = classifyFilter({ ...baseFilter(), scope: "backlog" });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - scope=sprint + search → project_items (board scan, in-memory text match)", () => {
  const profile = classifyFilter({ ...baseFilter(), scope: "sprint", search: "auth" });
  assertEquals(profile.kind, "project_items");
});

Deno.test("classifyFilter - scope=backlog + labels → project_items (board scan, in-memory label match)", () => {
  const profile = classifyFilter({ ...baseFilter(), scope: "backlog", labels: ["bug"] });
  assertEquals(profile.kind, "project_items");
});
