// =============================================================================
// src/scrum/get-burndown.ts — getBurndownUseCase
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// Receives backend: ProjectBackend and yml: ScrumConfigYml.
// =============================================================================

import type { ProjectBackend } from "./ports.ts";
import type {
  BurndownResponse,
  BurndownSprintMeta,
  BurndownStory,
  ScrumConfigYml,
  SprintRef,
} from "../types.ts";
import { buildDaySeries, buildIdealLine, buildSprintWindow } from "./sprint-math.ts";

interface GetBurndownParams {
  sprint?: SprintRef;
}

/**
 * Get the sprint burndown chart.
 */
export const getBurndownUseCase = async (
  backend: ProjectBackend,
  _yml: ScrumConfigYml,
  params: GetBurndownParams,
): Promise<BurndownResponse | { message: string }> => {
  const sprintRef = params.sprint ?? "current";
  const burndownInput = await backend.getBurndownInput(sprintRef);

  const window = buildSprintWindow({
    id: "",
    title: burndownInput.sprint.name,
    startDate: burndownInput.sprint.startDate,
    duration: burndownInput.sprint.durationDays,
  });

  const committedPoints = burndownInput.stories.reduce((sum, s) => sum + s.points, 0);

  const completionResult = await backend.resolveCompletionTimestamps(burndownInput);
  const completions = completionResult.completions;
  const data_source = completionResult.dataSource;
  const warning = completionResult.warning;

  const series = buildDaySeries(burndownInput.stories, completions, window, committedPoints);
  const ideal = buildIdealLine(window, committedPoints);

  const sprintMeta: BurndownSprintMeta = {
    name: window.name,
    start_date: window.startDate.toISOString().slice(0, 10),
    end_date: window.endDate.toISOString().slice(0, 10),
    duration_days: window.durationDays,
    days_remaining: window.daysRemaining,
  };

  const burndownStories: BurndownStory[] = burndownInput.stories.map((s) => ({
    number: s.number,
    title: s.title,
    points: s.points,
    status: s.status,
    completed_at: completions.get(s.number) ?? null,
  }));

  const response: BurndownResponse = warning
    ? { sprint: sprintMeta, data_source, warning, series, ideal, stories: burndownStories }
    : { sprint: sprintMeta, data_source, series, ideal, stories: burndownStories };

  return response;
};
