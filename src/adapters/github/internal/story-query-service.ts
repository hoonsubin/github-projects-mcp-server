// =============================================================================
// src/adapters/github/internal/story-query-service.ts - Story Read Operations
//
// Single responsibility: read-side story queries extracted from the backend facade.
// Handles getSprintStories, getBacklogStories, getStoryDetail, fetchAllItems,
// and findItems (unified item search).
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { type BackendCallResult, catchBackend } from "../../../services/error-enrichment.ts";
import type * as GH from "../generated/github-types.ts";
import { isBacklogItem, PaginatedProjectItemFetcher } from "./pagination.ts";
import { ProjectItemsQueryBuilder } from "./project-items-query-builder.ts";
import { resolveSprint, resolveStory } from "./resolver.ts";
import {
  buildCommentList,
  buildEnrichedStory,
  buildLinkedPrList,
  buildStoryFromRaw,
  type IssueDetailsInput,
  resolveDependencyRefs,
  toSprintInfo,
} from "../mappers.ts";
import {
  GET_DRAFT_ISSUE_DETAILS_QUERY,
  GET_ISSUE_DETAILS_QUERY,
  GET_ITEM_FIELDS_QUERY,
} from "../queries.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { ResolvedItemFilter, SprintInfo, StoryDetail } from "../../../scrum/ports.ts";
import type { ItemFieldValue, ProjectItem, ProjectV2ItemRef } from "../types.ts";
import type {
  BacklogItemListing,
  DependencyMap,
  DependencyNode,
  IssueKey,
  ItemSearchResult,
  SprintRef,
  Story,
  StoryRef,
} from "../../../domain/types.ts";
import { toItemListing } from "../../../scrum/listing-mappers.ts";
import { toIssueKey } from "../../../domain/types.ts";

// ── Response types ─────────────────────────────────────────────────────────────

interface GetIssueDetailsResponse {
  node?: IssueDetailsInput | null;
}

/** Query projection of GH.ProjectV2Item.fieldValues - item fields only. */
interface GetItemFieldsQueryNode extends Pick<GH.ProjectV2Item, "fieldValues"> {
  fieldValues?: { nodes: ItemFieldValue[] };
}
interface GetItemFieldsResponse {
  node?: GetItemFieldsQueryNode | null;
}

// ── Dependency map builder (standalone pure function) ──────────────────────────

/**
 * Build a DependencyMap from a filtered story set + all project items.
 * Uses IssueKey as node identifier (always present for IssueStory).
 *
 * Pure function - no I/O, no side effects. Extracted from StoryQueryService
 * for testability and to follow imperative-shell/functional-core separation.
 *
 * Resolves both in-set (resolved) and out-of-scope (unresolved) dependency
 * nodes. Stories must have been passed through resolveDependencyRefs() first
 * so that blocked_by[].ref.id contains project item IDs, not issue node IDs.
 */
export const buildDependencyMap = (
  stories: readonly Story[],
  allItems: readonly ProjectItem[],
  config: GitHubInfraContext["config"],
): DependencyMap => {
  const map: Record<string, DependencyNode> = {};

  // ── Lookups ───────────────────────────────────────────────────────────
  const storyById = new Map<string, Story>();
  for (const story of stories) {
    storyById.set(story.ref.id, story);
  }

  const allItemsById = new Map<string, ProjectItem>();
  for (const item of allItems) {
    allItemsById.set(item.id, item);
  }

  // ── First pass: resolved nodes from filtered stories ───────────────────
  for (const story of stories) {
    if (story.kind !== "issue") continue;

    const key = toIssueKey(story.key!); // kind guard ensures key is string
    const blocked_by_keys: IssueKey[] = [];

    for (const dep of story.blocked_by) {
      blocked_by_keys.push(toIssueKey(dep.key));
    }

    map[key] = {
      key,
      title: story.title,
      status: story.status,
      sprint: story.sprint,
      epic_name: story.epic?.name ?? null,
      story_points: story.story_points,
      priority: story.priority,
      resolved: true,
      blocks: [], // populated by third pass
      blocked_by: blocked_by_keys, // upstream deps - correct direction
    };
  }

  // ── Second pass: unresolved nodes from out-of-set dependencies ────────
  for (const story of stories) {
    if (story.kind !== "issue") continue;
    for (const dep of story.blocked_by) {
      // Already resolved in first pass? Skip.
      if (map[dep.key]) continue;
      // Not in filtered set - look up in allItems
      const item = allItemsById.get(dep.ref.id);
      if (!item) {
        // Cross-repo or off-board: emit a stub node with what we know.
        map[dep.key] = {
          key: toIssueKey(dep.key),
          title: dep.title ?? null,
          status: null,
          sprint: null,
          epic_name: null,
          story_points: null,
          priority: null,
          resolved: false,
          blocks: [],
          blocked_by: [],
        };
        continue;
      }
      const depStory = buildStoryFromRaw(item, config);
      if (!depStory || depStory.kind !== "issue") continue;
      const key = toIssueKey(depStory.key!); // kind guard ensures key is string
      map[key] = {
        key,
        title: depStory.title,
        status: depStory.status,
        sprint: depStory.sprint,
        epic_name: depStory.epic?.name ?? null,
        story_points: depStory.story_points,
        priority: depStory.priority,
        resolved: false,
        blocks: [],
        blocked_by: [],
      };
    }
  }

  // ── Third pass: derive blocks from each node's blocked_by ─────────────
  for (const [nodeKey, node] of Object.entries(map)) {
    for (const depKey of node.blocked_by) {
      if (map[depKey]) {
        map[depKey].blocks.push(toIssueKey(nodeKey));
      }
    }
  }

  return map;
};

// ── StoryQueryService class ────────────────────────────────────────────────────

/**
 * Read-side story operations: sprint stories, backlog stories, and story detail.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class StoryQueryService {
  private readonly projectItemsQuery: string;

  constructor(private readonly ctx: GitHubInfraContext) {
    this.projectItemsQuery = new ProjectItemsQueryBuilder(this.ctx.ghConfig.owner_type)
      .buildQuery();
  }

  async getSprintStories(
    sprint: SprintRef,
  ): Promise<{ stories: Story[]; sprintInfo: SprintInfo }> {
    const iterationId = resolveSprint(sprint, this.ctx.config);
    if (iterationId === null) {
      throw new GitHubApiError(
        "getSprintStories called with a null sprint ref - guard the null case before calling this method.",
        {
          code: "NOT_FOUND",
          recovery: "Call scrum_orient to find active sprints before calling getSprintStories.",
          context: { sprint },
        },
      );
    }
    const iterEntry = this.ctx.config.live.iterations.all.find((i) => i.id === iterationId);
    const sprintInfo = toSprintInfo(iterEntry ?? null);
    if (!sprintInfo) {
      throw new GitHubApiError(
        `Iteration ${iterationId} resolved from config but not found in iterations list.`,
        {
          code: "NOT_FOUND",
          recovery: "The iteration may have been deleted or the config is stale. " +
            "Call scrum_orient to refresh platform state.",
          context: { iterationId },
        },
      );
    }
    const allItems = await this.fetchAllItems();
    const sprintItems = allItems.filter((item) => {
      const fv = item.fieldValues.nodes.find(
        (v) => v.field?.id === this.ctx.config.live.fields.sprintFieldId,
      );
      return fv?.iterationId === iterationId;
    });
    const stories = resolveDependencyRefs(
      sprintItems
        .map((item) => buildStoryFromRaw(item, this.ctx.config))
        .filter((s): s is Story => s !== null),
      allItems,
    );
    return { stories, sprintInfo };
  }

  async getBacklogStories(): Promise<Story[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.ctx, this.projectItemsQuery);
    const backlogItems = await fetcher.collect((item) =>
      isBacklogItem(item, this.ctx.config.live.fields.sprintFieldId)
    );
    return resolveDependencyRefs(
      backlogItems
        .map((item) => buildStoryFromRaw(item, this.ctx.config))
        .filter((s): s is Story => s !== null),
      backlogItems,
    );
  }

  async getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>> {
    const resolved = await resolveStory(ref, this.ctx.gh);

    // Draft Issues have no GitHub Issue node - fetch project item directly
    if (!resolved.issueId) {
      return this._getDraftIssueDetail(resolved.itemId);
    }

    const warnings: string[] = [];

    // issueData carries body, comments, timeline - optional sub-query
    const { value: issueData, warnings: issueWarnings } = await catchBackend(() =>
      this.ctx.gh.graphql<GetIssueDetailsResponse>(GET_ISSUE_DETAILS_QUERY, {
        issueId: resolved.issueId!,
      })
    );
    warnings.push(...issueWarnings);

    // itemData carries custom field values - optional sub-query
    const { value: itemData, warnings: fieldWarnings } = await catchBackend(() =>
      this.ctx.gh.graphql<GetItemFieldsResponse>(GET_ITEM_FIELDS_QUERY, {
        itemId: resolved.itemId,
      })
    );
    warnings.push(...fieldWarnings);

    const issue = issueData?.node;
    if (!issue || issue.number === null) {
      throw new GitHubApiError(
        `Issue ${resolved.issueId} could not be fetched.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "The issue may have been deleted from the repository. " +
            "Refresh your story list with scrum_orient or scrum_find_items.",
          context: { issueId: resolved.issueId, itemId: resolved.itemId },
        },
      );
    }

    const story = buildEnrichedStory(
      issue,
      resolved.itemId,
      itemData?.node?.fieldValues?.nodes ?? [],
      this.ctx.config,
    );
    const comments = issueData ? buildCommentList(issue.comments?.nodes ?? []) : null;
    const linked_artifacts = issueData ? buildLinkedPrList(issue.timelineItems?.nodes ?? []) : null;

    return { value: { story, comments, linked_artifacts }, warnings };
  }

  private async _getDraftIssueDetail(itemId: string): Promise<BackendCallResult<StoryDetail>> {
    /** Query projection of GH.ProjectV2Item for draft issue details. */
    interface GetDraftIssueDetailsQueryNode extends ProjectV2ItemRef {
      content?: unknown;
      fieldValues?: { nodes: ItemFieldValue[] };
    }
    interface GetDraftIssueDetailsResponse {
      node?: GetDraftIssueDetailsQueryNode | null;
    }

    const data = await this.ctx.gh.graphql<GetDraftIssueDetailsResponse>(
      GET_DRAFT_ISSUE_DETAILS_QUERY,
      { itemId },
    );

    const node = data.node;
    if (!node) {
      throw new GitHubApiError(`Project item ${itemId} could not be fetched.`, {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: "The item may have been deleted from the project. " +
          "Refresh your story list with scrum_orient or scrum_find_items.",
        context: { itemId },
      });
    }

    const item: ProjectItem = {
      id: itemId,
      type: (node.type ?? "DRAFT_ISSUE") as ProjectItem["type"],
      createdAt: node.createdAt ?? "",
      updatedAt: node.updatedAt ?? "",
      isArchived: node.isArchived ?? false,
      content: node.content as ProjectItem["content"],
      fieldValues: { nodes: node.fieldValues?.nodes ?? [] },
    };

    const story = buildStoryFromRaw(item, this.ctx.config);
    if (!story) {
      throw new GitHubApiError(
        `Draft Issue ${itemId} is missing required content fields.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "The item may have been deleted or corrupted in the project.",
          context: { itemId },
        },
      );
    }

    // Draft Issues have no GitHub Issue node - no comments or linked artifacts available
    return { value: { story, comments: null, linked_artifacts: null }, warnings: [] };
  }

  /** Fetch all project items (including issues, PRs, and draft issues). */
  fetchAllItems(): Promise<ProjectItem[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.ctx, this.projectItemsQuery);
    return fetcher.collect(() => true);
  }

  /**
   * Compute work completion percentage for a sprint.
   * Returns completed points and total committed points.
   * When no items have story points, returns { completed: 0, total: 0 }
   * (workPct = 0 - no regression from current behavior).
   */
  async computeSprintCompletion(
    iterationId: string,
  ): Promise<{ completed: number; total: number }> {
    const allItems = await this.fetchAllItems();

    // Filter items assigned to this iteration
    const sprintItems = allItems.filter((item) => {
      const fv = item.fieldValues.nodes.find(
        (v) => v.field?.id === this.ctx.config.live.fields.sprintFieldId,
      );
      return fv?.iterationId === iterationId;
    });

    const stories = sprintItems
      .map((item) => buildStoryFromRaw(item, this.ctx.config))
      .filter((s): s is Story => s !== null);

    // Build reverse map: display name → canonical status key.
    // story.status holds the display name (e.g. "Done"), but terminal
    // semantics are keyed by canonical key (e.g. "done") in scrumConfig.scrum.status.
    const statusReverseMap = new Map<string, string>();
    const statusDisplay = this.ctx.config.ghConfig.status_display ?? {};
    for (const [canonical, display] of Object.entries(statusDisplay)) {
      statusReverseMap.set(display, canonical);
    }

    let completed = 0;
    let total = 0;

    for (const story of stories) {
      const points = story.story_points ?? 0;
      total += points;
      if (story.status) {
        const canonicalKey = statusReverseMap.get(story.status);
        if (canonicalKey && this.ctx.config.scrumConfig.scrum.status[canonicalKey]?.terminal) {
          completed += points;
        }
      }
    }

    return { completed, total };
  }

  // ── Unified item search ──────────────────────────────────────────────────────

  /**
   * Find items matching the given filter across all PBIs.
   * Replaces getSprintStories() and getBacklogStories().
   *
   * Filters are applied in order of selectivity (most selective first):
   * scope → keys → sprint_ref → epic_id → assignee → labels → types →
   * statuses → priority → search → estimated → limit.
   */
  async findItems(
    filter: ResolvedItemFilter,
  ): Promise<ItemSearchResult> {
    const allItems = await this.fetchAllItems();

    // Map to domain Stories
    let stories: Story[] = allItems
      .map((item) => buildStoryFromRaw(item, this.ctx.config))
      .filter((s): s is Story => s !== null);

    // Apply filters in order of selectivity
    // keys takes priority over scope - when keys are provided, scope is bypassed
    // so that items are found regardless of which bucket (sprint or backlog) they are in
    const hasKeys = filter.keys.length > 0;
    stories = this.filterByKeys(stories, filter.keys);
    stories = this.filterByScope(stories, filter.scope, hasKeys);
    stories = this.filterBySprintRef(stories, allItems, filter.sprint_ref);
    stories = this.filterByEpicId(stories, filter.epic_id);
    stories = this.filterByAssignee(stories, filter.assignee);
    stories = this.filterByLabels(stories, filter.labels);
    stories = this.filterByTypes(stories, filter.types);
    stories = this.filterByStatuses(stories, filter.statuses);
    stories = this.filterByPriority(stories, filter.priority);
    stories = this.filterBySearch(stories, filter.search);
    stories = this.filterByEstimated(stories, filter.estimated);

    // Resolve dependency refs: map issue node IDs → project item IDs
    // (called in getSprintStories/getBacklogStories but missing from findItems)
    stories = resolveDependencyRefs(stories, allItems);

    // ── Scope summary (before limit) ──────────────────────────────────────
    const totalCount = stories.length;

    // ── Scope counts ──────────────────────────────────────────────────────
    const sprintCount = stories.filter((s) => s.sprint !== null).length;
    const backlogCount = stories.filter((s) => s.sprint === null).length;

    // ── Map to BacklogItemListing[] ───────────────────────────────────────
    let items: BacklogItemListing[] = stories.map((story) => toItemListing(story));

    // Fix sprint.ref.id from hardcoded "" to actual iteration ID
    items = items.map((item) => {
      if (item.sprint.name) {
        const iterEntry = this.ctx.config.live.iterations.all.find(
          (i) => i.title === item.sprint.name,
        );
        if (iterEntry) {
          return { ...item, sprint: { name: item.sprint.name, ref: { id: iterEntry.id } } };
        }
        // Sprint name exists but no matching iteration - config is stale
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
      return item;
    });

    // ── Limit ─────────────────────────────────────────────────────────────
    items = items.slice(0, filter.limit);

    // ── Dependency map (opt-in via include_dependencies filter) ──
    const dependencyMap: DependencyMap | null = filter.include_dependencies
      ? this.buildDependencyMap(stories, allItems)
      : null;

    return {
      items,
      total_count: totalCount,
      scope_summary: {
        sprint_count: sprintCount,
        backlog_count: backlogCount,
      },
      dependency_map: dependencyMap,
    };
  }

  // ── Filter extraction helpers ────────────────────────────────────────────────

  private filterByScope(stories: Story[], scope: string | undefined, hasKeys: boolean): Story[] {
    // When keys are provided, scope is bypassed - keys take priority
    if (hasKeys) return stories;
    if (scope === "sprint") {
      return stories.filter((s) => s.sprint !== null);
    }
    if (scope === "backlog") {
      return stories.filter((s) => s.sprint === null);
    }
    return stories;
  }

  private filterByKeys(stories: Story[], keys: readonly string[]): Story[] {
    if (keys.length === 0) return stories;
    const keySet = new Set(keys);
    return stories.filter((s) => s.kind === "issue" && keySet.has(s.key!));
  }

  private filterBySprintRef(
    stories: Story[],
    allItems: ProjectItem[],
    sprintRef: string | null,
  ): Story[] {
    if (sprintRef === null) return stories;
    const iterationId = resolveSprint(sprintRef, this.ctx.config);
    if (iterationId === null) return [];
    const sprintItemIds = new Set(
      allItems
        .filter((item) => {
          const fv = item.fieldValues.nodes.find(
            (v) => v.field?.id === this.ctx.config.live.fields.sprintFieldId,
          );
          return fv?.iterationId === iterationId;
        })
        .map((item) => item.id),
    );
    return stories.filter((s) => sprintItemIds.has(s.ref.id));
  }

  private filterByEpicId(stories: Story[], epicId: string | undefined): Story[] {
    if (!epicId) return stories;
    return stories.filter((s) => s.kind === "issue" && s.epic?.ref.id === epicId);
  }

  private filterByAssignee(stories: Story[], assignee: string | undefined): Story[] {
    if (!assignee) return stories;
    return stories.filter((s) => s.assignees.includes(assignee));
  }

  private filterByLabels(stories: Story[], labels: readonly string[]): Story[] {
    if (labels.length === 0) return stories;
    return stories.filter((s) => labels.every((label) => s.labels.includes(label)));
  }

  private filterByTypes(stories: Story[], types: readonly string[]): Story[] {
    if (types.length === 0) return stories;
    const typeSet = new Set(types);
    return stories.filter((s) => s.type !== null && typeSet.has(s.type));
  }

  private filterByStatuses(stories: Story[], statuses: readonly string[]): Story[] {
    if (statuses.length === 0) return stories;
    const statusSet = new Set(statuses);
    return stories.filter((s) => s.status !== null && statusSet.has(s.status));
  }

  private filterByPriority(stories: Story[], priority: string | undefined): Story[] {
    if (!priority) return stories;
    return stories.filter((s) => s.priority === priority);
  }

  private filterBySearch(stories: Story[], search: string | undefined): Story[] {
    if (!search) return stories;
    const q = search.toLowerCase();
    return stories.filter((s) =>
      s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)
    );
  }

  private filterByEstimated(stories: Story[], estimated: boolean | undefined): Story[] {
    if (estimated === undefined) return stories;
    if (estimated) {
      return stories.filter((s) => (s.story_points ?? 0) > 0);
    }
    return stories.filter((s) => (s.story_points ?? 0) === 0);
  }

  // ── Dependency map builder ──────────────────────────────────────────────────

  /**
   * Build a DependencyMap from the filtered story set + all project items.
   * Thin delegation wrapper - delegates to the standalone pure function below.
   */
  private buildDependencyMap(
    stories: readonly Story[],
    allItems: readonly ProjectItem[],
  ): DependencyMap {
    return buildDependencyMap(stories, allItems, this.ctx.config);
  }
}
