// =============================================================================
// src/scrum/utils/sprint-context.ts - Sprint time-progress helpers
// =============================================================================

import type { SprintContext } from "../../domain/types.ts";

/**
 * Build a SprintContext from sprint metadata.
 * Called by orientUseCase to populate platform_state.iterations.active/next.
 */
export const sprintContextFromSprintInfo = (
  info: {
    id: string;
    name: string;
    goal: string | null;
    start_date: string;
    end_date: string;
    duration_days: number;
  },
  daysElapsed: number,
): SprintContext => {
  const daysRemaining = Math.max(0, info.duration_days - daysElapsed);
  const timeElapsedPct = info.duration_days > 0
    ? Math.round((daysElapsed / info.duration_days) * 100)
    : 0;

  return {
    id: info.id,
    name: info.name,
    goal: info.goal,
    start_date: info.start_date,
    end_date: info.end_date,
    duration_days: info.duration_days,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    time_elapsed_pct: timeElapsedPct,
  };
};
