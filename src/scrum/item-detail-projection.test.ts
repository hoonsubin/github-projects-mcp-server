// =============================================================================
// src/scrum/item-detail-projection.test.ts
// =============================================================================

import { assertEquals, assertMatch } from "@std/assert";
import { projectItemDetailForAgent } from "./item-detail-projection.ts";
import type { ItemDetailResult } from "../domain/types.ts";

const baseDetail = (): ItemDetailResult => ({
  story: {
    kind: "issue",
    ref: { id: "PVTI_1" },
    key: "1",
    title: "Test",
    body: "x".repeat(2000),
    type: "bug",
    status: "Ready",
    sprint: "Sprint 1",
    story_points: 2,
    priority: "Must",
    assignees: [],
    labels: [],
    epic: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    url: null,
    blocked_by: [],
  },
  comments: [
    {
      author: "alice",
      body: "y".repeat(1000),
      created_at: "2026-01-01T00:00:00Z",
      url: "https://example.com/c1",
    },
    {
      author: "bob",
      body: "latest comment",
      created_at: "2026-01-02T00:00:00Z",
      url: "https://example.com/c2",
    },
  ],
  linked_artifacts: null,
  acceptance_criteria: ["AC1"],
});

Deno.test("projectItemDetailForAgent - dor tier truncates body and keeps latest comment", () => {
  const projected = projectItemDetailForAgent(baseDetail(), "dor");
  assertMatch(projected.story.body, /…$/);
  assertEquals(projected.comments?.length, 1);
  assertEquals(projected.comments?.[0]?.author, "bob");
  assertEquals(projected.acceptance_criteria.length, 1);
});
