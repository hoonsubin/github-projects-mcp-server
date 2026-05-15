// =============================================================================
// src/adapters/github/internal/story-query-service.ts — Story Read Operations
//
// Single responsibility: read-side story queries extracted from the backend facade.
// Handles getSprintStories, getBacklogStories, getStoryDetail, and fetchAllItems.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type { GitHubClient } from "./http-client.ts";
import { isBacklogItem, PaginatedProjectItemFetcher } from "./pagination.ts";
import { resolveSprint, resolveStory } from "./resolver.ts";
import {
  buildCommentList,
  buildEnrichedStory,
  buildLinkedPrList,
  buildStoryFromRaw,
  toSprintInfo,
  type IssueDetailsInput,
} from "../mappers.ts";
import { GET_ISSUE_DETAILS_QUERY, GET_ITEM_FIELDS_QUERY } from "../queries.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { SprintInfo, StoryDetail } from "../../../scrum/ports.ts";
import type { ItemFieldValue, ProjectItem } from "../types.ts";
import type { SprintRef, Story, StoryRef } from "../../../domain/types.ts";

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
    milestone?: { title: string } | null;
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
  ): Promise<{ stories: Story[]; sprintInfo: SprintInfo | null }> {
    const iterationId = resolveSprint(sprint, this.config);
    if (iterationId === null) {
      return { stories: [], sprintInfo: null };
    }
    const iterEntry = this.config.iterations.all.find((i) => i.id === iterationId);
    const allItems = await this.fetchAllItems();
    const sprintItems = allItems.filter((item) => {
      const fv = item.fieldValues.nodes.find(
        (v) => v.field?.id === this.config.fields.sprintFieldId,
      );
      return fv?.iterationId === iterationId;
    });
    const stories = sprintItems
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);
    return { stories, sprintInfo: toSprintInfo(iterEntry ?? null) };
  }

  async getBacklogStories(): Promise<Story[]> {
    const fetcher = new PaginatedProjectItemFetcher(this.config, this.gh, {
      sprintFieldIds: [this.config.fields.sprintFieldId],
      includeIssueContent: true,
      includePRContent: false,
      includeDraftIssueContent: false,
      pageSize: 100,
    });
    const backlogItems = await fetcher.collect((item) =>
      isBacklogItem(item, this.config.fields.sprintFieldId)
    );
    return backlogItems
      .map((item) => buildStoryFromRaw(item, this.config))
      .filter((s): s is Story => s !== null);
  }

  async getStoryDetail(ref: StoryRef): Promise<StoryDetail> {
    const resolved = await resolveStory(ref, this.gh);
    if (!resolved.issueId) {
      throw new GitHubApiError(
        `Story "${ref.id}" is a Draft Issue — detailed view is not available. ` +
          "Convert it to a real issue to access comments and linked PRs.",
        422,
      );
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
        404,
      );
    }
    const story = buildEnrichedStory(
      issue as IssueDetailsInput,
      resolved.itemId,
      itemData.node?.fieldValues?.nodes ?? [],
      this.config,
    );
    const comments = buildCommentList(issue.comments?.nodes ?? []);
    const linkedPrs = buildLinkedPrList(issue.timelineItems?.nodes ?? []);
    return { story, comments, linkedPrs };
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
}
