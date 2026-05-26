// =============================================================================
// src/scrum/orient.ts - orientUseCase
//
// Receives backend: ProjectReader and scrumConfig: ScrumConfig.
// Returns OrientResult from domain/types.ts - the session ground truth.
// =============================================================================

import type { ProjectReader, SprintInfo } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { EpicSummary, OrientResult, TemplateUriMap, UseCaseResult } from "../domain/types.ts";
import { ITEM_TYPES, sprintContextFromSprintInfo } from "../domain/types.ts";
import { catchBackend } from "../services/error-enrichment.ts";

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
 * Only types with a declared template path get a URI - the agent falls back
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
): Promise<UseCaseResult<OrientResult>> => {
  const warnings: string[] = [];

  // Extract canonical keys from domain-level config (no adapter-specific types)
  const canonicalStatusKeys = Object.keys(scrumConfig.scrum.status);
  const canonicalPriorityKeys = scrumConfig.scrum.priority.map((p) => p.key);

  // ── Hard prerequisites (no catch - let failures propagate) ────────────
  await backend.reload();

  // getPlatformState returns BackendCallResult - warnings are accumulated per
  // sub-field (e.g. NOT_IMPLEMENTED for sprint goal). Fatal errors propagate.
  const { value: state, warnings: stateWarnings } = await backend.getPlatformState({
    canonicalStatusKeys,
    canonicalPriorityKeys,
  });
  warnings.push(...stateWarnings);

  // ── Optional: epic enumeration ────────────────────────────────────────
  const sprintIterationId = state?.iterations.active?.id ?? null;
  const { value: allEpics, warnings: epicWarnings } = await catchBackend(
    () => backend.getEpics(sprintIterationId),
  );
  warnings.push(...epicWarnings);

  // Filter: active (open or in-progress) epics only; null status = active
  const activeEpics = (allEpics ?? []).filter(
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

  // ── Optional: work completion percentage ──────────────────────────────
  let workPct = 0;
  if (state?.iterations.active) {
    const activeId = state.iterations.active.id; // narrowed before closure
    const { value: completion, warnings: compWarnings } = await catchBackend(
      () => backend.getSprintCompletion(activeId),
    );
    warnings.push(...compWarnings);
    if (completion) {
      const { completed, total } = completion;
      workPct = total > 0 ? Math.round((completed / total) * 100) : 0;
    }
  }

  // Build SprintContext from SprintInfo via the domain factory (pure, no backend call)
  const buildSprintContext = (
    info: SprintInfo | null,
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

  if (!state) {
    const partialResult: OrientResult = {
      warnings,
      platform_state: {
        fields: {
          status: { exists: false, options: [], missing_options: [] },
          sprint: { exists: false },
          story_points: { exists: false },
          priority: { exists: false, options: [], missing_options: [] },
          type_field: { exists: false, configured: false },
        },
        missing_options: [],
        labels: { existing: [], expected: [], missing: [] },
        iterations: { active: null, next: null, completed_count: 0 },
        epics: { active: [], total_count: 0 },
        template_uris: null,
      },
      vocabulary: {
        status: null,
        priority: null,
        type: null,
        story_points: { scale: null, values: null },
        sprint: { duration_days: null, velocity_window: 5, length_weeks: null },
        team: null,
        dor: null,
        dod: null,
        autonomy: null,
      },
    };
    return { data: partialResult, warnings };
  }

  const result: OrientResult = {
    warnings,
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
        total_count: allEpics?.length ?? 0,
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
  return { data: result, warnings };
};
