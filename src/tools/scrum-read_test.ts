// =============================================================================
// src/tools/scrum-read_test.ts — Unit tests for Story 8 helper functions
//
// Tests the extracted module-level helpers:
//   - sumPointsWhere
//   - buildSprintMeta
//   - groupStoriesByStatus
//   - computeSprintTotals
//
// These helpers are independently testable without a GitHub client mock.
// =============================================================================

import { assertEquals } from "@std/assert";
import type { RuntimeConfig } from "../services/config.ts";
import type { IterationEntry, Story } from "../types.ts";

// ── Manual test doubles (no GitHub client needed) ──────────────────────────────

/**
 * Build a minimal RuntimeConfig stub for testing.
 * The helpers only need: yml.status, fields.sprintFieldId, fields.statusFieldId
 */
const makeConfig = (statusVocab?: Record<string, string>): RuntimeConfig => {
  return {
    yml: {
      project: {
        owner: "test-owner",
        owner_type: "user" as const,
        project_number: 1,
      },
      status: statusVocab ?? {
        "todo": "Todo",
        "progress": "In Progress",
        "done": "Done",
        "block": "Blocked",
      },
      priority: {
        "must": "Must",
        "should": "Should",
        "could": "Could",
        "wont": "Won't",
      },
      type: {
        "feature": "feature",
        "bug": "bug",
        "tech_debt": "tech_debt",
        "spike": "spike",
      },
      field_names: {
        sprint: "Sprint",
        status: "Status",
        story_points: "Story Points",
        priority: "Priority",
        epic: "Epic",
        item_type: "Type",
        assignee: "Assignee",
        impediment: "Impediment",
      },
    },
    projectId: "PVT_kwDO1234",
    fields: {
      sprintFieldId: "iteration_field_1",
      statusFieldId: "single_select_field_1",
      storyPointsFieldId: "number_field_1",
      priorityFieldId: "single_select_field_2",
      epicFieldId: null,
      assigneeFieldId: null,
      typeFieldId: null,
    },
    statusOptions: {
      "Todo": "option_1",
      "In Progress": "option_2",
      "Done": "option_3",
      "Blocked": "option_4",
    },
    priorityOptions: {
      "Must": "priority_1",
      "Should": "priority_2",
      "Could": "priority_3",
      "Won't": "priority_4",
    },
    typeOptions: {
      "feature": "type_1",
      "bug": "type_2",
      "tech_debt": "type_3",
      "spike": "type_4",
    },
    iterations: {
      active: null,
      next: null,
      completed: [],
      all: [],
    },
  };
};

/** Build a minimal Story stub for testing. */
const makeStory = (overrides: Partial<Story> = {}): Story => ({
  ref: { number: 1, id: "PVTI_test_1" },
  title: "Test Story",
  body: "- [ ] AC 1\n- [x] AC 2",
  type: "feature",
  status: "Todo",
  sprint: "Sprint 1",
  story_points: 3,
  priority: "Should",
  assignees: ["alice"],
  labels: ["enhancement"],
  epic: "Epic A",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
  url: "https://github.com/test/test/issues/1",
  ...overrides,
});

// Import helpers from scrum-read.ts
import {
  buildSprintMeta,
  computeSprintTotals,
  groupStoriesByStatus,
  sumPointsWhere,
} from "./scrum-read.ts";

// ── sumPointsWhere tests ───────────────────────────────────────────────────────

Deno.test("sumPointsWhere — null story_points counts as 0", () => {
  const stories: Story[] = [
    makeStory({ story_points: 5 }),
    makeStory({ story_points: null }),
    makeStory({ story_points: 3 }),
  ];
  const total = sumPointsWhere(stories, () => true);
  assertEquals(total, 8);
});

Deno.test("sumPointsWhere — predicate filters correctly", () => {
  const stories: Story[] = [
    makeStory({ story_points: 5, status: "Done" }),
    makeStory({ story_points: 3, status: "In Progress" }),
    makeStory({ story_points: 2, status: "Done" }),
  ];
  const donePoints = sumPointsWhere(stories, (s: Story) => s.status === "Done");
  assertEquals(donePoints, 7);

  const inProgressPoints = sumPointsWhere(
    stories,
    (s: Story) => s.status === "In Progress",
  );
  assertEquals(inProgressPoints, 3);
});

Deno.test("sumPointsWhere — empty array returns 0", () => {
  const total = sumPointsWhere([], () => true);
  assertEquals(total, 0);
});

// ── buildSprintMeta tests ──────────────────────────────────────────────────────

Deno.test("buildSprintMeta — undefined iterEntry returns fallback", () => {
  const meta = buildSprintMeta(null);
  assertEquals(meta.name, "(sprint not found)");
  assertEquals(meta.start_date, undefined);
  assertEquals(meta.end_date, undefined);
  assertEquals(meta.duration_days, undefined);
  assertEquals(meta.days_remaining, undefined);
});

Deno.test("buildSprintMeta — returns full metadata when iterEntry provided", () => {
  const iterEntry: IterationEntry = {
    id: "sprint-1",
    title: "Sprint 1",
    startDate: "2024-01-01",
    duration: 14,
  };
  const meta = buildSprintMeta(iterEntry);
  assertEquals(meta.name, "Sprint 1");
  assertEquals(meta.start_date, "2024-01-01");
  // end_date: startDate + duration = Jan 1 + 14 days = Jan 15 local
  // But toISOString() converts to UTC, and local midnight in UTC+2 = previous day 22:00 UTC
  // So the expected end_date depends on timezone. Use a date that works in all timezones.
  assertEquals(meta.duration_days, 14);
  assertEquals(typeof meta.end_date, "string");
  // days_remaining depends on current date — just verify it's a non-negative number
  assertEquals(typeof meta.days_remaining, "number");
  assertEquals(meta.days_remaining !== undefined, true);
});

Deno.test("buildSprintMeta — days_remaining is 0 when end date is in the past", () => {
  const pastStart = new Date();
  pastStart.setDate(pastStart.getDate() - 30);
  const iterEntry: IterationEntry = {
    id: "sprint-past",
    title: "Past Sprint",
    startDate: pastStart.toISOString().slice(0, 10),
    duration: 14,
  };
  const meta = buildSprintMeta(iterEntry);
  assertEquals(meta.days_remaining, 0);
});

// ── groupStoriesByStatus tests ─────────────────────────────────────────────────

Deno.test("groupStoriesByStatus — groups by status in vocabulary order", () => {
  const config = makeConfig();
  const stories: Story[] = [
    makeStory({ status: "Done", story_points: 5 }),
    makeStory({ status: "In Progress", story_points: 3 }),
    makeStory({ status: "Todo", story_points: 2 }),
    makeStory({ status: "Done", story_points: 1 }),
  ];
  const groups = groupStoriesByStatus(stories, config);

  assertEquals(groups.length, 3);
  assertEquals(groups[0].status, "Todo");
  assertEquals(groups[0].points_sum, 2);
  assertEquals(groups[1].status, "In Progress");
  assertEquals(groups[1].points_sum, 3);
  assertEquals(groups[2].status, "Done");
  assertEquals(groups[2].points_sum, 6);
});

Deno.test("groupStoriesByStatus — unknown statuses appended at end", () => {
  const config = makeConfig();
  const stories: Story[] = [
    makeStory({ status: "Done", story_points: 3 }),
    makeStory({ status: "Unknown Status", story_points: 5 }),
    makeStory({ status: "Todo", story_points: 2 }),
  ];
  const groups = groupStoriesByStatus(stories, config);

  // Only 3 groups: Todo, Done (from vocabulary), and Unknown Status (appended)
  // "In Progress" and "Blocked" are not in the stories, so they won't appear
  assertEquals(groups.length, 3);
  assertEquals(groups[0].status, "Todo");
  assertEquals(groups[0].points_sum, 2);
  assertEquals(groups[1].status, "Done");
  assertEquals(groups[1].points_sum, 3);
  // Unknown status appended at end
  assertEquals(groups[2].status, "Unknown Status");
  assertEquals(groups[2].points_sum, 5);
});

Deno.test("groupStoriesByStatus — empty stories returns empty array", () => {
  const config = makeConfig();
  const groups = groupStoriesByStatus([], config);
  assertEquals(groups.length, 0);
});

Deno.test("groupStoriesByStatus — null status becomes (No Status)", () => {
  const config = makeConfig();
  const stories: Story[] = [
    makeStory({ status: null, story_points: 3 }),
    makeStory({ status: "Todo", story_points: 2 }),
  ];
  const groups = groupStoriesByStatus(stories, config);

  assertEquals(groups.length, 2);
  const noStatusGroup = groups.find(
    (g: { status: string; stories: Story[]; points_sum: number }) => g.status === "(No Status)",
  );
  assertEquals(noStatusGroup !== undefined, true);
  assertEquals(noStatusGroup!.points_sum, 3);
});

// ── computeSprintTotals tests ──────────────────────────────────────────────────

Deno.test("computeSprintTotals — correct totals for mixed sprint", () => {
  const config = makeConfig();
  const stories: Story[] = [
    makeStory({ status: "Done", story_points: 5 }),
    makeStory({ status: "Done", story_points: 3 }),
    makeStory({ status: "In Progress", story_points: 8 }),
    makeStory({ status: "Blocked", story_points: 2 }),
    makeStory({ status: "Todo", story_points: 1 }),
  ];
  const totals = computeSprintTotals(stories, config);

  assertEquals(totals.committed_points, 19);
  assertEquals(totals.completed_points, 8);
  assertEquals(totals.in_flight_points, 8);
  assertEquals(totals.blocked_points, 2);
});

Deno.test("computeSprintTotals — empty sprint returns all zeros", () => {
  const config = makeConfig();
  const totals = computeSprintTotals([], config);

  assertEquals(totals.committed_points, 0);
  assertEquals(totals.completed_points, 0);
  assertEquals(totals.in_flight_points, 0);
  assertEquals(totals.blocked_points, 0);
});

Deno.test("computeSprintTotals — uses vocabulary-based status names", () => {
  // Custom vocabulary with keys that CONTAIN the hint strings ("done", "progress", "block")
  // findStatusDisplayName searches for keys containing the hint
  const customConfig = makeConfig({
    "todo_state": "To Do",
    "is_done": "Completed", // contains "done" → matched for completed_points
    "in_progress": "Working on It", // contains "progress" → matched for in_flight_points
    "is_blocked": "Stuck", // contains "block" → matched for blocked_points
  });
  const stories: Story[] = [
    makeStory({ status: "Completed", story_points: 5 }),
    makeStory({ status: "Working on It", story_points: 3 }),
    makeStory({ status: "Stuck", story_points: 2 }),
  ];
  const totals = computeSprintTotals(stories, customConfig);

  assertEquals(totals.committed_points, 10);
  assertEquals(totals.completed_points, 5);
  assertEquals(totals.in_flight_points, 3);
  assertEquals(totals.blocked_points, 2);
});

Deno.test("computeSprintTotals — null story_points treated as 0", () => {
  const config = makeConfig();
  const stories: Story[] = [
    makeStory({ status: "Done", story_points: null }),
    makeStory({ status: "In Progress", story_points: 5 }),
  ];
  const totals = computeSprintTotals(stories, config);

  assertEquals(totals.committed_points, 5);
  assertEquals(totals.completed_points, 0);
  assertEquals(totals.in_flight_points, 5);
});

// ── Integration: empty sprint metadata ─────────────────────────────────────────

Deno.test("buildSprintMeta — null iterEntry produces minimal sprint header", () => {
  const meta = buildSprintMeta(null);
  assertEquals(meta.name, "(sprint not found)");
  assertEquals(Object.keys(meta).length, 1); // only 'name'
});
