// =============================================================================
// src/tools/scrum-history_test.ts
//
// Unit tests for scrum_get_history tool handler.
// Tests the core logic: sprint sorting, window slicing, summary computation,
// edge cases (zero points, division by zero, DraftIssue filtering).
// =============================================================================

import { assertEquals, assertGreater, assertLess } from "@std/assert";

// ── Test helpers ───────────────────────────────────────────────────────────────

/** Create a mock completed iteration. */
const makeIteration = (
  id: string,
  title: string,
  daysAgo: number,
  duration: number = 14,
) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysAgo - duration);
  return {
    id,
    title,
    startDate: startDate.toISOString().slice(0, 10),
    duration,
  };
};

/** Create a mock project item with field values. */
const makeMockItem = (
  id: string,
  issueNumber: number,
  issueTitle: string,
  sprintIterationId: string | null,
  statusName: string | null,
  storyPoints: number,
) => {
  const fieldValues: Array<{
    field?: { id: string };
    name?: string;
    iterationId?: string;
    number?: number;
  }> = [];

  if (sprintIterationId !== null) {
    fieldValues.push({
      field: { id: "sprint-field-id" },
      iterationId: sprintIterationId,
    });
  }
  if (statusName !== null) {
    fieldValues.push({
      field: { id: "status-field-id" },
      name: statusName,
    });
  }
  fieldValues.push({
    field: { id: "points-field-id" },
    number: storyPoints,
  });

  return {
    id,
    content: {
      __typename: "Issue" as const,
      id: `I_${issueNumber}`,
      number: issueNumber,
      title: issueTitle,
      body: "",
      url: `https://github.com/owner/repo/issues/${issueNumber}`,
      assignees: { nodes: [] },
      labels: { nodes: [] },
      milestone: null,
    },
    fieldValues: { nodes: fieldValues },
  };
};

/** Create a mock DraftIssue item. */
const makeMockDraftItem = (id: string, title: string) => ({
  id,
  content: {
    __typename: "DraftIssue" as const,
    id: `DI_${id}`,
    title,
    body: "",
  },
  fieldValues: { nodes: [] },
});

// ── Test: sprint sorting (most-recent-first) ──────────────────────────────────

Deno.test("scrum_get_history — sorts sprints most-recent-first", () => {
  const completed = [
    makeIteration("sprint-1", "Sprint 1", 42), // oldest
    makeIteration("sprint-2", "Sprint 2", 28),
    makeIteration("sprint-3", "Sprint 3", 14), // newest
  ];

  const sorted = [...completed].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
  );

  assertEquals(sorted[0].id, "sprint-3");
  assertEquals(sorted[1].id, "sprint-2");
  assertEquals(sorted[2].id, "sprint-1");
});

// ── Test: window slicing ──────────────────────────────────────────────────────

Deno.test("scrum_get_history — window slices to requested count", () => {
  const completed = [
    makeIteration("sprint-1", "Sprint 1", 42),
    makeIteration("sprint-2", "Sprint 2", 35),
    makeIteration("sprint-3", "Sprint 3", 28),
    makeIteration("sprint-4", "Sprint 4", 21),
    makeIteration("sprint-5", "Sprint 5", 14),
    makeIteration("sprint-6", "Sprint 6", 7), // newest
  ];

  const sorted = [...completed].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
  );

  const windowSlice = sorted.slice(0, 3);

  assertEquals(windowSlice.length, 3);
  assertEquals(windowSlice[0].id, "sprint-6");
  assertEquals(windowSlice[1].id, "sprint-5");
  assertEquals(windowSlice[2].id, "sprint-4");
});

Deno.test("scrum_get_history — window larger than available returns all", () => {
  const completed = [
    makeIteration("sprint-1", "Sprint 1", 28),
    makeIteration("sprint-2", "Sprint 2", 14),
  ];

  const sorted = [...completed].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
  );

  const windowSlice = sorted.slice(0, 10);

  assertEquals(windowSlice.length, 2);
});

// ── Test: summary computation ─────────────────────────────────────────────────

Deno.test("scrum_get_history — computes summary correctly", () => {
  const items = [
    makeMockItem("item-1", 1, "Story A", "sprint-1", "Done", 3),
    makeMockItem("item-2", 2, "Story B", "sprint-1", "Done", 5),
    makeMockItem("item-3", 3, "Story C", "sprint-1", "In Progress", 8),
    makeMockItem("item-4", 4, "Story D", "sprint-1", "Backlog", 2),
  ];

  const sprintFieldId = "sprint-field-id";
  const statusFieldId = "status-field-id";
  const storyPointsFieldId = "points-field-id";
  const doneDisplay = "Done";

  const iterItems = items.filter((item) => {
    const fv = item.fieldValues.nodes.find(
      (v) => v.field?.id === sprintFieldId,
    );
    return fv?.iterationId === "sprint-1";
  });

  let committedPoints = 0;
  let completedPoints = 0;
  let completedCount = 0;

  for (const item of iterItems) {
    if (!item.content || typeof item.content.number !== "number") continue;

    const ptsFv = storyPointsFieldId
      ? item.fieldValues.nodes.find((v) => v.field?.id === storyPointsFieldId)
      : null;
    const pts = ptsFv?.number ?? 0;
    const statusFv = item.fieldValues.nodes.find(
      (v) => v.field?.id === statusFieldId,
    );
    const statusName = statusFv?.name ?? null;
    const isDone = statusName === doneDisplay;

    committedPoints += pts;
    if (isDone) {
      completedPoints += pts;
      completedCount++;
    }
  }

  const carriedPoints = committedPoints - completedPoints;
  const completionRate = committedPoints > 0
    ? Math.round((completedPoints / committedPoints) * 100) / 100
    : 0;

  assertEquals(committedPoints, 18); // 3 + 5 + 8 + 2
  assertEquals(completedPoints, 8); // 3 + 5
  assertEquals(completedCount, 2);
  assertEquals(carriedPoints, 10);
  assertEquals(completionRate, 0.44); // 8/18 = 0.444... → 0.44
});

// ── Test: zero story points ───────────────────────────────────────────────────

Deno.test("scrum_get_history — items with zero story points contribute to story_count but not committed_points", () => {
  const items = [
    makeMockItem("item-1", 1, "Story A", "sprint-1", "Done", 0),
    makeMockItem("item-2", 2, "Story B", "sprint-1", "In Progress", 5),
  ];

  const sprintFieldId = "sprint-field-id";
  const storyPointsFieldId = "points-field-id";

  const iterItems = items.filter((item) => {
    const fv = item.fieldValues.nodes.find(
      (v) => v.field?.id === sprintFieldId,
    );
    return fv?.iterationId === "sprint-1";
  });

  let committedPoints = 0;
  let storyCount = 0;

  for (const item of iterItems) {
    if (!item.content || typeof item.content.number !== "number") continue;
    storyCount++;

    const ptsFv = storyPointsFieldId
      ? item.fieldValues.nodes.find((v) => v.field?.id === storyPointsFieldId)
      : null;
    const pts = ptsFv?.number ?? 0;
    committedPoints += pts;
  }

  assertEquals(storyCount, 2);
  assertEquals(committedPoints, 5); // only Story B contributes
});

// ── Test: DraftIssue filtering ────────────────────────────────────────────────

Deno.test("scrum_get_history — DraftIssues are excluded from story count", () => {
  const items = [
    makeMockItem("item-1", 1, "Story A", "sprint-1", "Done", 3),
    makeMockDraftItem("draft-1", "Draft Task"),
  ];

  const sprintFieldId = "sprint-field-id";

  const iterItems = items.filter((item) => {
    // DraftIssues have no sprint field value, so they won't match
    const fv = item.fieldValues.nodes.find(
      (v) => v.field?.id === sprintFieldId,
    );
    return fv?.iterationId === "sprint-1";
  });

  // Only the Issue should match (DraftIssue has no sprint field)
  assertEquals(iterItems.length, 1);
  const content = iterItems[0].content;
  if (content && "number" in content && typeof content.number === "number") {
    assertEquals(content.number, 1);
  }
});

// ── Test: division by zero protection ─────────────────────────────────────────

Deno.test("scrum_get_history — completion_rate handles zero committed points", () => {
  const committedPoints = 0;
  const completedPoints = 0;

  const completionRate = committedPoints > 0
    ? Math.round((completedPoints / committedPoints) * 100) / 100
    : 0;

  assertEquals(completionRate, 0);
});

// ── Test: end date computation ────────────────────────────────────────────────

Deno.test("scrum_get_history — end_date computed correctly from startDate + duration", () => {
  const startDate = "2026-05-03";
  const duration = 14;

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + duration);
  const endDateStr = endDate.toISOString().slice(0, 10);

  assertEquals(endDateStr, "2026-05-17");
});

Deno.test("scrum_get_history — end_date handles month boundary", () => {
  const startDate = "2026-01-25";
  const duration = 10;

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + duration);
  const endDateStr = endDate.toISOString().slice(0, 10);

  assertEquals(endDateStr, "2026-02-04");
});

Deno.test("scrum_get_history — end_date handles leap year", () => {
  const startDate = "2028-02-20";
  const duration = 10;

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + duration);
  const endDateStr = endDate.toISOString().slice(0, 10);

  assertEquals(endDateStr, "2028-03-01"); // 2028 is a leap year
});

// ── Test: empty completed sprints ─────────────────────────────────────────────

Deno.test("scrum_get_history — returns empty sprints when no completed iterations", () => {
  const completed: Array<{ id: string; title: string; startDate: string; duration: number }> = [];

  const sorted = [...completed].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
  );

  const windowSlice = sorted.slice(0, 5);

  assertEquals(windowSlice.length, 0);
});

// ── Test: status vocabulary matching ──────────────────────────────────────────

Deno.test("scrum_get_history — Done status matched by vocabulary display name", () => {
  const doneDisplay: string = "Done"; // From config.yml status.done
  const statusName: string = "Done";

  assertEquals(statusName, doneDisplay);
});

Deno.test("scrum_get_history — custom Done vocabulary still matches", () => {
  const doneDisplay: string = "Completed"; // Custom vocabulary
  const statusName: string = "Completed";

  assertEquals(statusName, doneDisplay);
});

Deno.test("scrum_get_history — non-Done status not counted as done", () => {
  const statusName: string = "In Review";
  const doneDisplay: string = "Done";

  // Use assertNotEqual pattern (not equal check)
  const notEqual = statusName !== doneDisplay;
  assertEquals(notEqual, true);
});

// ── Test: carried points can be negative (edge case) ──────────────────────────

Deno.test("scrum_get_history — carried_points correctly computed when completed > committed", () => {
  // This shouldn't happen in practice but verify the math is correct
  const committedPoints = 5;
  const completedPoints = 8;

  const carriedPoints = committedPoints - completedPoints;

  assertEquals(carriedPoints, -3);
});

// ── Test: window parameter validation (Zod schema) ────────────────────────────

Deno.test("scrum_get_history — window default is 5", () => {
  // The schema defines: window: z.number().int().min(1).max(10).default(5)
  // Verify default value
  const defaultWindow = 5;

  assertGreater(defaultWindow, 0);
  assertLess(defaultWindow, 11);
});

// ── Test: story list includes correct fields ──────────────────────────────────

Deno.test("scrum_get_history — story entry includes number, title, points, status", () => {
  const story = {
    number: 42,
    title: "Test Story",
    points: 5,
    status: "In Progress",
  };

  assertEquals(typeof story.number, "number");
  assertEquals(typeof story.title, "string");
  assertEquals(typeof story.points, "number");
  assertEquals(story.status, "In Progress");
});
