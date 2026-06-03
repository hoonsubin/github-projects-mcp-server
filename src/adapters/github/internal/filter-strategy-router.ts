// =============================================================================
// src/adapters/github/internal/filter-strategy-router.ts - Filter Strategy Router
//
// Pure function (no dependencies, no class — fully unit-testable).
// Classifies a ResolvedItemFilter into exactly one FilterProfile.
// =============================================================================

import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { FilterProfile } from "./assemblers/types.ts";

/**
 * Classify a resolved filter into a single execution strategy.
 *
 * Decision rules (in priority order):
 *  1. keys present        → `direct_lookup`   (direct issue-number lookup)
 *  2. search/labels/assignee only, no board fields → `search_api`
 *  3. board fields only, no search terms     → `project_items`
 *  4. both search terms + board fields       → `mixed`
 *  5. empty filter + scope=all               → `project_items` (draft parity)
 *  6. empty filter otherwise                 → `search_api` (repo-scoped listing)
 */
export const classifyFilter = (filter: ResolvedItemFilter): FilterProfile => {
  if (filter.keys.length > 0) {
    return { kind: "direct_lookup", keys: filter.keys };
  }
  const hasSearchableOnly = !!(
    filter.search ||
    filter.labels.length > 0 ||
    filter.assignee
  );
  const hasBoardFields = !!(
    filter.statuses.length > 0 ||
    filter.sprint_ref ||
    filter.types.length > 0 ||
    filter.priority
  );
  if (!hasSearchableOnly && !hasBoardFields) {
    if (filter.scope === "all") {
      return { kind: "project_items", filter };
    }
    return {
      kind: "search_api",
      search: "",
      labels: [],
      assignee: "",
    };
  }
  if (hasSearchableOnly && !hasBoardFields) {
    // Draft Issues are not indexed by GitHub search — use board scan for scope=all.
    if (filter.scope === "all") {
      return { kind: "project_items", filter };
    }
    return {
      kind: "search_api",
      search: filter.search,
      labels: filter.labels,
      assignee: filter.assignee,
    };
  }
  if (hasBoardFields && !hasSearchableOnly) {
    return { kind: "project_items", filter };
  }
  return { kind: "mixed", filter };
};
