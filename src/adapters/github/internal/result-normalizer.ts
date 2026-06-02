// =============================================================================
// src/adapters/github/internal/result-normalizer.ts - Result Normalizer
//
// Maps raw PaginationResult nodes to AssemblerOutput (BacklogItemListing[]).
// Sole place in the assembler pipeline that calls buildStoryFromRaw() +
// toItemListing() and populates custom_fields passthrough.
// =============================================================================

import type { GitHubBootState } from "../bootstrap.ts";
import type { PaginationResult } from "./execution-engine.ts";
import type { AssemblerOutput } from "./assemblers/types.ts";
import { buildStoryFromRaw, resolveDependencyRefs } from "../mappers.ts";
import { toItemListing } from "../../../scrum/listing-mappers.ts";
import type { ProjectItem } from "../types.ts";
import type { BacklogItemListing, DependencyMap, Story } from "../../../domain/types.ts";

// Field names that map to canonical top-level properties and must never appear
// in custom_fields. Covers both GH built-ins and the standard configurable set.
// ID-based filtering (canonicalIds) handles renames; name-based is the fallback.
const CANONICAL_FIELD_NAMES = new Set([
  "Title", "Assignees", "Labels", "Milestone", "Repository",
  "Status", "Priority", "Story Points", "Sprint", "Type",
]);

/** Populate custom_fields passthrough for non-canonical board field values only. */
const enrichListingCustomFields = (
  listing: BacklogItemListing,
  item: ProjectItem,
  config: GitHubBootState,
): BacklogItemListing => {
  const customFields: Record<string, string | number | boolean | null> = {
    ...(listing.custom_fields ?? {}),
  };

  if (item.content?.__typename) {
    customFields["__typename"] = item.content.__typename;
  }

  const { fields, typeResolution } = config.live;
  const canonicalIds = new Set<string>(
    [
      fields.statusFieldId,
      fields.sprintFieldId,
      fields.storyPointsFieldId,
      fields.priorityFieldId,
      fields.epicFieldId,
      fields.assigneeFieldId,
      typeResolution.source === "board_field" ? typeResolution.fieldId : null,
    ].filter((id): id is string => id !== null && id !== ""),
  );

  for (const fv of item.fieldValues.nodes) {
    if (!fv.field?.name) continue;
    if (canonicalIds.has(fv.field.id)) continue;
    if (CANONICAL_FIELD_NAMES.has(fv.field.name)) continue;

    customFields[fv.field.name] = JSON.stringify({
      // __typename, color, optionId intentionally omitted — GitHub API noise
      ...(fv.iterationId !== undefined ? { iterationId: fv.iterationId } : {}),
      ...(fv.title !== undefined ? { title: fv.title } : {}),
      ...(fv.startDate !== undefined ? { startDate: fv.startDate } : {}),
      ...(fv.duration !== undefined ? { duration: fv.duration } : {}),
      ...(fv.text !== undefined ? { text: fv.text } : {}),
      ...(fv.number !== undefined ? { number: fv.number } : {}),
      ...(fv.date !== undefined ? { date: fv.date } : {}),
      ...(fv.name !== undefined ? { name: fv.name } : {}),
      ...(fv.users ? { users: fv.users.nodes.map((u) => u?.login ?? null) } : {}),
      ...(fv.labels ? { labels: fv.labels.nodes.map((l) => ({ name: l?.name ?? "" })) } : {}),
      ...(fv.milestone ? { milestone: { id: fv.milestone.id, title: fv.milestone.title } } : {}),
      ...(fv.repository
        ? { repository: { name: fv.repository.name, nameWithOwner: fv.repository.nameWithOwner } }
        : {}),
    });
  }

  return { ...listing, custom_fields: customFields };
};

/**
 * Maps raw PaginationResult nodes → AssemblerOutput via the full mapping chain
 * (buildStoryFromRaw → resolveDependencyRefs → toItemListing → enrichment).
 */
export class ResultNormalizer {
  constructor(private readonly config: GitHubBootState) {}

  normalize(
    result: PaginationResult,
    filterFn: (story: Story) => boolean,
    options: {
      readonly allItems: readonly ProjectItem[];
      readonly includeDependencies: boolean;
      readonly buildDependencyMap: (
        stories: readonly Story[],
        allItems: readonly ProjectItem[],
        config: GitHubBootState,
      ) => DependencyMap;
    },
  ): AssemblerOutput {
    const warnings: string[] = [];
    const items = result.nodes as ProjectItem[];

    const allStories = items
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);

    const filteredStories = allStories.filter(filterFn);

    const mutableAllItems = [...options.allItems];
    const resolvedStories = resolveDependencyRefs(filteredStories, mutableAllItems);

    const listings: BacklogItemListing[] = resolvedStories.map((story) => toItemListing(story));

    const itemById = new Map<string, ProjectItem>();
    for (const item of items) {
      itemById.set(item.id, item);
    }

    const enriched = listings.map((listing) => {
      const item = itemById.get(listing.ref.id);
      return item ? enrichListingCustomFields(listing, item, this.config) : listing;
    });

    const sprintCount = resolvedStories.filter((s) => s.sprint !== null).length;
    const backlogCount = resolvedStories.filter((s) => s.sprint === null).length;

    if (result.truncated) {
      warnings.push(
        `Result truncated after ${result.pagesConsumed} pages. ` +
          `${result.nodes.length} items retrieved of ${result.totalCount} total. ` +
          `Consider narrowing your filter or increasing maxPages.`,
      );
    }

    const dependencyMap = options.includeDependencies
      ? options.buildDependencyMap(resolvedStories, options.allItems, this.config)
      : null;

    return {
      items: enriched,
      totalCount: filteredStories.length,
      scopeSummary: { sprint_count: sprintCount, backlog_count: backlogCount },
      dependencyMap,
      warnings,
    };
  }
}
