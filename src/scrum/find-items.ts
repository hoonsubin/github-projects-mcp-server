// =============================================================================
// src/scrum/find-items.ts — findItemsUseCase
//
// Unified item search across all PBIs. Delegates to FindItemsPort.findItems().
// The adapter must implement findItems() (P7) before this returns real data;
// until then the adapter stub will throw.
// =============================================================================

import type { FindItemsPort, ItemFilter, ResolvedItemFilter } from "./ports.ts";
import type { ItemSearchResult } from "../domain/types.ts";

/**
 * Apply defaults to an ItemFilter, producing a ResolvedItemFilter
 * suitable for passing through the port boundary to the adapter.
 */
const resolveFilter = (filter: ItemFilter): ResolvedItemFilter => ({
  scope: filter.scope ?? "all",
  keys: filter.keys ?? [],
  search: filter.search ?? "",
  types: filter.types ?? [],
  statuses: filter.statuses ?? [],
  priority: filter.priority ?? "",
  epic_id: filter.epic_id ?? "",
  labels: filter.labels ?? [],
  assignee: filter.assignee ?? "",
  sprint_ref: filter.sprint_ref ?? null,
  include_dependencies: filter.include_dependencies ?? false,
  limit: filter.limit ?? 50,
});

/**
 * Find items matching the given filter.
 *
 * This use-case is a thin bridge — it resolves defaults on the input filter
 * and delegates to the adapter. The adapter is responsible for translating
 * the filter into platform-specific queries (GraphQL, REST, etc.).
 */
export const findItemsUseCase = (
  backend: FindItemsPort,
  filter: ItemFilter,
): Promise<ItemSearchResult> => {
  const resolved = resolveFilter(filter);
  return backend.findItems(resolved);
};
