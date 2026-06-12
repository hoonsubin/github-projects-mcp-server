// =============================================================================
// src/adapters/github/result-normalizer.ts - Result Normalizer
//
// Maps raw PaginationResult nodes to AssemblerOutput (BacklogItemListing[]).
// Sole place in the assembler pipeline that calls buildStoryFromRaw() +
// toItemListing() and populates custom_fields passthrough.
// =============================================================================

import type { GitHubBootState } from "../bootstrap.ts";
import type { PaginationResult } from "../query-pipeline/execution-engine.ts";
import type { AssemblerOutput } from "../assemblers/types.ts";
import { buildStoryFromRaw, resolveDependencyRefs } from "../mappers.ts";
import { toItemListing } from "../../../scrum/utils/listing-mappers.ts";
import type { ItemFieldValue, ProjectItem } from "../types.ts";
import type { BacklogItemListing, Story } from "../../../domain/types.ts";
import { log } from "../../../services/logger.ts";

// Field names that map to canonical top-level properties and must never appear
// in custom_fields. Covers both GH built-ins and the standard configurable set.
// ID-based filtering (canonicalIds) handles renames; name-based is the fallback.
const CANONICAL_FIELD_NAMES = new Set([
  "Title",
  "Assignees",
  "Labels",
  "Milestone",
  "Repository",
  "Status",
  "Priority",
  "Story Points",
  "Sprint",
  "Type",
]);

/**
 * Build a predicate that returns true for field values that are NOT canonical
 * (i.e., should be included in custom_fields passthrough).
 *
 * A field is canonical when its field.id matches one of the configured canonical
 * IDs OR its field.name is in the hardcoded CANONICAL_FIELD_NAMES set.
 */
export const buildNonCanonicalFieldPredicate = (
  config: GitHubBootState,
): (fv: ItemFieldValue) => boolean => {
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

  return (fv: ItemFieldValue): boolean => {
    if (!fv.field?.name) return false;
    if (canonicalIds.has(fv.field.id)) return false;
    if (CANONICAL_FIELD_NAMES.has(fv.field.name)) return false;
    return true;
  };
};

/**
 * Serialize an ItemFieldValue's payload into a plain Record.
 * Only populated keys are included - undefined values are excluded via spread.
 * __typename, color, and optionId are intentionally omitted (GitHub API noise).
 */
export const serializeFieldValuePayload = (
  fv: ItemFieldValue,
): Record<string, unknown> => {
  const ifv = fv.issueFieldValue;
  return {
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
    // Unwrap org-level issue field value (ProjectV2ItemIssueFieldValue).
    // Single-select: name is the display label; text/date/number: value holds the scalar.
    ...(ifv?.name !== undefined ? { name: ifv.name } : {}),
    ...(ifv?.value !== undefined ? { value: ifv.value } : {}),
  };
};

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

  const isNonCanonical = buildNonCanonicalFieldPredicate(config);

  for (const fv of item.fieldValues.nodes) {
    if (!fv.field?.name) {
      log.debug("result-normalizer: unresolvable field name", {
        itemId: item.id,
        fieldTypename: fv.__typename,
      });
      continue;
    }
    if (!isNonCanonical(fv)) continue;
    customFields[fv.field.name] = JSON.stringify(serializeFieldValuePayload(fv));
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

    return {
      items: enriched,
      totalCount: filteredStories.length,
      scopeSummary: { sprint_count: sprintCount, backlog_count: backlogCount },
      dependencyMap: null,
      warnings,
    };
  }
}
