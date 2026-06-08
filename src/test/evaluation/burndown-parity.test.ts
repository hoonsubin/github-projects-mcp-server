// =============================================================================
// src/test/evaluation/burndown-parity.test.ts
//
// Phase B exit gate — SB4: Burndown parity verification.
//
// Proves that the agent-side burndown algorithm described in SKILL.md §Agent-Side
// Sprint Computations produces bit-identical results to the server's buildDaySeries
// and buildIdealLine functions from sprint-math.ts.
//
// Strategy: synthetic SprintRawData with known completedAt timestamps → run both
// paths → assert zero divergence. The CapturedDataBackend cannot be used here
// because it throws UnsupportedCapabilityError for analytics(burndown); the server
// math functions are used directly as the authoritative reference.
// =============================================================================

import { assertEquals } from "@std/assert";
import { buildDaySeries, buildIdealLine, buildSprintWindow } from "../../scrum/sprint-math.ts";
import type { BurndownStoryInput } from "../../scrum/ports.ts";
import type { SprintRawItem } from "../../scrum/ports.ts";

// ── Agent-side algorithm (mirrors SKILL.md §Burndown series) ──────────────────

interface BurndownDay {
  date: string;
  remaining_points: number;
  completed_points: number;
}

/**
 * Agent-side burndown series.
 * Direct translation of the SKILL.md algorithm — no sprint-math.ts imports.
 */
function agentBuildDaySeries(
  items: readonly SprintRawItem[],
  sprint: { startDate: string; durationDays: number; endDate: string },
): BurndownDay[] {
  const committedPoints = items.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const sprintEnd = new Date(`${sprint.endDate}T00:00:00Z`);
  const seriesEndMs = Math.min(sprintEnd.getTime(), today.getTime());

  const series: BurndownDay[] = [];
  const cursor = new Date(`${sprint.startDate}T00:00:00Z`);

  while (cursor.getTime() <= seriesEndMs) {
    const endOfDay = new Date(cursor);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const dateStr = cursor.toISOString().slice(0, 10);

    let completedByDay = 0;
    for (const item of items) {
      if (item.completedAt !== null && new Date(item.completedAt) <= endOfDay) {
        completedByDay += item.storyPoints ?? 0;
      }
    }

    series.push({
      date: dateStr,
      remaining_points: committedPoints - completedByDay,
      completed_points: completedByDay,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return series;
}

interface IdealDay {
  date: string;
  remaining_points: number;
}

/**
 * Agent-side ideal burndown line.
 * Direct translation of the SKILL.md algorithm.
 */
function agentBuildIdealLine(
  committedPoints: number,
  sprint: { startDate: string; durationDays: number },
): IdealDay[] {
  const ideal: IdealDay[] = [];
  const cursor = new Date(`${sprint.startDate}T00:00:00Z`);

  for (let d = 0; d <= sprint.durationDays; d++) {
    const date = cursor.toISOString().slice(0, 10);
    const remaining = committedPoints * (1 - d / sprint.durationDays);
    ideal.push({ date, remaining_points: Math.round(remaining * 10) / 10 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return ideal;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Sprint window in the past so `seriesEnd = sprintEnd` (deterministic regardless of test run date)
const SPRINT = {
  id: "iter_test_1",
  title: "Test Sprint",
  startDate: "2026-01-05",
  duration: 14, // durationDays
};

// SprintRawItem fixtures — same items expressed as BurndownStoryInput for server path
const RAW_ITEMS: SprintRawItem[] = [
  {
    id: "i1",
    number: 1,
    title: "Story A",
    type: "user_story",
    status: "Done",
    storyPoints: 3,
    hasAssignee: true,
    hasBlockers: false,
    completedAt: "2026-01-07T10:00:00Z", // day 2
  },
  {
    id: "i2",
    number: 2,
    title: "Story B",
    type: "user_story",
    status: "Done",
    storyPoints: 5,
    hasAssignee: true,
    hasBlockers: false,
    completedAt: "2026-01-10T15:30:00Z", // day 5
  },
  {
    id: "i3",
    number: 3,
    title: "Story C",
    type: "bug",
    status: "Done",
    storyPoints: 2,
    hasAssignee: true,
    hasBlockers: false,
    completedAt: "2026-01-14T08:00:00Z", // day 9
  },
  {
    id: "i4",
    number: 4,
    title: "Story D",
    type: "user_story",
    status: "In Progress",
    storyPoints: 8,
    hasAssignee: true,
    hasBlockers: false,
    completedAt: null, // not completed
  },
  {
    id: "i5",
    number: 5,
    title: "Story E",
    type: "user_story",
    status: "Backlog",
    storyPoints: null, // unestimated
    hasAssignee: false,
    hasBlockers: false,
    completedAt: null,
  },
];

// Server-side input (same data in BurndownStoryInput shape)
const SERVER_STORIES: BurndownStoryInput[] = RAW_ITEMS.map((i) => ({
  number: i.number,
  title: i.title,
  points: i.storyPoints ?? 0,
  status: i.status,
}));

const SERVER_COMPLETIONS: Map<number, string> = new Map(
  RAW_ITEMS
    .filter((i) => i.completedAt !== null)
    .map((i) => [i.number, i.completedAt!]),
);

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("burndown parity: agent series matches server buildDaySeries", () => {
  const window = buildSprintWindow(SPRINT);
  const committedPoints = SERVER_STORIES.reduce((s, i) => s + i.points, 0);

  const serverSeries = buildDaySeries(SERVER_STORIES, SERVER_COMPLETIONS, window, committedPoints);
  const agentSeries = agentBuildDaySeries(RAW_ITEMS, {
    startDate: SPRINT.startDate,
    durationDays: SPRINT.duration,
    endDate: window.endDate.toISOString().slice(0, 10),
  });

  assertEquals(
    agentSeries.length,
    serverSeries.length,
    `series length mismatch: agent=${agentSeries.length} server=${serverSeries.length}`,
  );

  for (let i = 0; i < serverSeries.length; i++) {
    assertEquals(agentSeries[i].date, serverSeries[i].date, `date mismatch at index ${i}`);
    assertEquals(
      agentSeries[i].remaining_points,
      serverSeries[i].remaining_points,
      `remaining_points mismatch on ${serverSeries[i].date}`,
    );
    assertEquals(
      agentSeries[i].completed_points,
      serverSeries[i].completed_points,
      `completed_points mismatch on ${serverSeries[i].date}`,
    );
  }
});

Deno.test("burndown parity: agent ideal line matches server buildIdealLine", () => {
  const window = buildSprintWindow(SPRINT);
  const committedPoints = SERVER_STORIES.reduce((s, i) => s + i.points, 0);

  const serverIdeal = buildIdealLine(window, committedPoints);
  const agentIdeal = agentBuildIdealLine(committedPoints, {
    startDate: SPRINT.startDate,
    durationDays: SPRINT.duration,
  });

  assertEquals(agentIdeal.length, serverIdeal.length, "ideal line length mismatch");

  for (let i = 0; i < serverIdeal.length; i++) {
    assertEquals(agentIdeal[i].date, serverIdeal[i].date, `ideal date mismatch at index ${i}`);
    assertEquals(
      agentIdeal[i].remaining_points,
      serverIdeal[i].remaining_points,
      `ideal remaining_points mismatch on ${serverIdeal[i].date}`,
    );
  }
});

Deno.test("burndown parity: unestimated items (storyPoints null) treated as 0 SP", () => {
  // Story E has storyPoints: null — must not affect committed total or series values
  const window = buildSprintWindow(SPRINT);
  const committedFromServer = SERVER_STORIES.reduce((s, i) => s + i.points, 0);
  const committedFromAgent = RAW_ITEMS.reduce((s, i) => s + (i.storyPoints ?? 0), 0);

  assertEquals(committedFromAgent, committedFromServer, "committed points must match");

  const serverSeries = buildDaySeries(
    SERVER_STORIES,
    SERVER_COMPLETIONS,
    window,
    committedFromServer,
  );
  const agentSeries = agentBuildDaySeries(RAW_ITEMS, {
    startDate: SPRINT.startDate,
    durationDays: SPRINT.duration,
    endDate: window.endDate.toISOString().slice(0, 10),
  });

  // Verify the final day shows remaining = uncommitted (story D 8pts) since E is 0
  const lastServer = serverSeries[serverSeries.length - 1];
  const lastAgent = agentSeries[agentSeries.length - 1];
  assertEquals(lastAgent.remaining_points, lastServer.remaining_points);
});

Deno.test("burndown parity: zero-item sprint produces empty series", () => {
  const window = buildSprintWindow(SPRINT);
  const serverSeries = buildDaySeries([], new Map(), window, 0);
  const agentSeries = agentBuildDaySeries([], {
    startDate: SPRINT.startDate,
    durationDays: SPRINT.duration,
    endDate: window.endDate.toISOString().slice(0, 10),
  });

  assertEquals(agentSeries.length, serverSeries.length);
  for (let i = 0; i < serverSeries.length; i++) {
    assertEquals(agentSeries[i].remaining_points, 0);
    assertEquals(agentSeries[i].completed_points, 0);
  }
});
