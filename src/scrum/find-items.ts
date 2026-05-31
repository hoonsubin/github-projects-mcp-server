// =============================================================================
// src/scrum/find-items.ts - findItemsUseCase
//
// Unified item search across all PBIs. Delegates to FindItemsPort.findItems().
// =============================================================================

import type { FindItemsPort, ItemFilter, ResolvedItemFilter } from "./ports.ts";
import type { ItemSearchResult, UseCaseResult } from "../domain/types.ts";

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
  estimated: filter.estimated,
  sprint_ref: filter.sprint_ref ?? null,
  include_dependencies: filter.include_dependencies ?? false,
  limit: filter.limit ?? 50,
});

/** Find items matching the given filter via the adapter assembler pipeline. */
export const findItemsUseCase = async (
  backend: FindItemsPort,
  filter: ItemFilter,
): Promise<UseCaseResult<ItemSearchResult>> => {
  const resolved = resolveFilter(filter);
  const { value, warnings } = await backend.findItems(resolved);
  if (!value) {
    throw new Error("findItems returned null value without throwing");
  }
  return { data: value, warnings };
};
