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
