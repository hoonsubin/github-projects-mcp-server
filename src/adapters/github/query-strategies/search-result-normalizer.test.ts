// =============================================================================
// src/adapters/github/search-result-normalizer.test.ts
// =============================================================================

import { assertEquals } from "@std/assert";
import { searchIssuesToProjectItems } from "./search-result-normalizer.ts";
import type { SearchIssueNode } from "./search-result-normalizer.ts";

Deno.test("searchIssuesToProjectItems - keeps issues in configured project only", () => {
  const nodes: SearchIssueNode[] = [{
    id: "I_1",
    number: 42,
    title: "Test",
    body: "",
    url: "https://github.com/o/r/issues/42",
    state: "OPEN",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    assignees: { nodes: [{ login: "dev" }] },
    labels: { nodes: [{ name: "bug" }] },
    repository: { name: "r", nameWithOwner: "o/r" },
    projectItems: {
      nodes: [
        {
          project: { id: "PVT_other", number: 99 },
          id: "PVTI_wrong",
          type: "ISSUE",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
          isArchived: false,
          fieldValues: { nodes: [] },
        },
        {
          project: { id: "PVT_target", number: 6 },
          id: "PVTI_match",
          type: "ISSUE",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
          isArchived: false,
          fieldValues: { nodes: [] },
        },
      ],
    },
  }];

  const items = searchIssuesToProjectItems(nodes, 6);
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "PVTI_match");
  assertEquals(items[0].content?.__typename, "Issue");
  if (items[0].content?.__typename === "Issue") {
    assertEquals(items[0].content.number, 42);
  }
});

Deno.test("searchIssuesToProjectItems - excludes issues with no project membership", () => {
  const nodes: SearchIssueNode[] = [{
    id: "I_2",
    number: 7,
    title: "Orphan",
    body: "",
    url: null,
    state: "OPEN",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    projectItems: { nodes: [] },
  }];

  assertEquals(searchIssuesToProjectItems(nodes, 6).length, 0);
});
