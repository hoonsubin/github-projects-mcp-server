// =============================================================================
// src/scrum/utils/sprint-math.ts - Pure sprint date helpers
//
// Judgment computations (burndown series, ideal line, velocity) live in the
// agent skill layer. This module retains only shared date math used by adapters.
// =============================================================================

/**
 * Compute the sprint end date from a start date and duration.
 *
 * All date math is performed in UTC to avoid off-by-one errors when sprint
 * boundaries cross DST transitions.
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
