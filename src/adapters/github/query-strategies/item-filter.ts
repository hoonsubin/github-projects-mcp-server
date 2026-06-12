// =============================================================================
// src/adapters/github/item-filter.ts
//
// Pure client-side filter predicate for findItems - extracted from
// Client-side post-filter predicate for the assembler → normalizer pipeline.
// Filter order matches the original sequential chain (AND semantics).
// =============================================================================

import type { GitHubBootState } from "../bootstrap.ts";
import type { ProjectItem } from "../types.ts";
import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { Story } from "../../../domain/types.ts";
import { resolveSprint } from "../infra/resolver.ts";

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

  const buildSprintItemIds = (
    iterationId: string,
    items: readonly ProjectItem[],
  ): Set<string> =>
    new Set(
      items
        .filter((item) => {
          const fv = item.fieldValues.nodes.find(
            (v) => v.field?.id === config.live.fields.sprintFieldId,
          );
          return fv?.iterationId === iterationId;
        })
        .map((item) => item.id),
    );

  let sprintItemIds: Set<string> | null = null;
  if (filter.sprint_ref === "all") {
    sprintItemIds = new Set<string>();
    for (const iteration of config.live.iterations.all) {
      for (const id of buildSprintItemIds(iteration.id, allItems)) {
        sprintItemIds.add(id);
      }
    }
  } else if (filter.sprint_ref !== null) {
    const iterationId = resolveSprint(filter.sprint_ref, config);
    if (iterationId === null) {
      return () => false;
    }
    sprintItemIds = buildSprintItemIds(iterationId, allItems);
  } else if (filter.scope === "sprint" && config.live.iterations.active) {
    sprintItemIds = buildSprintItemIds(
      config.live.iterations.active.id,
      allItems,
    );
  }

  const typeSet = filter.types.length > 0 ? new Set(filter.types) : null;
  const resolvedStatuses = filter.statuses.map(
    (status) => config.ghConfig.status_display?.[status] ?? status,
  );
  const statusSet = resolvedStatuses.length > 0 ? new Set(resolvedStatuses) : null;
  const resolvedPriority = filter.priority
    ? (config.ghConfig.priority_display?.[filter.priority] ?? filter.priority)
    : "";
  const labelList = filter.labels.length > 0 ? filter.labels : null;
  const searchQ = filter.search ? filter.search.toLowerCase() : null;

  // Build reverse map: display name → canonical key, for terminal-status lookup.
  const displayToCanonical = new Map<string, string>();
  for (
    const [canonical, display] of Object.entries(
      config.ghConfig.status_display ?? {},
    )
  ) {
    displayToCanonical.set(display, canonical);
  }

  // Pre-compute set of terminal status display names for backlog scope exclusion.
  const terminalStatuses = new Set<string>();
  for (
    const [canonical, semantics] of Object.entries(
      config.scrumConfig.scrum.status,
    )
  ) {
    if (semantics.terminal && config.ghConfig.status_display[canonical]) {
      terminalStatuses.add(config.ghConfig.status_display[canonical]);
    }
  }

  return (story: Story): boolean => {
    if (keySet) {
      const hasKey = story.kind === "issue" || story.kind === "pr";
      if (!hasKey || !keySet.has(story.key!)) return false;
    }

    if (!hasKeys) {
      if (filter.scope === "sprint") {
        if (story.sprint === null) return false;
        // When sprintItemIds is unavailable (no active iteration in config),
        // fall back to title comparison so past-sprint items are still excluded.
        if (sprintItemIds === null && config.live.iterations.active) {
          if (story.sprint !== config.live.iterations.active.title) return false;
        }
      }
      if (filter.scope === "backlog" && story.sprint !== null) return false;
      // Exclude terminal-status items from sprint and backlog scope when no
      // explicit statuses filter is provided.  Keys bypass this (keySet path
      // above) so direct ID/ref lookups always return the item regardless of
      // status.
      if (
        (filter.scope === "sprint" || filter.scope === "backlog") &&
        statusSet === null &&
        story.status !== null &&
        terminalStatuses.has(story.status)
      ) {
        return false;
      }
    }

    if (sprintItemIds !== null && !sprintItemIds.has(story.ref.id)) return false;

    if (filter.epic_id) {
      const hasEpic = story.kind === "issue" || story.kind === "pr";
      if (!hasEpic || story.epic?.ref.id !== filter.epic_id) return false;
    }

    if (filter.assignee && !story.assignees.includes(filter.assignee)) return false;

    if (labelList && !labelList.every((label) => story.labels.includes(label))) return false;

    if (typeSet && (story.type === null || !typeSet.has(story.type))) return false;

    if (statusSet && (story.status === null || !statusSet.has(story.status))) return false;

    if (resolvedPriority && story.priority !== resolvedPriority) return false;

    if (filter.has_blockers !== undefined) {
      const blocked = story.blocked_by.length > 0;
      if (filter.has_blockers !== blocked) return false;
    }

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
