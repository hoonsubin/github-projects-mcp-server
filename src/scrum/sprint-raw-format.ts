// =============================================================================
// src/scrum/sprint-raw-format.ts - Agent-facing snake_case sprint raw payloads
// =============================================================================

import type { SprintInfo, SprintRawData } from "./ports.ts";

export const formatSprintInfo = (sprint: SprintInfo | null) =>
  sprint === null ? null : {
    id: sprint.id,
    name: sprint.name,
    goal: sprint.goal,
    start_date: sprint.startDate,
    duration_days: sprint.durationDays,
    end_date: sprint.endDate,
  };

export const formatSprintRawData = (data: SprintRawData) => ({
  sprint: formatSprintInfo(data.sprint),
  items: data.items,
});
