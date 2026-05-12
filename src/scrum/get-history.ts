// =============================================================================
// src/scrum/get-history.ts — getHistoryUseCase
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// Receives backend: ProjectBackend and scrumConfig: ScrumConfig.
// =============================================================================

import type { ProjectBackend } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";

interface SprintSnapshot {
  name: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  stories: Array<{ number: number; title: string; points: number; status: string | null }>;
  summary: {
    committed_points: number;
    completed_points: number;
    carried_points: number;
    completion_rate: number;
    story_count: number;
    completed_count: number;
  };
}

interface GetHistoryResult {
  window: number;
  sprints: SprintSnapshot[];
  message?: string;
}

/**
 * Get raw sprint history for the last N completed sprints.
 */
export const getHistoryUseCase = async (
  backend: ProjectBackend,
  _scrumConfig: ScrumConfig,
  window: number,
): Promise<GetHistoryResult> => {
  const entries = await backend.getCompletedSprintHistory(window);

  if (entries.length === 0) {
    return { window, sprints: [], message: "No completed sprints found in the project." };
  }

  const sprints: SprintSnapshot[] = entries.map((entry) => {
    const committedPoints = entry.stories.reduce((sum, s) => sum + s.points, 0);
    const completedPoints = entry.stories.filter((s) => s.status === "Done").reduce(
      (sum, s) => sum + s.points,
      0,
    );
    const completedCount = entry.stories.filter((s) => s.status === "Done").length;
    const carriedPoints = committedPoints - completedPoints;

    return {
      name: entry.info.name,
      start_date: entry.info.startDate,
      end_date: entry.info.endDate,
      duration_days: entry.info.durationDays,
      stories: entry.stories,
      summary: {
        committed_points: committedPoints,
        completed_points: completedPoints,
        carried_points: carriedPoints,
        completion_rate: committedPoints > 0
          ? Math.round((completedPoints / committedPoints) * 100) / 100
          : 0,
        story_count: entry.stories.length,
        completed_count: completedCount,
      },
    };
  });

  return { window, sprints };
};
