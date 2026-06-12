// =============================================================================
// src/scrum/find-items-intent.ts - Intent presets → filter fields
// =============================================================================

import type { FindItemsIntent, ItemFilter, ListingFieldsMode } from "./ports.ts";

export const FIND_ITEMS_INTENTS = [
  "sprint_board",
  "backlog_ready",
  "readiness_check",
  "blocked_items",
  "search_backlog",
  "by_keys",
] as const satisfies readonly FindItemsIntent[];

export interface FindItemsInput extends ItemFilter {}

export interface NormalizedFindItemsInput {
  readonly filter: ItemFilter;
  readonly hints: readonly string[];
}

/** Coerce unsafe filter combos and apply intent presets. */
export const normalizeFindItemsInput = (input: FindItemsInput): NormalizedFindItemsInput => {
  const hints: string[] = [];
  let next = { ...input };

  if (
    next.include_dependencies &&
    !next.intent &&
    next.sprint === undefined
  ) {
    hints.push(
      'include_dependencies without sprint or intent would scan the entire board; coerced to intent "readiness_check" with sprint "current". For blocked-item analysis prefer intent "blocked_items" or "readiness_check".',
    );
    next = { ...next, intent: "readiness_check" };
  }

  return { filter: applyFindItemsIntent(next), hints };
};

export const applyFindItemsIntent = (input: FindItemsInput): ItemFilter => {
  const { intent, ...rest } = input;
  if (!intent) return rest;

  switch (intent) {
    case "sprint_board":
      return {
        ...rest,
        sprint: rest.sprint ?? "current",
        fields: rest.fields ?? "standard",
        limit: rest.limit ?? 50,
      };
    case "backlog_ready":
      return {
        ...rest,
        sprint: rest.sprint ?? "backlog",
        estimated: rest.estimated ?? true,
        fields: rest.fields ?? "compact",
        limit: rest.limit ?? 50,
      };
    case "readiness_check":
      return {
        ...rest,
        sprint: rest.sprint ?? "current",
        include_dependencies: true,
        fields: rest.fields ?? "compact",
        limit: rest.limit ?? 50,
      };
    case "blocked_items":
      return {
        ...rest,
        sprint: rest.sprint ?? "current",
        has_blockers: rest.has_blockers ?? true,
        include_dependencies: true,
        fields: rest.fields ?? "standard",
        limit: rest.limit ?? 50,
      };
    case "search_backlog":
      if (!rest.search?.trim()) {
        throw new Error('intent "search_backlog" requires a non-empty search string.');
      }
      return {
        ...rest,
        sprint: rest.sprint ?? "all",
        fields: rest.fields ?? "standard",
        limit: rest.limit ?? 20,
      };
    case "by_keys":
      if (!rest.keys?.length) {
        throw new Error('intent "by_keys" requires a non-empty keys array.');
      }
      return {
        ...rest,
        fields: rest.fields ?? "compact",
      };
    default:
      return rest;
  }
};

export const defaultListingFields = (fields?: ListingFieldsMode): ListingFieldsMode =>
  fields ?? "compact";
