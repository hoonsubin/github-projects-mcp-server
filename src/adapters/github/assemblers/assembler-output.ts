// =============================================================================
// src/adapters/github/assemblers/assembler-output.ts
//
// Post-normalizer finalization: sprint ref.id backfill and limit slicing.
// Preserves pre-limit totalCount for behavioral parity with StoryQueryService.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type { GitHubBootState } from "../bootstrap.ts";
import type { AssemblerOutput } from "./types.ts";
import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { BacklogItemListing } from "../../../domain/types.ts";

/** Backfill sprint.ref.id from iteration config (replaces hardcoded "" in listings). */
export const backfillSprintRefs = (
  items: readonly BacklogItemListing[],
  config: GitHubBootState,
): BacklogItemListing[] => {
  return items.map((item) => {
    if (!item.sprint.name) return item;
    const iterEntry = config.live.iterations.all.find((i) => i.title === item.sprint.name);
    if (!iterEntry) {
      throw new GitHubApiError(
        `Sprint "${item.sprint.name}" has no matching iteration in config.`,
        {
          code: "NOT_FOUND",
          recovery: "The sprint may have been deleted or the config is stale. " +
            "Call scrum_orient to refresh platform state.",
          context: { sprintName: item.sprint.name, itemKey: item.ref.key },
        },
      );
    }
    return { ...item, sprint: { name: item.sprint.name, ref: { id: iterEntry.id } } };
  });
};

/**
 * Apply sprint backfill and limit slice. totalCount remains the pre-limit value
 * from the normalizer (filtered set size before limit).
 */
export const finalizeAssemblerOutput = (
  output: AssemblerOutput,
  filter: ResolvedItemFilter,
  config: GitHubBootState,
): AssemblerOutput => {
  const items = backfillSprintRefs(output.items, config).slice(0, filter.limit);
  return { ...output, items };
};
