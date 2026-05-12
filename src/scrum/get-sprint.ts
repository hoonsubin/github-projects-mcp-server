// =============================================================================
// src/scrum/get-sprint.ts — getSprintUseCase
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// Receives backend: ProjectBackend and scrumConfig: ScrumConfig.
// =============================================================================

import type { ProjectBackend } from "./ports.ts";
import type { SprintRef } from "../domain/types.ts";
import type { ScrumConfig } from "../domain/config.ts";
import { buildSprintMeta, computeSprintTotals, groupStoriesByStatus } from "./sprint-math.ts";

interface SprintBoardResult {
  sprint: {
    name: string;
    start_date?: string;
    end_date?: string;
    duration_days?: number;
    days_remaining?: number;
  };
  groups: Array<{ status: string; stories: unknown[]; points_sum: number }>;
  totals: {
    committed_points: number;
    completed_points: number;
    in_flight_points: number;
    blocked_points: number;
  };
}

/**
 * Get the sprint board: stories grouped by status with point totals.
 */
export const getSprintUseCase = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  sprintRef: SprintRef,
): Promise<SprintBoardResult> => {
  const result = await backend.getSprintStories(sprintRef);
  if (!result.sprintInfo) {
    return {
      sprint: { name: "(no sprint)" },
      groups: [],
      totals: { committed_points: 0, completed_points: 0, in_flight_points: 0, blocked_points: 0 },
    };
  }
  const meta = buildSprintMeta({
    id: "",
    title: result.sprintInfo.name,
    startDate: result.sprintInfo.startDate,
    duration: result.sprintInfo.durationDays,
  });
  // todo: Story.status currently returns platform display names. Once the mapper
  // translates to canonical keys, replace these display lookups with canonical keys
  // ("done", "in_progress", "blocked") and remove the status_display dependency.
  // todo: Remove this cast once status uses canonical keys — backends is type-erased.
  type GhDisplay = { status_display?: Record<string, string> };
  const statusDisplay = (scrumConfig.backends.github as GhDisplay | undefined)?.status_display ?? {};
  const statusOrder = Object.keys(scrumConfig.scrum.status).map((k) => statusDisplay[k]).filter(Boolean);
  const groups = groupStoriesByStatus(result.stories, statusOrder);
  const doneDisplay = statusDisplay["done"] ?? "Done";
  const inProgressDisplay = statusDisplay["in_progress"] ?? "In Progress";
  const blockedDisplay = statusDisplay["blocked"] ?? "Blocked";
  const totals = computeSprintTotals(
    result.stories,
    doneDisplay,
    inProgressDisplay,
    blockedDisplay,
  );
  return { sprint: meta, groups, totals };
};
