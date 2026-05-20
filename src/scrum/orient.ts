// =============================================================================
// src/scrum/orient.ts — orientUseCase
//
// Receives backend: ProjectReader and scrumConfig: ScrumConfig.
// =============================================================================

import type { ProjectReader } from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";

// todo: the results should be a composition of the types declared in `ports.ts`
interface OrientResult {
  platform_state: {
    fields: {
      status: { exists: boolean; options: string[]; missing_options: string[] };
      sprint: { exists: boolean };
      story_points: { exists: boolean };
      priority: { exists: boolean; options: string[]; missing_options: string[] };
    };
    missing_options: string[]; // convenience: concat of status + priority missing_options
    labels: { existing: string[]; expected: string[]; missing: string[] };
    iterations: {
      active: { name: string; start_date: string; duration_days: number } | null;
      next: { name: string; start_date: string; duration_days: number } | null;
      completed_count: number;
    };
  };
  vocabulary: {
    status: Record<string, string> | null;
    priority: Record<string, string> | null;
    /** Maps canonical type keys → display names declared in type_display. null when not configured. */
    type: Record<string, string> | null;
    story_points: { scale: string | null; values: number[] | null };
    sprint: { duration_days: number | null; velocity_window: number; length_weeks: number | null };
    team: unknown;
    dor: unknown; // was definition_of_ready
    dod: unknown; // was definition_of_done
    autonomy: { require_confirmation_above_n_items: number | null } | null;
    templates: {
      sprint_review: string | null;
      retrospective: string | null;
      standup: string | null;
      sprint_planning: string | null;
      refinement: string | null;
    };
  };
}

/**
 * Orient to the project: return platform state and declared vocabulary.
 */
export const orientUseCase = async (
  backend: ProjectReader,
  scrumConfig: ScrumConfig,
): Promise<OrientResult> => {
  // todo: Once Story.status returns canonical keys, expose scrum.status semantic
  // metadata here instead of display names. For now, status_display values are
  // passed so the adapter can diff them against live platform options.
  // todo: Remove this cast once status uses canonical keys — backends is type-erased.
  type GhDisplay = {
    status_display?: Record<string, string>;
    priority_display?: Record<string, string>;
    type_display?: Record<string, string>;
  };
  const ghDisplay = scrumConfig.backends.github as GhDisplay | undefined;
  const statusVocab = ghDisplay?.status_display ?? null;
  const priorityVocab = ghDisplay?.priority_display ?? null;
  const typeVocab = ghDisplay?.type_display ?? null;

  await backend.reload();

  const state = await backend.getPlatformState({
    statusValues: statusVocab ? Object.values(statusVocab) : [],
    priorityValues: priorityVocab ? Object.values(priorityVocab) : [],
  });

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
      },
      missing_options: [
        ...state.fields.status.missingOptions,
        ...state.fields.priority.missingOptions,
      ],
      labels: state.labels,
      // todo: orient should also return the currently active epics (name and description)
      iterations: {
        active: state.iterations.active
          ? {
            name: state.iterations.active.name,
            start_date: state.iterations.active.startDate,
            duration_days: state.iterations.active.durationDays,
          }
          : null,
        next: state.iterations.next
          ? {
            name: state.iterations.next.name,
            start_date: state.iterations.next.startDate,
            duration_days: state.iterations.next.durationDays,
          }
          : null,
        completed_count: state.iterations.completedCount,
      },
    },
    vocabulary: {
      status: statusVocab,
      priority: priorityVocab,
      type: typeVocab,
      story_points: {
        scale: scrumConfig.scrum.sprint?.story_point_scale ?? null,
        values: scrumConfig.scrum.sprint?.story_point_values ?? null,
      },
      sprint: {
        duration_days: null, // not modelled in new config — length_weeks is the source of truth
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
      templates: {
        sprint_review: scrumConfig.templates?.sprint_review ?? null,
        retrospective: scrumConfig.templates?.retrospective ?? null,
        standup: scrumConfig.templates?.standup ?? null,
        sprint_planning: scrumConfig.templates?.sprint_planning ?? null,
        refinement: scrumConfig.templates?.refinement ?? null,
      },
    },
  };
};
