// =============================================================================
// src/scrum/orient.ts — orientUseCase
//
// Receives backend: ProjectReader and scrumConfig: ScrumConfig.
// Returns OrientResult from domain/types.ts — the session ground truth.
// =============================================================================

import type { ProjectReader } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { EpicListing, EpicSummary, OrientResult, TemplateUriMap } from "../domain/types.ts";
import { ITEM_TYPES, sprintContextFromSprintInfo } from "../domain/types.ts";

/**
 * Compute days elapsed since the sprint start date (UTC midnight).
 */
const daysSince = (startDate: string): number => {
  const start = new Date(`${startDate}T00:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diffMs = today.getTime() - start.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

/**
 * Build a TemplateUriMap from the backend's declared template paths.
 * Only types with a declared template path get a URI — the agent falls back
 * to its own defaults for absent types.
 */
const buildTemplateUriMap = (typeTemplatePaths: Record<string, string>): TemplateUriMap | null => {
  const map: TemplateUriMap = {};
  for (const type of ITEM_TYPES) {
    if (typeTemplatePaths[type]) {
      map[type] = `scrum://template/${type}`;
    }
  }
  return Object.keys(map).length > 0 ? map : null;
};

/**
 * Orient to the project: return platform state and declared vocabulary.
 */
export const orientUseCase = async (
  backend: ProjectReader,
  scrumConfig: ScrumConfig,
): Promise<OrientResult> => {
  // Extract canonical keys from domain-level config (no adapter-specific types)
  const canonicalStatusKeys = Object.keys(scrumConfig.scrum.status);
  const canonicalPriorityKeys = scrumConfig.scrum.priority.map((p) => p.key);

  await backend.reload();

  const state = await backend.getPlatformState({
    canonicalStatusKeys,
    canonicalPriorityKeys,
  });

  // Fetch epics via dedicated port method (not from PlatformState)
  const sprintIterationId = state.iterations.active?.id ?? null;
  const allEpics: EpicListing[] = await backend.getEpics(sprintIterationId);

  // Filter: active (open or in-progress) epics only; null status = active
  const activeEpics = allEpics.filter(
    (epic) => epic.status !== "done",
  );

  // Map to EpicSummary for the response
  const epicsSummary: EpicSummary[] = activeEpics.map((epic) => ({
    ref: { id: epic.ref.id },
    name: epic.name,
    description: epic.description,
    status: epic.status,
    open_item_count: epic.open_item_count,
  }));

  // Compute work completion percentage for the active sprint
  let workPct = 0;
  if (state.iterations.active) {
    const { completed, total } = await backend.getSprintCompletion(
      state.iterations.active.id,
    );
    workPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  }

  // Build SprintContext from SprintInfo via the domain factory (pure, no backend call)
  const buildSprintContext = (
    info: typeof state.iterations.active,
  ) => {
    if (!info) return null;
    return sprintContextFromSprintInfo(
      {
        id: info.id,
        name: info.name,
        goal: info.goal,
        start_date: info.startDate,
        end_date: info.endDate,
        duration_days: info.durationDays,
      },
      daysSince(info.startDate),
      workPct,
    );
  };

  return {
    platform_state: {
      fields: {
        status: {
          exists: state.fields.status.exists,
          options: state.fields.status.options,
          missing_options: state.fields.status.missingOptions,
        },
        sprint: { exists: state.fields.sprint.exists },
        story_points: { exists: state.fields.story_points.exists },
        priority: {
          exists: state.fields.priority.exists,
          options: state.fields.priority.options,
          missing_options: state.fields.priority.missingOptions,
        },
        type_field: {
          exists: state.fields.type.exists,
          configured: state.fields.type.configured,
        },
      },
      missing_options: [
        ...state.fields.status.missingOptions,
        ...state.fields.priority.missingOptions,
      ],
      labels: state.labels,
      iterations: {
        active: buildSprintContext(state.iterations.active),
        next: buildSprintContext(state.iterations.next),
        completed_count: state.iterations.completedCount,
      },
      epics: {
        active: epicsSummary,
        total_count: allEpics.length,
      },
      template_uris: buildTemplateUriMap(state.vocabulary.typeTemplatePaths),
    },
    vocabulary: {
      status: state.vocabulary.statusDisplay,
      priority: state.vocabulary.priorityDisplay,
      type: state.vocabulary.typeDisplay,
      story_points: {
        scale: scrumConfig.scrum.sprint?.story_point_scale ?? null,
        values: scrumConfig.scrum.sprint?.story_point_values ?? null,
      },
      sprint: {
        duration_days: scrumConfig.scrum.sprint?.length_weeks
          ? scrumConfig.scrum.sprint.length_weeks * 7
          : null,
        velocity_window: scrumConfig.scrum.sprint?.velocity_window ?? 5,
        length_weeks: scrumConfig.scrum.sprint?.length_weeks ?? null,
      },
      team: scrumConfig.project.team ?? null,
      dor: scrumConfig.definition_of_ready ?? null,
      dod: scrumConfig.definition_of_done ?? null,
      autonomy: scrumConfig.project.agent?.autonomy
        ? {
          require_confirmation_above_n_items:
            scrumConfig.project.agent.autonomy.require_confirmation_above_n_items ?? null,
        }
        : null,
    },
  };
};
