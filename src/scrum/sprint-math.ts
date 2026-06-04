// =============================================================================
// src/scrum/sprint-math.ts - Pure sprint computation helpers
//
// All functions depend only on domain types - no RuntimeConfig or GitHub types.
// =============================================================================

import type { BurndownDayPoint, IdealDayPoint, IterationEntry } from "../domain/types.ts";
import type { BurndownStoryInput } from "./ports.ts";

// ── Shared date utility ────────────────────────────────────────────────────────

/**
 * Compute the sprint end date from a start date and duration.
 *
 * All date math is performed in UTC to avoid off-by-one errors when sprint
 * boundaries cross DST transitions. Every sprint-math function that needs an
 * end date goes through this single function.
 *
 * @param startDate ISO date string (YYYY-MM-DD)
 * @param durationDays number of calendar days the sprint spans (inclusive)
 * @returns ISO date string (YYYY-MM-DD) of the sprint end date
 */
export const computeSprintEndDate = (startDate: string, durationDays: number): string => {
  const utc = new Date(`${startDate}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + durationDays);
  return utc.toISOString().slice(0, 10);
};

// ── Sprint metadata ────────────────────────────────────────────────────────────

/**
 * Build sprint metadata from an IterationEntry.
 * Falls back to { name: "(sprint not found)" } when iterEntry is null.
 */
// export const buildSprintMeta = (iterEntry: IterationEntry | null): {
//   name: string;
//   start_date?: string;
//   end_date?: string;
//   duration_days?: number;
//   days_remaining?: number;
// } => {
//   if (!iterEntry) return { name: "(sprint not found)" };

//   const endDate = computeSprintEndDate(iterEntry.startDate, iterEntry.duration);

//   const today = new Date();
//   today.setUTCHours(0, 0, 0, 0);

//   const endDateTime = new Date(`${endDate}T00:00:00Z`);
//   const daysRemaining = Math.max(
//     0,
//     Math.ceil((endDateTime.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
//   );

//   return {
//     name: iterEntry.title,
//     start_date: iterEntry.startDate,
//     end_date: endDate,
//     duration_days: iterEntry.duration,
//     days_remaining: daysRemaining,
//   };
// };

// ── Sprint window ──────────────────────────────────────────────────────────────

/** Computed sprint window - pure derivation of an IterationEntry. */
interface SprintWindow {
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

  const endDate = new Date(
    computeSprintEndDate(iterEntry.startDate, iterEntry.duration) + "T00:00:00Z",
  );

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
