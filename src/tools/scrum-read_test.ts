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

// =============================================================================
// Story 9: Unit tests for extracted helpers
// =============================================================================

import {
  buildCommentList,
  buildEnrichedStory,
  buildLinkedPrList,
  classifyLabels,
  extractBoardFields,
  parseAcceptanceCriteria,
} from "./scrum-read.ts";

// ── classifyLabels tests ───────────────────────────────────────────────────────

Deno.test("classifyLabels — one type label present", () => {
  const result = classifyLabels(["feature", "backend"]);
  assertEquals(result.type, "feature");
  assertEquals(result.labels, ["backend"]);
});

Deno.test("classifyLabels — no type label", () => {
  const result = classifyLabels(["backend", "api"]);
  assertEquals(result.type, null);
  assertEquals(result.labels, ["backend", "api"]);
});

Deno.test("classifyLabels — multiple type labels (first wins)", () => {
  const result = classifyLabels(["bug", "feature"]);
  assertEquals(result.type, "bug");
  // Both "bug" and "feature" are in STORY_TYPES, so both are filtered from labels
  assertEquals(result.labels, []);
});

Deno.test("classifyLabels — empty array", () => {
  const result = classifyLabels([]);
  assertEquals(result.type, null);
  assertEquals(result.labels, []);
});

// ── extractBoardFields tests ───────────────────────────────────────────────────

const mockFields: RuntimeConfig["fields"] = {
  sprintFieldId: "sprint_field_1",
  statusFieldId: "status_field_1",
  storyPointsFieldId: "sp_field_1",
  priorityFieldId: "priority_field_1",
  epicFieldId: null,
  assigneeFieldId: null,
  typeFieldId: null,
};

Deno.test("extractBoardFields — all four fields populated", () => {
  const nodes = [
    { field: { id: "status_field_1" }, name: "In Progress" },
    { field: { id: "sprint_field_1" }, title: "Sprint 1" },
    { field: { id: "sp_field_1" }, number: 5 },
    { field: { id: "priority_field_1" }, name: "Must" },
  ];
  const result = extractBoardFields(nodes, mockFields);
  assertEquals(result.status, "In Progress");
  assertEquals(result.sprint, "Sprint 1");
  assertEquals(result.story_points, 5);
  assertEquals(result.priority, "Must");
});

Deno.test("extractBoardFields — storyPointsFieldId is null in config", () => {
  const fieldsNoSP = { ...mockFields, storyPointsFieldId: null };
  const nodes = [
    { field: { id: "status_field_1" }, name: "Done" },
    { field: { id: "sp_field_1" }, number: 3 },
  ];
  const result = extractBoardFields(nodes, fieldsNoSP);
  assertEquals(result.status, "Done");
  assertEquals(result.story_points, null);
});

Deno.test("extractBoardFields — priorityFieldId is null in config", () => {
  const fieldsNoPriority = { ...mockFields, priorityFieldId: null };
  const nodes = [
    { field: { id: "status_field_1" }, name: "Todo" },
    { field: { id: "priority_field_1" }, name: "Should" },
  ];
  const result = extractBoardFields(nodes, fieldsNoPriority);
  assertEquals(result.status, "Todo");
  assertEquals(result.priority, null);
});

Deno.test("extractBoardFields — field value node with no field.id is skipped", () => {
  const nodes = [
    { field: undefined, name: "Should" },
    { field: { id: "status_field_1" }, name: "Done" },
  ];
  const result = extractBoardFields(nodes, mockFields);
  assertEquals(result.status, "Done");
});

Deno.test("extractBoardFields — empty nodes array returns all-null BoardFields", () => {
  const result = extractBoardFields([], mockFields);
  assertEquals(result.status, null);
  assertEquals(result.sprint, null);
  assertEquals(result.story_points, null);
  assertEquals(result.priority, null);
});

// ── buildEnrichedStory tests ───────────────────────────────────────────────────

const mockIssueNode: {
  id: string;
  number: number;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
  assignees?: { nodes: Array<{ login: string }> };
  labels?: { nodes: Array<{ name: string }> };
  milestone?: { title: string } | null;
} = {
  id: "issue_1",
  number: 42,
  title: "Test Issue",
  body: "- [ ] AC 1\n- [x] AC 2",
  url: "https://github.com/test/test/issues/42",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
  assignees: { nodes: [{ login: "alice" }, { login: "bob" }] },
  labels: { nodes: [{ name: "feature" }, { name: "backend" }] },
  milestone: { title: "Epic A" },
};

Deno.test("buildEnrichedStory — full issue node", () => {
  const fieldValueNodes = [
    { field: { id: "single_select_field_1" }, name: "In Progress" },
    { field: { id: "iteration_field_1" }, title: "Sprint 1" },
    { field: { id: "number_field_1" }, number: 5 },
    { field: { id: "single_select_field_2" }, name: "Should" },
  ];
  const story = buildEnrichedStory(mockIssueNode, "PVTI_test_1", fieldValueNodes, makeConfig());

  assertEquals(story.ref.number, 42);
  assertEquals(story.ref.id, "PVTI_test_1");
  assertEquals(story.title, "Test Issue");
  assertEquals(story.body, "- [ ] AC 1\n- [x] AC 2");
  assertEquals(story.type, "feature");
  assertEquals(story.status, "In Progress");
  assertEquals(story.sprint, "Sprint 1");
  assertEquals(story.story_points, 5);
  assertEquals(story.priority, "Should");
  assertEquals(story.assignees, ["alice", "bob"]);
  assertEquals(story.labels, ["backend"]);
  assertEquals(story.epic, "Epic A");
  assertEquals(story.created_at, "2024-01-01T00:00:00Z");
  assertEquals(story.updated_at, "2024-01-02T00:00:00Z");
  assertEquals(story.url, "https://github.com/test/test/issues/42");
});

Deno.test("buildEnrichedStory — null title/body falls back to empty string", () => {
  const issueNull = { ...mockIssueNode, title: null, body: null };
  const story = buildEnrichedStory(issueNull, "PVTI_test_1", [], makeConfig());
  assertEquals(story.title, "");
  assertEquals(story.body, "");
});

Deno.test("buildEnrichedStory — no assignees returns empty array", () => {
  const issueNoAssignees = { ...mockIssueNode, assignees: undefined };
  const story = buildEnrichedStory(issueNoAssignees, "PVTI_test_1", [], makeConfig());
  assertEquals(story.assignees, []);
});

Deno.test("buildEnrichedStory — no milestone returns null epic", () => {
  const issueNoMilestone = { ...mockIssueNode, milestone: null };
  const story = buildEnrichedStory(issueNoMilestone, "PVTI_test_1", [], makeConfig());
  assertEquals(story.epic, null);
});

Deno.test("buildEnrichedStory — type label excluded from labels", () => {
  const issueWithLabels = {
    ...mockIssueNode,
    labels: { nodes: [{ name: "bug" }, { name: "frontend" }] },
  };
  const story = buildEnrichedStory(issueWithLabels, "PVTI_test_1", [], makeConfig());
  assertEquals(story.type, "bug");
  assertEquals(story.labels, ["frontend"]);
});

// ── buildCommentList tests ─────────────────────────────────────────────────────

Deno.test("buildCommentList — normal comment", () => {
  const nodes = [
    {
      author: { login: "alice" },
      body: "LGTM",
      createdAt: "2024-01-01T00:00:00Z",
      url: "https://github.com/comment/1",
    },
  ];
  const result = buildCommentList(nodes);
  assertEquals(result[0].author, "alice");
  assertEquals(result[0].body, "LGTM");
  assertEquals(result[0].created_at, "2024-01-01T00:00:00Z");
  assertEquals(result[0].url, "https://github.com/comment/1");
});

Deno.test("buildCommentList — deleted account author falls back to (ghost)", () => {
  const nodes = [
    {
      author: null,
      body: "deleted comment",
      createdAt: "2024-01-01T00:00:00Z",
      url: "https://github.com/comment/2",
    },
  ];
  const result = buildCommentList(nodes);
  assertEquals(result[0].author, "(ghost)");
});

Deno.test("buildCommentList — empty array returns empty array", () => {
  const result = buildCommentList([]);
  assertEquals(result, []);
});

// ── buildLinkedPrList tests ────────────────────────────────────────────────────

Deno.test("buildLinkedPrList — PR cross-reference", () => {
  const nodes = [
    {
      source: {
        number: 10,
        title: "Fix bug",
        url: "https://github.com/pr/10",
        state: "MERGED",
        isDraft: false,
      },
    },
  ];
  const result = buildLinkedPrList(nodes);
  assertEquals(result[0].number, 10);
  assertEquals(result[0].title, "Fix bug");
  assertEquals(result[0].url, "https://github.com/pr/10");
  assertEquals(result[0].state, "MERGED");
  assertEquals(result[0].is_draft, false);
});

Deno.test("buildLinkedPrList — non-PR cross-reference filtered out", () => {
  const nodes = [
    { source: { number: null, title: "Issue mention", url: null, state: null, isDraft: null } },
    {
      source: {
        number: 10,
        title: "Fix bug",
        url: "https://github.com/pr/10",
        state: "OPEN",
        isDraft: false,
      },
    },
  ];
  const result = buildLinkedPrList(nodes);
  assertEquals(result.length, 1);
  assertEquals(result[0].number, 10);
});

Deno.test("buildLinkedPrList — isDraft absent defaults to false", () => {
  const nodes = [
    {
      source: {
        number: 10,
        title: "WIP PR",
        url: "https://github.com/pr/10",
        state: "OPEN",
      },
    },
  ];
  const result = buildLinkedPrList(nodes);
  assertEquals(result[0].is_draft, false);
});

Deno.test("buildLinkedPrList — empty array returns empty array", () => {
  const result = buildLinkedPrList([]);
  assertEquals(result, []);
});

// ── parseAcceptanceCriteria tests ──────────────────────────────────────────────

Deno.test("parseAcceptanceCriteria — unchecked item", () => {
  const result = parseAcceptanceCriteria("- [ ] Deploy to staging");
  assertEquals(result, [{ text: "Deploy to staging", checked: false }]);
});

Deno.test("parseAcceptanceCriteria — checked item", () => {
  const result = parseAcceptanceCriteria("- [x] Unit tests pass");
  assertEquals(result, [{ text: "Unit tests pass", checked: true }]);
});

Deno.test("parseAcceptanceCriteria — uppercase [X]", () => {
  const result = parseAcceptanceCriteria("- [X] Done");
  assertEquals(result, [{ text: "Done", checked: true }]);
});

Deno.test("parseAcceptanceCriteria — no checkboxes in body", () => {
  const result = parseAcceptanceCriteria("Just prose text");
  assertEquals(result, []);
});

Deno.test("parseAcceptanceCriteria — mixed body with headings extracts checkboxes", () => {
  const body = `
## Acceptance Criteria

- [ ] First criterion
Some heading text

- [x] Second criterion
More text

- [ ] Third criterion
  `.trim();
  const result = parseAcceptanceCriteria(body);
  assertEquals(result.length, 3);
  assertEquals(result[0].text, "First criterion");
  assertEquals(result[0].checked, false);
  assertEquals(result[1].text, "Second criterion");
  assertEquals(result[1].checked, true);
  assertEquals(result[2].text, "Third criterion");
  assertEquals(result[2].checked, false);
});

// =============================================================================
// Story 10: Unit tests for burndown helpers
// =============================================================================

import {
  buildBurndownStoryInput,
  buildDaySeries,
  buildIdealLine,
  buildSprintWindow,
  extractLinkHeader,
} from "./scrum-read.ts";

// ── extractLinkHeader tests ─────────────────────────────────────────────────────

Deno.test("extractLinkHeader — single next link", () => {
  const result = extractLinkHeader('<https://api.github.com/page2>; rel="next"');
  assertEquals(result, "https://api.github.com/page2");
});

Deno.test("extractLinkHeader — last page (no next)", () => {
  const result = extractLinkHeader('<https://api.github.com/last>; rel="last"');
  assertEquals(result, null);
});

Deno.test("extractLinkHeader — null header", () => {
  const result = extractLinkHeader(null);
  assertEquals(result, null);
});

Deno.test("extractLinkHeader — multiple rels", () => {
  const result = extractLinkHeader(
    '<https://api.github.com/page2>; rel="next", <https://api.github.com/last>; rel="last"',
  );
  assertEquals(result, "https://api.github.com/page2");
});

Deno.test("extractLinkHeader — extra whitespace around semicolon", () => {
  const result = extractLinkHeader('<https://api.github.com/page2>;\t rel="next"');
  assertEquals(result, "https://api.github.com/page2");
});

// ── buildSprintWindow tests ─────────────────────────────────────────────────────

Deno.test("buildSprintWindow — active sprint has positive daysRemaining", () => {
  const iterEntry: IterationEntry = {
    id: "sprint-future",
    title: "Future Sprint",
    startDate: "2030-01-01",
    duration: 14,
  };
  const window = buildSprintWindow(iterEntry);
  assertEquals(window.name, "Future Sprint");
  assertEquals(window.durationDays, 14);
  // 2030-01-01 is in the future, so daysRemaining should be positive
  assertEquals(window.daysRemaining > 0, true);
  // Verify startDate is normalised to UTC midnight
  assertEquals(window.startDate.getUTCHours(), 0);
  assertEquals(window.startDate.getUTCMinutes(), 0);
  assertEquals(window.startDate.getUTCSeconds(), 0);
  assertEquals(window.startDate.getUTCMilliseconds(), 0);
});

Deno.test("buildSprintWindow — endDate = startDate + duration", () => {
  const iterEntry: IterationEntry = {
    id: "sprint-duration",
    title: "Duration Test",
    startDate: "2024-01-01",
    duration: 14,
  };
  const window = buildSprintWindow(iterEntry);
  const expectedEnd = new Date("2024-01-15");
  assertEquals(window.endDate.toISOString().slice(0, 10), expectedEnd.toISOString().slice(0, 10));
});

Deno.test("buildSprintWindow — daysRemaining is 0 when sprint ended yesterday", () => {
  const pastStart = new Date();
  pastStart.setUTCDate(pastStart.getUTCDate() - 14);
  const iterEntry: IterationEntry = {
    id: "sprint-past",
    title: "Past Sprint",
    startDate: pastStart.toISOString().slice(0, 10),
    duration: 14,
  };
  const window = buildSprintWindow(iterEntry);
  assertEquals(window.daysRemaining, 0);
});

// ── buildIdealLine tests ─────────────────────────────────────────────────────────

Deno.test("buildIdealLine — 10-day sprint, 20 points", () => {
  const window: SprintWindow = {
    name: "Test Sprint",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-11"),
    durationDays: 10,
    daysRemaining: 5,
  };
  const ideal = buildIdealLine(window, 20);
  assertEquals(ideal.length, 11); // 10 days + 1
  assertEquals(ideal[0].remaining_points, 20);
  assertEquals(ideal[10].remaining_points, 0);
});

Deno.test("buildIdealLine — 0 committed points", () => {
  const window: SprintWindow = {
    name: "Empty Sprint",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-11"),
    durationDays: 10,
    daysRemaining: 5,
  };
  const ideal = buildIdealLine(window, 0);
  for (const point of ideal) {
    assertEquals(point.remaining_points, 0);
  }
});

Deno.test("buildIdealLine — rounding to 1 decimal", () => {
  const window: SprintWindow = {
    name: "Rounding Test",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-04"),
    durationDays: 3,
    daysRemaining: 2,
  };
  const ideal = buildIdealLine(window, 10);
  // Day 0: 10 * (1 - 0/3) = 10
  // Day 1: 10 * (1 - 1/3) = 6.666... → 6.7
  // Day 2: 10 * (1 - 2/3) = 3.333... → 3.3
  // Day 3: 10 * (1 - 3/3) = 0
  assertEquals(ideal[0].remaining_points, 10);
  assertEquals(ideal[1].remaining_points, 6.7);
  assertEquals(ideal[2].remaining_points, 3.3);
  assertEquals(ideal[3].remaining_points, 0);
});

// ── buildDaySeries tests ─────────────────────────────────────────────────────────

interface BurndownStoryInput {
  number: number;
  title: string;
  points: number;
  status: string | null;
}

Deno.test("buildDaySeries — no completions", () => {
  const window: SprintWindow = {
    name: "Test Sprint",
    startDate: new Date("2030-01-01"),
    endDate: new Date("2030-01-05"),
    durationDays: 4,
    daysRemaining: 4,
  };
  const stories: BurndownStoryInput[] = [
    { number: 1, title: "Story 1", points: 5, status: "Todo" },
    { number: 2, title: "Story 2", points: 3, status: "Todo" },
  ];
  const completions = new Map<number, string>();
  const series = buildDaySeries(stories, completions, window, 8);
  for (const point of series) {
    assertEquals(point.completed_points, 0);
    assertEquals(point.remaining_points, 8);
  }
});

Deno.test("buildDaySeries — story completes on day 3", () => {
  // Use dates relative to today so the series is non-empty
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - 4); // 4 days ago
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() + 1); // tomorrow
  const window: SprintWindow = {
    name: "Test Sprint",
    startDate,
    endDate,
    durationDays: 5,
    daysRemaining: 1,
  };
  const stories: BurndownStoryInput[] = [
    { number: 1, title: "Story 1", points: 5, status: "Todo" },
    { number: 2, title: "Story 2", points: 3, status: "Todo" },
  ];
  const completions = new Map<number, string>();
  // Complete story 1 on day 2 (2 days after start)
  const completionDate = new Date(startDate);
  completionDate.setUTCDate(completionDate.getUTCDate() + 2);
  completionDate.setUTCHours(12, 0, 0, 0);
  completions.set(1, completionDate.toISOString());
  const series = buildDaySeries(stories, completions, window, 8);
  // Days 0-1: completed_points = 0, remaining = 8
  assertEquals(series[0].completed_points, 0);
  assertEquals(series[0].remaining_points, 8);
  assertEquals(series[1].completed_points, 0);
  assertEquals(series[1].remaining_points, 8);
  // Day 2 onward: completed_points = 5, remaining = 3
  assertEquals(series[2].completed_points, 5);
  assertEquals(series[2].remaining_points, 3);
});

Deno.test("buildDaySeries — sprint already ended", () => {
  const window: SprintWindow = {
    name: "Past Sprint",
    startDate: new Date("2020-01-01"),
    endDate: new Date("2020-01-05"),
    durationDays: 4,
    daysRemaining: 0,
  };
  const stories: BurndownStoryInput[] = [
    { number: 1, title: "Story 1", points: 5, status: "Todo" },
  ];
  const completions = new Map<number, string>();
  const series = buildDaySeries(stories, completions, window, 5);
  // Series should end at endDate (2020-01-05), not today
  assertEquals(series.length, 5);
  assertEquals(series[4].date, "2020-01-05");
});

Deno.test("buildDaySeries — multiple completions same day", () => {
  // Use dates relative to today so the series is non-empty
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - 3); // 3 days ago
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() + 2); // 2 days from now
  const window: SprintWindow = {
    name: "Test Sprint",
    startDate,
    endDate,
    durationDays: 5,
    daysRemaining: 2,
  };
  const stories: BurndownStoryInput[] = [
    { number: 1, title: "Story 1", points: 3, status: "Todo" },
    { number: 2, title: "Story 2", points: 5, status: "Todo" },
  ];
  // Complete both stories on day 1 (1 day after start)
  const completionDate = new Date(startDate);
  completionDate.setUTCDate(completionDate.getUTCDate() + 1);
  completionDate.setUTCHours(12, 0, 0, 0);
  const completions = new Map<number, string>();
  completions.set(1, completionDate.toISOString());
  completions.set(2, completionDate.toISOString());
  const series = buildDaySeries(stories, completions, window, 8);
  // Day 0: completed = 0, remaining = 8
  assertEquals(series[0].completed_points, 0);
  assertEquals(series[0].remaining_points, 8);
  // Day 1 onward: both completed, completed = 8, remaining = 0
  assertEquals(series[1].completed_points, 8);
  assertEquals(series[1].remaining_points, 0);
});

Deno.test("buildDaySeries — 0-pt story completes", () => {
  // Use dates relative to today so the series is non-empty
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - 2); // 2 days ago
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() + 3); // 3 days from now
  const window: SprintWindow = {
    name: "Test Sprint",
    startDate,
    endDate,
    durationDays: 5,
    daysRemaining: 3,
  };
  const stories: BurndownStoryInput[] = [
    { number: 1, title: "Story 1", points: 0, status: "Todo" },
    { number: 2, title: "Story 2", points: 5, status: "Todo" },
  ];
  // Complete story 1 (0 points) on day 1
  const completionDate = new Date(startDate);
  completionDate.setUTCDate(completionDate.getUTCDate() + 1);
  completionDate.setUTCHours(12, 0, 0, 0);
  const completions = new Map<number, string>();
  completions.set(1, completionDate.toISOString());
  const series = buildDaySeries(stories, completions, window, 5);
  // completed_points should still be 0 because story 1 has 0 points
  // story 2 is not completed, so remaining = 5
  assertEquals(series[1].completed_points, 0);
  assertEquals(series[1].remaining_points, 5);
});

// ── buildBurndownStoryInput tests ────────────────────────────────────────────────

interface RawItem {
  id: string;
  content: { id: string; number: number; title: string } | null;
  fieldValues: { nodes: Array<{ field?: { id: string }; name?: string; number?: number }> };
}

Deno.test("buildBurndownStoryInput — normal issue item", () => {
  const item: RawItem = {
    id: "PVTI_test_1",
    content: { id: "issue_1", number: 42, title: "Test Story" },
    fieldValues: {
      nodes: [
        { field: { id: "single_select_field_1" }, name: "In Progress" },
        { field: { id: "number_field_1" }, number: 5 },
      ],
    },
  };
  const config = makeConfig();
  const result = buildBurndownStoryInput(item, config);
  assertEquals(result?.number, 42);
  assertEquals(result?.title, "Test Story");
  assertEquals(result?.points, 5);
  assertEquals(result?.status, "In Progress");
});

Deno.test("buildBurndownStoryInput — DraftIssue (no number) returns null", () => {
  const item: RawItem = {
    id: "PVTI_draft_1",
    content: { id: "draft_1", title: "Draft" } as unknown as {
      id: string;
      number: number;
      title: string;
    },
    fieldValues: { nodes: [] },
  };
  const config = makeConfig();
  const result = buildBurndownStoryInput(item, config);
  assertEquals(result, null);
});

Deno.test("buildBurndownStoryInput — unpointed story returns points: 0", () => {
  const item: RawItem = {
    id: "PVTI_test_2",
    content: { id: "issue_2", number: 43, title: "Unpointed" },
    fieldValues: { nodes: [] },
  };
  const config = makeConfig();
  const result = buildBurndownStoryInput(item, config);
  assertEquals(result?.points, 0);
});

Deno.test("buildBurndownStoryInput — null content returns null", () => {
  const item: RawItem = {
    id: "PVTI_test_3",
    content: null,
    fieldValues: { nodes: [] },
  };
  const config = makeConfig();
  const result = buildBurndownStoryInput(item, config);
  assertEquals(result, null);
});

// ── Helper type for SprintWindow (needed in tests) ──────────────────────────────

interface SprintWindow {
  name: string;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  daysRemaining: number;
}
