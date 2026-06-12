// =============================================================================
// src/scrum/find-items.ts - findItemsUseCase
//
// Unified item search across all PBIs. Delegates to FindItemsPort.findItems().
// =============================================================================

import type {
  FindItemsPort,
  ItemFilter,
  ItemSearchResultRaw,
  ResolvedItemFilter,
} from "./ports.ts";
import type { ItemSearchResult, UseCaseResult } from "../domain/types.ts";
import { normalizeFindItemsInput } from "./find-items-intent.ts";
import { dependencyMapToArray, projectListings } from "./listing-projection.ts";
import { resolveSprintQuery } from "./sprint-filter.ts";

const resolveFilter = (filter: ItemFilter): ResolvedItemFilter => {
  const { scope, sprint_ref } = resolveSprintQuery(filter.sprint);
  return {
    scope,
    keys: filter.keys ?? [],
    search: filter.search?.trim() ?? "",
    types: filter.types ?? [],
    statuses: filter.statuses ?? [],
    priority: filter.priority?.trim() ?? "",
    epic_id: filter.epic_id?.trim() ?? "",
    labels: filter.labels ?? [],
    assignee: filter.assignee?.trim() ?? "",
    estimated: filter.estimated,
    has_blockers: filter.has_blockers,
    sprint_ref,
    include_dependencies: filter.include_dependencies ?? false,
    fields: filter.fields ?? "compact",
    limit: filter.limit ?? 50,
  };
};

const shapeSearchResult = (
  value: ItemSearchResultRaw,
  resolved: ResolvedItemFilter,
): ItemSearchResult => {
  const items = projectListings(value.items, resolved.fields) as ItemSearchResult["items"];
  const dependency_map = resolved.include_dependencies
    ? dependencyMapToArray(value.dependency_map)
    : undefined;

  const includeScopeSummary = value.total_count > resolved.limit ||
    resolved.scope !== "all";

  return {
    items,
    total_count: value.total_count,
    ...(includeScopeSummary ? { scope_summary: value.scope_summary } : {}),
    ...(dependency_map ? { dependency_map } : {}),
  };
};

/** Find items matching the given filter via the adapter assembler pipeline. */
export const findItemsUseCase = async (
  backend: FindItemsPort,
  filter: ItemFilter,
): Promise<UseCaseResult<ItemSearchResult>> => {
  const { filter: normalized, hints } = normalizeFindItemsInput(filter);
  const resolved = resolveFilter(normalized);
  const { value, warnings } = await backend.findItems(resolved);
  if (!value) {
    throw new Error("findItems returned null value without throwing");
  }

  const mergedWarnings = [...hints, ...warnings];
  if (
    normalized.intent === "by_keys" &&
    (normalized.keys?.length ?? 0) > 0 &&
    value.items.length === 0
  ) {
    mergedWarnings.push(
      `No items matched keys [${normalized.keys!.join(", ")}]. Verify issue numbers exist on the board.`,
    );
  }

  return { data: shapeSearchResult(value, resolved), warnings: mergedWarnings };
};
