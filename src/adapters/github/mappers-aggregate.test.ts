import { assertEquals } from "@std/assert";
import {
  aggregateToBurndownInput,
  buildAggregateFromRaw,
  sprintCompletionFromAggregates,
} from "./mappers.ts";
import type { GitHubBootState } from "./bootstrap.ts";
import type { ProjectItem } from "./types.ts";

const config = {
  scrumConfig: {
    scrum: {
      status: {
        done: { terminal: true },
        todo: { terminal: false },
      },
    },
  },
  ghConfig: {
    status_display: { done: "Done", todo: "Todo" },
    type_mapping: {},
  },
  live: {
    typeResolution: { source: "board_field", fieldId: "TYPE_F" },
    fields: {
      sprintFieldId: "SPRINT_F",
      statusFieldId: "STATUS_F",
      storyPointsFieldId: "PTS_F",
      priorityFieldId: null,
    },
  },
} as unknown as GitHubBootState;

const issueItem = {
  id: "PVTI_1",
  isArchived: false,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-02",
  content: {
    __typename: "Issue",
    number: 42,
    title: "Hello",
    assignees: { nodes: [{ login: "alice" }] },
    blockedBy: { nodes: [{ id: "I_block", number: 1, title: "Blocker" }] },
  },
  fieldValues: {
    nodes: [
      {
        field: { id: "SPRINT_F" },
        iterationId: "iter-1",
        title: "Sprint 1",
      },
      {
        field: { id: "STATUS_F" },
        name: "Done",
      },
      {
        field: { id: "PTS_F" },
        number: 5,
      },
    ],
  },
} as unknown as ProjectItem;

Deno.test("buildAggregateFromRaw - maps sprint iteration and issue identity", () => {
  const agg = buildAggregateFromRaw(issueItem, config);
  assertEquals(agg.sprintId, "iter-1");
  assertEquals(agg.sprintTitle, "Sprint 1");
  assertEquals(agg.issueNumber, 42);
  assertEquals(agg.hasBlockers, true);
  assertEquals(agg.hasAssignee, true);
});

Deno.test("aggregateToBurndownInput - projects burndown row", () => {
  const agg = buildAggregateFromRaw(issueItem, config);
  assertEquals(aggregateToBurndownInput(agg), {
    number: 42,
    title: "Hello",
    points: 5,
    status: "Done",
  });
});

Deno.test("sprintCompletionFromAggregates - sums terminal status points", () => {
  const agg = buildAggregateFromRaw(issueItem, config);
  const result = sprintCompletionFromAggregates([agg], "iter-1", config);
  assertEquals(result, { completed: 5, total: 5 });
});
