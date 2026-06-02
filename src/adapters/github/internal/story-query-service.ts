// =============================================================================
// src/adapters/github/internal/story-query-service.ts - Story Read Operations
//
// Read-side story queries: story detail, fetchAllItems, sprint completion.
// Item search is handled by the assembler → engine → normalizer pipeline.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { type BackendCallResult, catchBackend } from "../../../services/error-enrichment.ts";
import type * as GH from "../generated/github-types.ts";
import { ProjectItemsCache } from "./project-items-cache.ts";
import { resolveStory } from "./resolver.ts";
import {
  buildCommentList,
  buildEnrichedStory,
  buildLinkedPrList,
  buildStoryFromRaw,
  type IssueDetailsInput,
} from "../mappers.ts";
import {
  GET_DRAFT_ISSUE_DETAILS_QUERY,
  GET_ISSUE_DETAILS_QUERY,
  GET_ITEM_FIELDS_QUERY,
} from "../queries.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { StoryDetail } from "../../../scrum/ports.ts";
import type { ItemFieldValue, ProjectItem, ProjectV2ItemRef } from "../types.ts";
import type {
  DependencyMap,
  DependencyNode,
  IssueKey,
  Story,
  StoryRef,
} from "../../../domain/types.ts";
import { toIssueKey } from "../../../domain/types.ts";

// ── Response types ─────────────────────────────────────────────────────────────

interface GetIssueDetailsResponse {
  node?: IssueDetailsInput | null;
}

interface GetItemFieldsQueryNode extends Pick<GH.ProjectV2Item, "fieldValues"> {
  fieldValues?: { nodes: ItemFieldValue[] };
}
interface GetItemFieldsResponse {
  node?: GetItemFieldsQueryNode | null;
}

// ── Dependency map builder (standalone pure function) ──────────────────────────

/**
 * Build a DependencyMap from a filtered story set + all project items.
 * Exported for ResultNormalizer injection.
 */
export const buildDependencyMap = (
  stories: readonly Story[],
  allItems: readonly ProjectItem[],
  config: GitHubInfraContext["config"],
): DependencyMap => {
  const map: Record<string, DependencyNode> = {};

  const storyById = new Map<string, Story>();
  for (const story of stories) {
    storyById.set(story.ref.id, story);
  }

  const allItemsById = new Map<string, ProjectItem>();
  for (const item of allItems) {
    allItemsById.set(item.id, item);
  }

  for (const story of stories) {
    if (story.kind !== "issue") continue;

    const key = toIssueKey(story.key!);
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
      blocks: [],
      blocked_by: blocked_by_keys,
    };
  }

  for (const story of stories) {
    if (story.kind !== "issue") continue;
    for (const dep of story.blocked_by) {
      if (map[dep.key]) continue;
      const item = allItemsById.get(dep.ref.id);
      if (!item) {
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
      const key = toIssueKey(depStory.key!);
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

/** Read-side story operations: detail fetch, bulk item fetch, sprint completion. */
export class StoryQueryService {
  constructor(
    private readonly ctx: GitHubInfraContext,
    private readonly projectItemsCache: ProjectItemsCache,
  ) {}

  async getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>> {
    const resolved = await resolveStory(ref, this.ctx.gh);

    if (!resolved.issueId) {
      return this._getDraftIssueDetail(resolved.itemId);
    }

    const warnings: string[] = [];

    const { value: issueData, warnings: issueWarnings } = await catchBackend(() =>
      this.ctx.gh.graphql<GetIssueDetailsResponse>(GET_ISSUE_DETAILS_QUERY, {
        issueId: resolved.issueId!,
      })
    );
    warnings.push(...issueWarnings);

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

    return { value: { story, comments: null, linked_artifacts: null }, warnings: [] };
  }

  fetchAllItems(): Promise<ProjectItem[]> {
    return this.projectItemsCache.getOrFetchAllItems();
  }

  async computeSprintCompletion(
    iterationId: string,
  ): Promise<{ completed: number; total: number }> {
    const allItems = await this.projectItemsCache.getOrFetchAllItems();
    const { sprintFieldId, statusFieldId, storyPointsFieldId } = this.ctx.config.live.fields;

    const sprintItems = allItems.filter((item) => {
      const fv = item.fieldValues.nodes.find((v) => v.field?.id === sprintFieldId);
      return fv?.iterationId === iterationId;
    });

    const statusReverseMap = new Map<string, string>();
    const statusDisplay = this.ctx.config.ghConfig.status_display ?? {};
    for (const [canonical, display] of Object.entries(statusDisplay)) {
      statusReverseMap.set(display, canonical);
    }

    let completed = 0;
    let total = 0;

    for (const item of sprintItems) {
      const ptsFv = storyPointsFieldId
        ? item.fieldValues.nodes.find((v) => v.field?.id === storyPointsFieldId)
        : null;
      const points = ptsFv?.number ?? 0;
      total += points;

      const statusFv = item.fieldValues.nodes.find((v) => v.field?.id === statusFieldId);
      const statusName = statusFv && "name" in statusFv ? statusFv.name : null;
      if (statusName) {
        const canonicalKey = statusReverseMap.get(statusName);
        if (canonicalKey && this.ctx.config.scrumConfig.scrum.status[canonicalKey]?.terminal) {
          completed += points;
        }
      }
    }

    return { completed, total };
  }
}
