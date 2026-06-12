// =============================================================================
// src/scrum/orient-tier.test.ts
// =============================================================================

import { assertEquals, assertMatch } from "@std/assert";
import { applyOrientDetail } from "./orient-tier.ts";
import type { OrientResult } from "../domain/types.ts";

const longDescription = "x".repeat(500);

const baseOrient = (): OrientResult => ({
  warnings: [],
  platform_state: {
    deadline_field: null,
    fields: {
      status: { exists: true, options: [], missing_options: [] },
      sprint: { exists: true },
      story_points: { exists: true },
      priority: { exists: true, options: [], missing_options: [] },
      type_field: { exists: true, configured: true },
    },
    missing_options: [],
    labels: { existing: [], expected: [], missing: [] },
    iterations: {
      active: null,
      next: null,
      completed_count: 0,
    },
    epics: {
      active: [
        {
          ref: { id: "E1" },
          name: "Epic 1",
          description: longDescription,
          status: null,
          open_item_count: 1,
        },
        {
          ref: { id: "E2" },
          name: "Epic 2",
          description: "short",
          status: null,
          open_item_count: 0,
        },
      ],
      total_count: 2,
    },
    template_uris: { feature: "scrum://template/feature" },
  },
  vocabulary: {
    status: {},
    priority: {},
    type: {},
    story_points: { scale: null, values: null },
    sprint: { duration_days: null, velocity_window: 3, length_weeks: null },
    team: [{ name: "Alice", role: "developer" }],
    dor: ["AC defined"],
    dod: ["Tests pass"],
    autonomy: { require_confirmation_above_n_items: 5 },
  },
});

Deno.test("applyOrientDetail - truncates epic descriptions in full tier", () => {
  const result = applyOrientDetail(baseOrient(), "full");
  assertEquals(result.platform_state.epics.active.length, 2);
  const epic = result.platform_state.epics.active[0]!;
  assertMatch(epic.description!, /…$/);
  assertEquals(epic.description!.length, 201);
});

Deno.test("applyOrientDetail - session caps epics and strips vocabulary", () => {
  const manyEpics = {
    ...baseOrient(),
    platform_state: {
      ...baseOrient().platform_state,
      epics: {
        active: Array.from({ length: 8 }, (_, i) => ({
          ref: { id: `E${i}` },
          name: `Epic ${i}`,
          description: "d",
          status: null,
          open_item_count: 0,
        })),
        total_count: 8,
      },
    },
  };
  const result = applyOrientDetail(manyEpics, "session");
  assertEquals(result.platform_state.epics.active.length, 5);
  assertEquals(result.vocabulary.team, null);
  assertEquals(result.platform_state.template_uris, null);
});
