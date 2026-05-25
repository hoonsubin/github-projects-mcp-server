// =============================================================================
// src/adapters/github/internal/story-query-service.ts — Story Read Operations
//
// Single responsibility: read-side story queries extracted from the backend facade.
// Handles getSprintStories, getBacklogStories, getStoryDetail, fetchAllItems,
// and findItems (unified item search).
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { SprintNotScheduledError } from "../../../domain/errors.ts";
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
import type { ItemFieldValue, ProjectItem } from "../types.ts";
import type {
  DependencyMap,
  DependencyNode,
  IssueKey,
  ItemListing as _ItemListing,
  ItemSearchResult,
  ItemType,
  SprintRef,
  Story,
  StoryRef,
} from "../../../domain/types.ts";
import { toItemListing } from "../../../scrum/listing-mappers.ts";
import { toIssueKey } from "../../../domain/types.ts";

// ── Response types ─────────────────────────────────────────────────────────────

interface GetIssueDetailsResponse {
  node?: {
    id?: string;
    number?: number;
    title?: string;
    body?: string;
    url?: string;
    createdAt?: string;
    updatedAt?: string;
    assignees?: { nodes: Array<{ login: string }> };
    labels?: { nodes: Array<{ name: string }> };
    milestone?: { id: string; title: string } | null;
    comments?: {
      nodes: Array<{
        id: string;
        author?: { login: string } | null;
        body: string;
        createdAt: string;
        url: string;
      }>;
    };
    timelineItems?: {
      nodes: Array<{
        source?: {
          number?: number;
          title?: string;
          url?: string;
          state?: string;
          isDraft?: boolean;
        } | null;
      }>;
    };
  } | null;
}

interface GetItemFieldsResponse {
  node?: { fieldValues?: { nodes: ItemFieldValue[] } } | null;
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
      issue as IssueDetailsInput,
      resolved.itemId,
      itemData.node?.fieldValues?.nodes ?? [],
      this.config,
    );
    const comments = buildCommentList(issue.comments?.nodes ?? []);
    const linked_artifacts = buildLinkedPrList(issue.timelineItems?.nodes ?? []);
    return { story, comments, linked_artifacts };
  }

  private async _getDraftIssueDetail(itemId: string): Promise<StoryDetail> {
    interface GetDraftIssueDetailsResponse {
      node?: {
        id?: string;
        type?: string;
        createdAt?: string;
        updatedAt?: string;
        isArchived?: boolean;
        content?: unknown;
        fieldValues?: { nodes: ItemFieldValue[] };
      } | null;
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

    // ── Scope filter ──────────────────────────────────────────────────────
    if (filter.scope === "sprint") {
      stories = stories.filter((s) => s.sprint !== null);
    } else if (filter.scope === "backlog") {
      stories = stories.filter((s) => s.sprint === null);
    }
    // "all" → no scope filter

    // ── Keys filter ───────────────────────────────────────────────────────
    if (filter.keys.length > 0) {
      const keySet = new Set(filter.keys);
      stories = stories.filter((s) => s.kind === "issue" && keySet.has(s.key));
    }

    // ── Sprint ref filter ─────────────────────────────────────────────────
    if (filter.sprint_ref !== null) {
      const iterationId = resolveSprint(filter.sprint_ref as SprintRef, this.config);
      if (iterationId === null) {
        stories = [];
      } else {
        // Filter by items that have the sprint field with matching iteration ID
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
        stories = stories.filter((s) => sprintItemIds.has(s.ref.id));
      }
    }

    // ── Epic ID filter ────────────────────────────────────────────────────
    if (filter.epic_id) {
      stories = stories.filter((s) => s.kind === "issue" && s.epic?.ref.id === filter.epic_id);
    }

    // ── Assignee filter ───────────────────────────────────────────────────
    if (filter.assignee) {
      stories = stories.filter((s) => s.assignees.includes(filter.assignee));
    }

    // ── Labels filter (ALL must match) ────────────────────────────────────
    if (filter.labels.length > 0) {
      stories = stories.filter((s) => filter.labels.every((label) => s.labels.includes(label)));
    }

    // ── Types filter ──────────────────────────────────────────────────────
    if (filter.types.length > 0) {
      const typeSet = new Set(filter.types);
      stories = stories.filter((s) => s.type !== null && typeSet.has(s.type));
    }

    // ── Statuses filter ───────────────────────────────────────────────────
    if (filter.statuses.length > 0) {
      const statusSet = new Set(filter.statuses);
      stories = stories.filter((s) => s.status !== null && statusSet.has(s.status));
    }

    // ── Priority filter ───────────────────────────────────────────────────
    if (filter.priority) {
      stories = stories.filter((s) => s.priority === filter.priority);
    }

    // ── Search filter (case-insensitive substring on title + body) ────────
    if (filter.search) {
      const q = filter.search.toLowerCase();
      stories = stories.filter((s) =>
        s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)
      );
    }

    // ── Estimated filter ──────────────────────────────────────────────────
    if (filter.estimated !== undefined) {
      if (filter.estimated) {
        stories = stories.filter((s) => (s.story_points ?? 0) > 0);
      } else {
        stories = stories.filter((s) => (s.story_points ?? 0) === 0);
      }
    }

    // ── Scope summary (before limit) ──────────────────────────────────────
    const totalCount = stories.length;

    // ── Map to ItemListing[] ──────────────────────────────────────────────
    let items = stories.map((story) => toItemListing(story));

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
    let dependencyMap: DependencyMap | undefined;
    if (filter.include_dependencies) {
      dependencyMap = this.buildDependencyMap(stories, allItems);
    }

    return {
      items,
      scope_summary: {
        total_count: totalCount,
        limit: filter.limit,
        scope: filter.scope,
        filters_applied: {
          search: filter.search || undefined,
          keys: filter.keys.length > 0 ? filter.keys : undefined,
          types: filter.types.length > 0 ? (filter.types as ItemType[]) : undefined,
          statuses: filter.statuses.length > 0 ? filter.statuses : undefined,
          priority: filter.priority || undefined,
          epic_id: filter.epic_id || undefined,
          labels: filter.labels.length > 0 ? filter.labels : undefined,
          assignee: filter.assignee || undefined,
          sprint_ref: filter.sprint_ref ?? undefined,
        },
      },
      dependency_map: dependencyMap,
    };
  }

  // ── Dependency map builder ──────────────────────────────────────────────────

  /**
   * Build a DependencyMap from the filtered story set.
   * Uses IssueKey as node identifier (always present for IssueStory).
   */
  private buildDependencyMap(
    stories: Story[],
    _allItems: ProjectItem[],
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
        epic: story.epic ? { ref: { id: story.epic.ref.id }, name: story.epic.name } : null,
        story_points: story.story_points,
        priority: story.priority,
        blocks,
      };
    }

    return map;
  }
}
