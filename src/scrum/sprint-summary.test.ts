// =============================================================================
// src/scrum/sprint-summary.test.ts
// =============================================================================

import { assertEquals } from "@std/assert";
import type { SprintRawItem } from "./ports.ts";
import { buildSprintSummary, filterSprintItems } from "./sprint-summary.ts";

const item = (
  overrides: Partial<SprintRawItem> & Pick<SprintRawItem, "id" | "title">,
): SprintRawItem => ({
  number: 1,
  type: "bug",
  status: "Ready",
  story_points: 2,
  has_assignee: true,
  has_blockers: false,
  completed_at: null,
  ...overrides,
});

Deno.test("buildSprintSummary - counts active vs done", () => {
  const terminal = new Set(["Done"]);
  const items = [
    item({ id: "1", title: "a", status: "Ready", story_points: 3 }),
    item({ id: "2", title: "b", status: "Done", story_points: 5, has_blockers: true }),
  ];
  const summary = buildSprintSummary(items, terminal);
  assertEquals(summary.committed_count, 2);
  assertEquals(summary.active_count, 1);
  assertEquals(summary.done_count, 1);
  assertEquals(summary.committed_points, 8);
  assertEquals(summary.remaining_points, 3);
  assertEquals(summary.blocked_count, 1);
});

Deno.test("filterSprintItems - active_only excludes terminal", () => {
  const terminal = new Set(["Done"]);
  const items = [
    item({ id: "1", title: "a", status: "Ready" }),
    item({ id: "2", title: "b", status: "Done" }),
  ];
  const filtered = filterSprintItems(items, terminal, true);
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0]?.status, "Ready");
});
