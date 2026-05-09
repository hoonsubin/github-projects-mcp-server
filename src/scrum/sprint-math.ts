// =============================================================================
// src/scrum/sprint-math.ts — Pure sprint computation helpers
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// All functions depend only on domain types — no RuntimeConfig or GitHub types.
// =============================================================================

import type { IterationEntry, Story } from "../types.ts";

// ── Sprint metadata ────────────────────────────────────────────────────────────

/**
 * Build sprint metadata from an IterationEntry.
 * Falls back to { name: "(sprint not found)" } when iterEntry is null.
 */
export const buildSprintMeta = (iterEntry: IterationEntry | null): {
  name: string;
  start_date?: string;
  end_date?: string;
  duration_days?: number;
  days_remaining?: number;
} => {
  if (!iterEntry) return { name: "(sprint not found)" };

  const endDate = new Date(iterEntry.startDate);
  endDate.setDate(endDate.getDate() + iterEntry.duration);
  endDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
  );

  return {
    name: iterEntry.title,
    start_date: iterEntry.startDate,
    end_date: endDate.toISOString().slice(0, 10),
    duration_days: iterEntry.duration,
    days_remaining: daysRemaining,
  };
};

// ── Story grouping ─────────────────────────────────────────────────────────────

/**
 * Group stories by status, ordered by the team's declared status vocabulary.
 * Statuses not in the vocabulary are appended at the end.
 */
export const groupStoriesByStatus = (
  stories: Story[],
  statusOrder: string[],
): Array<{ status: string; stories: Story[]; points_sum: number }> => {
  const groupMap = new Map<string, Story[]>();
  for (const story of stories) {
    const key = story.status ?? "(No Status)";
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(story);
  }

  const orderedGroups = statusOrder
    .filter((statusName) => groupMap.has(statusName))
    .map((statusName) => ({
      status: statusName,
      stories: groupMap.get(statusName)!,
      points_sum: groupMap.get(statusName)!.reduce((acc, s) => acc + (s.story_points ?? 0), 0),
    }));

  // Append unknown statuses
  const knownStatuses = new Set(statusOrder);
  for (const [status, groupStories] of groupMap) {
    if (!knownStatuses.has(status)) {
      orderedGroups.push({
        status,
        stories: groupStories,
        points_sum: groupStories.reduce((acc, s) => acc + (s.story_points ?? 0), 0),
      });
    }
  }

  return orderedGroups;
};

/**
 * Compute sprint point totals using vocabulary-based status identification.
 */
export const computeSprintTotals = (
  stories: Story[],
  doneDisplay: string,
  inProgressDisplay: string,
  blockedDisplay: string,
): {
  committed_points: number;
  completed_points: number;
  in_flight_points: number;
  blocked_points: number;
} => ({
  committed_points: stories.reduce((acc, s) => acc + (s.story_points ?? 0), 0),
  completed_points: stories.filter((s) => s.status === doneDisplay)
    .reduce((acc, s) => acc + (s.story_points ?? 0), 0),
  in_flight_points: stories.filter((s) => s.status === inProgressDisplay)
    .reduce((acc, s) => acc + (s.story_points ?? 0), 0),
  blocked_points: stories.filter((s) => s.status === blockedDisplay)
    .reduce((acc, s) => acc + (s.story_points ?? 0), 0),
});

// ── Sprint window ──────────────────────────────────────────────────────────────

/** Computed sprint window — pure derivation of an IterationEntry. */
export interface SprintWindow {
  name: string;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  daysRemaining: number;
}

/**
 * Compute the sprint window from an IterationEntry.
 * All Date objects are normalised to UTC midnight.
 */
export const buildSprintWindow = (iterEntry: IterationEntry): SprintWindow => {
  const startDate = new Date(iterEntry.startDate);
  startDate.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + iterEntry.duration);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - today.getTime()) / msPerDay),
  );

  return {
    name: iterEntry.title,
    startDate,
    endDate,
    durationDays: iterEntry.duration,
    daysRemaining,
  };
};

// ── Burndown helpers ───────────────────────────────────────────────────────────

/** One entry in the ideal burndown line. */
export interface IdealDayPoint {
  date: string;
  remaining_points: number;
}

/**
 * Compute the ideal burndown line: one entry per calendar day.
 * Values rounded to one decimal place.
 */
export const buildIdealLine = (
  window: SprintWindow,
  committedPoints: number,
): IdealDayPoint[] => {
  const ideal: IdealDayPoint[] = [];
  const cursor = new Date(window.startDate);

  for (let dayIndex = 0; dayIndex <= window.durationDays; dayIndex++) {
    const date = cursor.toISOString().slice(0, 10);
    const remaining = committedPoints * (1 - dayIndex / window.durationDays);
    ideal.push({ date, remaining_points: Math.round(remaining * 10) / 10 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return ideal;
};

/** One entry in the actual burndown series. */
export interface BurndownDayPoint {
  date: string;
  remaining_points: number;
  completed_points: number;
}

/** Lightweight per-story projection for burndown computation. */
export interface BurndownStoryInput {
  number: number;
  title: string;
  points: number;
  status: string | null;
}

/**
 * Build the actual burndown series: one entry per calendar day.
 */
export const buildDaySeries = (
  stories: BurndownStoryInput[],
  completions: Map<number, string>,
  window: SprintWindow,
  committedPoints: number,
): BurndownDayPoint[] => {
  const series: BurndownDayPoint[] = [];
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const seriesEnd = window.endDate < today ? window.endDate : today;
  const cursor = new Date(window.startDate);

  while (cursor <= seriesEnd) {
    const endOfDay = new Date(cursor);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const dateStr = cursor.toISOString().slice(0, 10);

    let completedPoints = 0;
    for (const story of stories) {
      const completedAt = completions.get(story.number);
      if (completedAt && new Date(completedAt) <= endOfDay) {
        completedPoints += story.points;
      }
    }

    series.push({
      date: dateStr,
      remaining_points: committedPoints - completedPoints,
      completed_points: completedPoints,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return series;
};
