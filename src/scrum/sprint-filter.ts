// =============================================================================
// src/scrum/sprint-filter.ts - Unified sprint arg → internal scope + sprint_ref
// =============================================================================

import type { SearchScope } from "../domain/types.ts";

export type FindItemsSprintFilter =
  | "current"
  | "next"
  | "backlog"
  | "all"
  | string;

export interface ResolvedSprintQuery {
  readonly scope: SearchScope;
  readonly sprint_ref: string | null;
}

/** Map the public `sprint` filter to adapter scope + sprint_ref. */
export const resolveSprintQuery = (
  sprint?: FindItemsSprintFilter | null,
): ResolvedSprintQuery => {
  if (sprint === undefined || sprint === null) {
    return { scope: "all", sprint_ref: null };
  }
  switch (sprint) {
    case "current":
      return { scope: "sprint", sprint_ref: "current" };
    case "next":
      return { scope: "all", sprint_ref: "next" };
    case "backlog":
      return { scope: "backlog", sprint_ref: null };
    case "all":
      return { scope: "all", sprint_ref: "all" };
    default:
      return { scope: "all", sprint_ref: sprint };
  }
};
