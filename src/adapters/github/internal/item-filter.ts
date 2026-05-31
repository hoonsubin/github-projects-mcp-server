// =============================================================================
// src/adapters/github/internal/item-filter.ts
//
// Pure client-side filter predicate for findItems — extracted from
// Client-side post-filter predicate for the assembler → normalizer pipeline.
// Filter order matches the original sequential chain (AND semantics).
// =============================================================================

import type { GitHubBootState } from "../bootstrap.ts";
import type { ProjectItem } from "../types.ts";
import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { Story } from "../../../domain/types.ts";
import { resolveSprint } from "./resolver.ts";

/**
 * Build a post-filter predicate matching the findItems filter chain order.
 */
export const buildItemFilterFn = (
  filter: ResolvedItemFilter,
  config: GitHubBootState,
  allItems: readonly ProjectItem[],
): (story: Story) => boolean => {
  const hasKeys = filter.keys.length > 0;
  const keySet = hasKeys ? new Set(filter.keys) : null;

  let sprintItemIds: Set<string> | null = null;
  if (filter.sprint_ref !== null) {
    const iterationId = resolveSprint(filter.sprint_ref, config);
    if (iterationId === null) {
      return () => false;
    }
    sprintItemIds = new Set(
      allItems
        .filter((item) => {
          const fv = item.fieldValues.nodes.find(
            (v) => v.field?.id === config.live.fields.sprintFieldId,
          );
          return fv?.iterationId === iterationId;
        })
        .map((item) => item.id),
    );
  }

  const typeSet = filter.types.length > 0 ? new Set(filter.types) : null;
  const statusSet = filter.statuses.length > 0 ? new Set(filter.statuses) : null;
  const labelList = filter.labels.length > 0 ? filter.labels : null;
  const searchQ = filter.search ? filter.search.toLowerCase() : null;

  return (story: Story): boolean => {
    if (keySet) {
      if (story.kind !== "issue" || !keySet.has(story.key!)) return false;
    }

    if (!hasKeys) {
      if (filter.scope === "sprint" && story.sprint === null) return false;
      if (filter.scope === "backlog" && story.sprint !== null) return false;
    }

    if (sprintItemIds !== null && !sprintItemIds.has(story.ref.id)) return false;

    if (filter.epic_id) {
      if (story.kind !== "issue" || story.epic?.ref.id !== filter.epic_id) return false;
    }

    if (filter.assignee && !story.assignees.includes(filter.assignee)) return false;

    if (labelList && !labelList.every((label) => story.labels.includes(label))) return false;

    if (typeSet && (story.type === null || !typeSet.has(story.type))) return false;

    if (statusSet && (story.status === null || !statusSet.has(story.status))) return false;

    if (filter.priority && story.priority !== filter.priority) return false;

    if (searchQ) {
      const titleMatch = story.title.toLowerCase().includes(searchQ);
      const bodyMatch = story.body.toLowerCase().includes(searchQ);
      if (!titleMatch && !bodyMatch) return false;
    }

    if (filter.estimated !== undefined) {
      if (filter.estimated && (story.story_points ?? 0) <= 0) return false;
      if (!filter.estimated && (story.story_points ?? 0) !== 0) return false;
    }

    return true;
  };
};
