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

  // Session mode: strip only the heavy API-fetched label inventory, which is not
  // needed at session start and is available via detail:"full" when required.
  //
  // Config-derived fields (team, DoR, DoD, autonomy) and backend-resolved
  // template_uris are retained — they are static, small, and needed at every
  // session start for readiness checks and ceremony flows.
  //
  // Null values and empty arrays in the output are pruned by handleOrient before
  // serialization, so callers never see noise like `team: null` or `missing_options: []`.
  return {
    ...result,
    platform_state: {
      ...result.platform_state,
      labels: {
        existing: [],
        expected: [],
        missing: result.platform_state.labels.missing,
      },
      epics: {
        active: epics,
        total_count: result.platform_state.epics.total_count,
      },
      iterations: {
        active: result.platform_state.iterations.active,
        next: result.platform_state.iterations.next,
        completed_count: result.platform_state.iterations.completed_count,
      },
      // template_uris, deadline_field: pass through (config-derived or config-keyed)
    },
    // vocabulary: all fields pass through — team/dor/dod/autonomy are config-derived
  };
};
