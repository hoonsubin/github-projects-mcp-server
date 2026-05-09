// =============================================================================
// src/scrum/get-sprint.ts — getSprintUseCase
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// Receives backend: ProjectBackend and yml: ScrumConfigYml.
// =============================================================================

import type { ProjectBackend } from "./ports.ts";
import type { ScrumConfigYml, SprintRef } from "../types.ts";
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
  yml: ScrumConfigYml,
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
  const statusOrder = Object.values((yml.status as Record<string, string>) ?? {});
  const groups = groupStoriesByStatus(result.stories, statusOrder);
  const statusVocab = yml.status as Record<string, string> | undefined;
  const doneDisplay = resolveStatusDisplayName(statusVocab, "done", "Done");
  const inProgressDisplay = resolveStatusDisplayName(statusVocab, "progress", "In Progress");
  const blockedDisplay = resolveStatusDisplayName(statusVocab, "block", "Blocked");
  const totals = computeSprintTotals(
    result.stories,
    doneDisplay,
    inProgressDisplay,
    blockedDisplay,
  );
  return { sprint: meta, groups, totals };
};

const resolveStatusDisplayName = (
  status: Record<string, string> | undefined,
  keyHint: string,
  fallback: string,
): string => {
  if (!status) return fallback;
  const entry = Object.entries(status).find(([k]) =>
    k.toLowerCase().includes(keyHint.toLowerCase())
  );
  return entry ? entry[1] : fallback;
};
