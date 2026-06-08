// =============================================================================
// src/adapters/github/internal/search-query-builder.test.ts
// =============================================================================

import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildSearchQueryString } from "./search-query-builder.ts";
import type { GitHubBackendConfig } from "../../types.ts";

const ghConfig: GitHubBackendConfig = {
  auth: { token: "ghp_test" as never },
  owner: "acme",
  owner_type: "org",
  project_number: 1,
  tracked_repos: ["frontend", "backend"],
  type_mapping: {},
  field_mapping: { sprint: "Sprint", status: "Status" },
  status_display: {},
  priority_display: {},
};

Deno.test("buildSearchQueryString - scopes to tracked repos", () => {
  const q = buildSearchQueryString({ search: "auth" }, ghConfig);
  assertStringIncludes(q, "repo:acme/frontend");
  assertStringIncludes(q, "repo:acme/backend");
  assertStringIncludes(q, "is:issue");
  assertStringIncludes(q, "auth in:title,body");
});

Deno.test("buildSearchQueryString - does not force is:open", () => {
  const q = buildSearchQueryString({ search: "" }, ghConfig);
  assertEquals(q.includes("is:open"), false);
});

Deno.test("buildSearchQueryString - label AND assignee", () => {
  const q = buildSearchQueryString(
    { search: "", labels: ["bug"], assignee: "octocat" },
    ghConfig,
  );
  assertStringIncludes(q, 'label:"bug"');
  assertStringIncludes(q, "assignee:octocat");
});
