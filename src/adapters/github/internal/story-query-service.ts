// =============================================================================
// src/adapters/github/internal/story-query-service.ts — Story Read Operations
//
// Single responsibility: read-side story queries extracted from the backend facade.
// Handles getSprintStories, getBacklogStories, getStoryDetail, fetchAllItems,
// and findItems (unified item search).
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { SprintNotScheduledError } from "../../../domain/errors.ts";
import type * as GH from "../generated/github-types.ts";
import type { GitHubClient } from "./http-client.ts";
import { isBacklogItem, PaginatedProjectItemFetcher } from "./pagination.ts";
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
import type { RuntimeConfig } from "../config-loader.ts";
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

/** Query projection of GH.ProjectV2Item.fieldValues — item fields only. */
interface GetItemFieldsQueryNode extends Pick<GH.ProjectV2Item, "fieldValues"> {
  fieldValues?: { nodes: ItemFieldValue[] };
}
interface GetItemFieldsResponse {
  node?: GetItemFieldsQueryNode | null;
}

// ── StoryQueryService class ────────────────────────────────────────────────────

/**
 * Read-side story operations: sprint stories, backlog stories, and story detail.
 * Injected into GitHubProjectBackend via constructor (DIP).
 */
export class StoryQueryService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  async getSprintStories(
    sprint: SprintRef,
  ): Promise<{ stories: Story[]; sprintInfo: SprintInfo }> {
    const iterationId = resolveSprint(sprint, this.config);
    if (iterationId === null) {
      throw new SprintNotScheduledError(
        "current",
        "getSprintStories called with a null sprint ref — guard the null case before calling this method.",
      );
    }
    const iterEntry = this.config.iterations.all.find((i) => i.id === iterationId);
    const sprintInfo = toSprintInfo(iterEntry ?? null);
    if (!sprintInfo) {
      throw new SprintNotScheduledError(
        "current",
        `Iteration ${iterationId} resolved from config but not found in iterations list.`,
      );
    }
    const allItems = await this.fetchAllItems();
    const sprintItems = allItems.filter((item) => {
      const fv = item.fieldValues.nodes.find(
        (v) => v.field?.id === this.config.fields.sprintFieldId,
      );
      return fv?.iterationId === iterationId;
    });
    const stories = resolveDependencyRefs(
      sprintItems
        .map((item) => buildStoryFromRaw(item, this.config))
        .filter((s): s is Story => s !== null),
      allItems,
    );
    return { stories, sprintInfo };
  }

  async getBacklogStories(): Promise<Story[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.config, this.gh, {
      includeIssueContent: true,
      includePRContent: false,
      includeDraftIssueContent: true,
      pageSize: 100,
    });
    const backlogItems = await fetcher.collect((item) =>
      isBacklogItem(item, this.config.fields.sprintFieldId)
    );
    return resolveDependencyRefs(
      backlogItems
        .map((item) => buildStoryFromRaw(item, this.config))
        .filter((s): s is Story => s !== null),
      backlogItems,
    );
  }

  async getStoryDetail(ref: StoryRef): Promise<StoryDetail> {
    const resolved = await resolveStory(ref, this.gh);

    // Draft Issues have no GitHub Issue node — fetch project item directly
    if (!resolved.issueId) {
      return this._getDraftIssueDetail(resolved.itemId);
    }

    const [issueData, itemData] = await Promise.all([
      this.gh.graphql<GetIssueDetailsResponse>(GET_ISSUE_DETAILS_QUERY, {
        issueId: resolved.issueId,
      }),
      this.gh.graphql<GetItemFieldsResponse>(GET_ITEM_FIELDS_QUERY, { itemId: resolved.itemId }),
    ]);
    const issue = issueData.node;
    if (!issue || issue.number === null) {
      throw new GitHubApiError(
        `Issue ${resolved.issueId} could not be fetched.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "The issue may have been deleted from the repository. " +
            "Refresh your story list with scrum_get_sprint or scrum_get_backlog.",
          context: { issueId: resolved.issueId, itemId: resolved.itemId },
        },
      );
    }
    const story = buildEnrichedStory(
      issue,
      resolved.itemId,
      itemData.node?.fieldValues?.nodes ?? [],
      this.config,
    );
    const comments = buildCommentList(issue.comments?.nodes ?? []);
    const linked_artifacts = buildLinkedPrList(issue.timelineItems?.nodes ?? []);
    return { story, comments, linked_artifacts };
  }

  private async _getDraftIssueDetail(itemId: string): Promise<StoryDetail> {
    /** Query projection of GH.ProjectV2Item for draft issue details. */
    interface GetDraftIssueDetailsQueryNode extends ProjectV2ItemRef {
      content?: unknown;
      fieldValues?: { nodes: ItemFieldValue[] };
    }
    interface GetDraftIssueDetailsResponse {
      node?: GetDraftIssueDetailsQueryNode | null;
    }

    const data = await this.gh.graphql<GetDraftIssueDetailsResponse>(
      GET_DRAFT_ISSUE_DETAILS_QUERY,
      { itemId },
    );

    const node = data.node;
    if (!node) {
      throw new GitHubApiError(`Project item ${itemId} could not be fetched.`, {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: "The item may have been deleted from the project. " +
          "Refresh your story list with scrum_get_sprint or scrum_get_backlog.",
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

    const story = buildStoryFromRaw(item, this.config);
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

    // Draft Issues have no GitHub Issue node — no comments or linked artifacts available
    return { story, comments: [], linked_artifacts: [] };
  }

  /** Fetch all project items (including issues, PRs, and draft issues). */
  fetchAllItems(): Promise<ProjectItem[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.config, this.gh, {
      includeIssueContent: true,
      includePRContent: true,
      includeDraftIssueContent: true,
      pageSize: 100,
    });
    return fetcher.collect();
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
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);

    // Apply filters in order of selectivity
    stories = this.filterByScope(stories, filter.scope);
    stories = this.filterByKeys(stories, filter.keys);
    stories = this.filterBySprintRef(stories, allItems, filter.sprint_ref);
    stories = this.filterByEpicId(stories, filter.epic_id);
    stories = this.filterByAssignee(stories, filter.assignee);
    stories = this.filterByLabels(stories, filter.labels);
    stories = this.filterByTypes(stories, filter.types);
    stories = this.filterByStatuses(stories, filter.statuses);
    stories = this.filterByPriority(stories, filter.priority);
    stories = this.filterBySearch(stories, filter.search);
    stories = this.filterByEstimated(stories, filter.estimated);

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
        const iterEntry = this.config.iterations.all.find(
          (i) => i.title === item.sprint.name,
        );
        if (iterEntry) {
          return { ...item, sprint: { name: item.sprint.name, ref: { id: iterEntry.id } } };
        }
      }
      return item;
    });

    // ── Limit ─────────────────────────────────────────────────────────────
    items = items.slice(0, filter.limit);

    // ── Dependency map (opt-in) ───────────────────────────────────────────
    let dependencyMap: DependencyMap | null = null;
    if (filter.include_dependencies) {
      dependencyMap = this.buildDependencyMap(stories, allItems);
    }

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

  private filterByScope(stories: Story[], scope: string | undefined): Story[] {
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
    return stories.filter((s) => s.kind === "issue" && keySet.has(s.key));
  }

  private filterBySprintRef(
    stories: Story[],
    allItems: ProjectItem[],
    sprintRef: string | null,
  ): Story[] {
    if (sprintRef === null) return stories;
    const iterationId = resolveSprint(sprintRef, this.config);
    if (iterationId === null) return [];
    const sprintItemIds = new Set(
      allItems
        .filter((item) => {
          const fv = item.fieldValues.nodes.find(
            (v) => v.field?.id === this.config.fields.sprintFieldId,
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
   * Build a DependencyMap from the filtered story set.
   * Uses IssueKey as node identifier (always present for IssueStory).
   */
  private buildDependencyMap(
    stories: readonly Story[],
    _allItems: readonly ProjectItem[],
  ): DependencyMap {
    const map: Record<string, DependencyNode> = {};

    // Build a lookup: ref.id → Story
    const storyById = new Map<string, Story>();
    for (const story of stories) {
      storyById.set(story.ref.id, story);
    }

    for (const story of stories) {
      if (story.kind !== "issue") continue;

      const key = toIssueKey(story.key);
      const blocks: IssueKey[] = [];

      // Find stories that this story blocks via blocked_by references
      for (const dep of story.blocked_by) {
        const target = storyById.get(dep.ref.id);
        if (target && target.kind === "issue") {
          blocks.push(toIssueKey(target.key));
        }
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
        blocks,
        blocked_by: [],
      };
    }

    // Second pass: build reverse dependency map without mutation during iteration
    const reverseDeps: Record<string, IssueKey[]> = {};
    for (const [nodeKey, node] of Object.entries(map)) {
      for (const blockedKey of node.blocks) {
        if (!reverseDeps[blockedKey]) reverseDeps[blockedKey] = [];
        reverseDeps[blockedKey].push(toIssueKey(nodeKey));
      }
    }

    // Apply blocked_by without mutation during iteration
    for (const [nodeKey, node] of Object.entries(map)) {
      node.blocked_by = reverseDeps[nodeKey] ?? [];
    }

    return map;
  }
}
