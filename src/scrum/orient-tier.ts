// =============================================================================
// src/scrum/orient-tier.ts - Session vs full orient payload tiers
// =============================================================================

import type { EpicSummary, OrientResult } from "../domain/types.ts";

export type OrientDetail = "session" | "full";

const EPIC_DESCRIPTION_MAX = 200;

const capEpicDescriptions = (epics: readonly EpicSummary[]): EpicSummary[] =>
  epics.map((epic) => {
    if (!epic.description || epic.description.length <= EPIC_DESCRIPTION_MAX) return epic;
    return {
      ...epic,
      description: `${epic.description.slice(0, EPIC_DESCRIPTION_MAX)}…`,
    };
  });

/** Strip heavy platform_state for routine session starts. */
export const applyOrientDetail = (
  result: OrientResult,
  detail: OrientDetail,
): OrientResult => {
  const cappedEpics = capEpicDescriptions(result.platform_state.epics.active);
  const epics = detail === "full" ? cappedEpics : cappedEpics.slice(0, 5);

  if (detail === "full") {
    return {
      ...result,
      platform_state: {
        ...result.platform_state,
        epics: {
          active: epics,
          total_count: result.platform_state.epics.total_count,
        },
      },
    };
  }

  // Session mode: strip everything the agent doesn't need at session start.
  //
  // labels.existing is omitted — the full label inventory is not needed upfront
  // and is available via detail:"full" when the agent actually needs to assign labels.
  // Only labels.missing is preserved so vocabulary gaps are still surfaced.
  //
  // The top-level missing_options field is redundant with the per-field
  // missing_options already present in fields.status and fields.priority,
  // so it is cleared to avoid duplicated noise in a context-constrained response.
  return {
    ...result,
    platform_state: {
      ...result.platform_state,
      missing_options: [],
      labels: {
        existing: [],
        expected: [],
        missing: result.platform_state.labels.missing,
      },
      epics: {
        active: epics,
        total_count: result.platform_state.epics.total_count,
      },
      template_uris: null,
      iterations: {
        active: result.platform_state.iterations.active,
        next: result.platform_state.iterations.next,
        completed_count: result.platform_state.iterations.completed_count,
      },
    },
    vocabulary: {
      ...result.vocabulary,
      team: null,
      dor: null,
      dod: null,
      autonomy: null,
    },
  };
};
