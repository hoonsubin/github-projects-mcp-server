// =============================================================================
// src/adapters/github/internal/result-normalizer.ts - Result Normalizer
//
// Phase 4 of adapter refactoring — maps raw PaginationResult nodes to
// AssemblerOutput (BacklogItemListing[]). The only place that calls
// buildStoryFromRaw() + toItemListing() for the assembler pipeline.
//
// Responsibilities:
//   1. Cast raw nodes to ProjectItem[]
//   2. Map to Story[] via buildStoryFromRaw()
//   3. Apply client-side post-filter
//   4. Resolve dependency refs via resolveDependencyRefs()
//   5. Map to BacklogItemListing[] via toItemListing()
//   6. Populate custom_fields passthrough (all field values + __typename)
//   7. Build scopeSummary
//   8. Return AssemblerOutput with warnings if truncated
// =============================================================================

import type { GitHubBootState } from "../bootstrap.ts";
import type { PaginationResult } from "./execution-engine.ts";
import type { AssemblerOutput } from "./assemblers/types.ts";
import { buildStoryFromRaw, resolveDependencyRefs } from "../mappers.ts";
import { toItemListing } from "../../../scrum/listing-mappers.ts";
import type { ProjectItem } from "../types.ts";
import type { BacklogItemListing, DependencyMap, Story } from "../../../domain/types.ts";

// ── ResultNormalizer ────────────────────────────────────────────────────────

/**
 * Maps raw PaginationResult nodes → AssemblerOutput via the full mapping chain
 * (buildStoryFromRaw → resolveDependencyRefs → toItemListing → enrichment).
 *
 * This is the only place in the assembler pipeline that interprets raw API
 * response nodes as ProjectItems and maps them to domain types.
 *
 * Two entry points:
 *   - normalize() — full pipeline from PaginationResult (Phase 4b assemblers)
 *   - enrichListings() — enrichment only (Phase 4 wiring: used by StoryQueryService)
 *
 * Phase 4: enrichListings() is wired into StoryQueryService.findItems() so that
 * custom_fields passthrough and __typename are populated for all findItems results.
 * The full normalize() pipeline will be wired into assemblers in Phase 4b when
 * they produce real PlatformRequest[] instead of delegating to StoryQueryService.
 */
export class ResultNormalizer {
  constructor(private readonly config: GitHubBootState) {}

  /**
   * Normalize a PaginationResult into AssemblerOutput.
   *
   * @param result    Raw PaginationResult from ExecutionEngine.
   * @param filterFn  Post-filter applied after Story mapping (client-side
   *                  filtering for sprint membership, backlog status, etc.).
   * @param options   Controls dependency map generation and other output features.
   */
  normalize(
    result: PaginationResult,
    filterFn: (story: Story) => boolean,
    options: {
      /** All project items (for dependency ref resolution). */
      readonly allItems: readonly ProjectItem[];
      /** Whether to build the dependency map. */
      readonly includeDependencies: boolean;
      /** Dependency map builder (injected to avoid circular import). */
      readonly buildDependencyMap: (
        stories: readonly Story[],
        allItems: readonly ProjectItem[],
        config: GitHubBootState,
      ) => DependencyMap;
    },
  ): AssemblerOutput {
    const warnings: string[] = [];

    // ── Step 1: Cast raw nodes to ProjectItem[] ─────────────────────────
    const items = result.nodes as ProjectItem[];

    // ── Step 2: Map to Story[] via buildStoryFromRaw ────────────────────
    const allStories = items
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);

    // ── Step 3: Apply client-side post-filter ───────────────────────────
    const filteredStories = allStories.filter(filterFn);

    // ── Step 4: Resolve dependency refs (issue node IDs → project item IDs)
    // resolveDependencyRefs expects mutable ProjectItem[] not readonly
    const mutableAllItems = [...options.allItems];
    const resolvedStories = resolveDependencyRefs(filteredStories, mutableAllItems);

    // ── Step 5: Map to BacklogItemListing[] ─────────────────────────────
    const listings: BacklogItemListing[] = resolvedStories.map((story) => toItemListing(story));

    // ── Step 6: Enrich custom_fields (passthrough + __typename) ─────────
    // Build a lookup from story ref ID → ProjectItem for enrichment
    const itemById = new Map<string, ProjectItem>();
    for (const item of items) {
      itemById.set(item.id, item);
    }

    const enriched: BacklogItemListing[] = listings.map((listing) => {
      const item = itemById.get(listing.ref.id);
      if (!item) return listing;

      // custom_fields is Record<string, string|number|boolean|null>.
      // Rich field values are serialized to JSON strings; callers that need
      // structured access can JSON.parse the value.
      const customFields: Record<string, string | number | boolean | null> = {};

      // Preserve __typename (content type — Issue/PullRequest/DraftIssue)
      if (item.content?.__typename) {
        customFields["__typename"] = item.content.__typename;
      }

      // Passthrough: all field values, keyed by field name.
      for (const fv of item.fieldValues.nodes) {
        if (fv.field?.name) {
          customFields[fv.field.name] = JSON.stringify({
            __typename: fv.__typename,
            ...(fv.iterationId !== undefined ? { iterationId: fv.iterationId } : {}),
            ...(fv.title !== undefined ? { title: fv.title } : {}),
            ...(fv.startDate !== undefined ? { startDate: fv.startDate } : {}),
            ...(fv.duration !== undefined ? { duration: fv.duration } : {}),
            ...(fv.text !== undefined ? { text: fv.text } : {}),
            ...(fv.number !== undefined ? { number: fv.number } : {}),
            ...(fv.date !== undefined ? { date: fv.date } : {}),
            ...(fv.name !== undefined ? { name: fv.name } : {}),
            ...(fv.color !== undefined ? { color: fv.color } : {}),
            ...(fv.optionId !== undefined ? { optionId: fv.optionId } : {}),
            ...(fv.users ? { users: fv.users.nodes.map((u) => u?.login ?? null) } : {}),
            ...(fv.labels
              ? {
                labels: fv.labels.nodes.map((l) => ({
                  name: l?.name ?? "",
                  color: l?.color ?? "",
                })),
              }
              : {}),
            ...(fv.milestone
              ? { milestone: { id: fv.milestone.id, title: fv.milestone.title } }
              : {}),
            ...(fv.repository
              ? {
                repository: {
                  name: fv.repository.name,
                  nameWithOwner: fv.repository.nameWithOwner,
                },
              }
              : {}),
          });
        }
      }

      return { ...listing, custom_fields: customFields };
    });

    // ── Step 7: Build scope summary ─────────────────────────────────────
    const sprintCount = resolvedStories.filter((s) => s.sprint !== null).length;
    const backlogCount = resolvedStories.filter((s) => s.sprint === null).length;

    // ── Step 8: Truncation warning ──────────────────────────────────────
    if (result.truncated) {
      warnings.push(
        `Result truncated after ${result.pagesConsumed} pages. ` +
          `${result.nodes.length} items retrieved of ${result.totalCount} total. ` +
          `Consider narrowing your filter or increasing maxPages.`,
      );
    }

    // ── Step 9: Dependency map (opt-in) ─────────────────────────────────
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

  /**
   * Enrich already-mapped BacklogItemListing[] with custom_fields passthrough.
   *
   * This is the Phase 4 wiring point: StoryQueryService.findItems() applies its
   * own filter chain and mapping, then calls enrichListings() to populate
   * custom_fields (all field values + __typename) for every listing.
   *
   * Without this step, custom_fields is absent from findItems() results —
   * the agent cannot see non-canonical field metadata.
   *
   * @param listings  Already-mapped BacklogItemListing[] from toItemListing().
   * @param projectItems  Raw ProjectItem[] from fetchAllItems() — used for
   *                      custom_fields extraction.
   * @returns Enriched listings with custom_fields populated.
   */
  enrichListings(
    listings: BacklogItemListing[],
    projectItems: readonly ProjectItem[],
  ): BacklogItemListing[] {
    const itemById = new Map<string, ProjectItem>();
    for (const item of projectItems) {
      itemById.set(item.id, item);
    }

    return listings.map((listing) => {
      const item = itemById.get(listing.ref.id);
      if (!item) return listing;

      const customFields: Record<string, string | number | boolean | null> = {
        // Preserve any custom_fields already set on the listing (e.g. from toItemListing)
        ...(listing.custom_fields ?? {}),
      };

      // Preserve __typename (content type — Issue/PullRequest/DraftIssue)
      if (item.content?.__typename) {
        customFields["__typename"] = item.content.__typename;
      }

      // Passthrough: all field values, keyed by field name.
      for (const fv of item.fieldValues.nodes) {
        if (fv.field?.name) {
          customFields[fv.field.name] = JSON.stringify({
            __typename: fv.__typename,
            ...(fv.iterationId !== undefined ? { iterationId: fv.iterationId } : {}),
            ...(fv.title !== undefined ? { title: fv.title } : {}),
            ...(fv.startDate !== undefined ? { startDate: fv.startDate } : {}),
            ...(fv.duration !== undefined ? { duration: fv.duration } : {}),
            ...(fv.text !== undefined ? { text: fv.text } : {}),
            ...(fv.number !== undefined ? { number: fv.number } : {}),
            ...(fv.date !== undefined ? { date: fv.date } : {}),
            ...(fv.name !== undefined ? { name: fv.name } : {}),
            ...(fv.color !== undefined ? { color: fv.color } : {}),
            ...(fv.optionId !== undefined ? { optionId: fv.optionId } : {}),
            ...(fv.users ? { users: fv.users.nodes.map((u) => u?.login ?? null) } : {}),
            ...(fv.labels
              ? {
                labels: fv.labels.nodes.map((l) => ({
                  name: l?.name ?? "",
                  color: l?.color ?? "",
                })),
              }
              : {}),
            ...(fv.milestone
              ? { milestone: { id: fv.milestone.id, title: fv.milestone.title } }
              : {}),
            ...(fv.repository
              ? {
                repository: {
                  name: fv.repository.name,
                  nameWithOwner: fv.repository.nameWithOwner,
                },
              }
              : {}),
          });
        }
      }

      return { ...listing, custom_fields: customFields };
    });
  }
}
