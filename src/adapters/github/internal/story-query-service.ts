// =============================================================================
// src/adapters/github/internal/story-query-service.ts - Story Read Operations
//
// Read-side story queries: story detail, fetchAllItems, sprint completion.
// Item search is handled by the assembler → engine → normalizer pipeline.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { type BackendCallResult, catchBackend } from "../../../services/error-enrichment.ts";
import type * as GH from "../generated/github-types.ts";
import { BoardScanCoordinator } from "./board-scan-coordinator.ts";
import { resolveStory } from "./resolver.ts";
import {
  applyStorySnapshotOverrides,
  buildAggregateFromRaw,
  buildCommentList,
  buildEnrichedStory,
  buildLinkedPrList,
  buildStoryFromRaw,
  type IssueDetailsInput,
  sprintCompletionFromAggregates,
} from "../mappers.ts";
import {
  GET_DRAFT_ISSUE_DETAILS_QUERY,
  GET_ISSUE_DETAILS_QUERY,
  GET_ITEM_FIELDS_QUERY,
} from "../queries.ts";
import type { GitHubInfraContext } from "./infra-context.ts";
import type { StoryDetail, StorySnapshotOverrides } from "../../../scrum/ports.ts";
import type { ItemFieldValue, ProjectItem, ProjectV2ItemRef } from "../types.ts";
import type {
  DependencyMap,
  DependencyNode,
  EntityRef,
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
    private readonly boardScan: BoardScanCoordinator,
  ) {}

  /**
   * Lean post-mutation story for MCP write tools (no comments / linked PRs).
   * One project-item fetch; optional overrides merge known mutation fields.
   */
  async composeStorySnapshot(
    ref: EntityRef,
    overrides?: StorySnapshotOverrides,
  ): Promise<BackendCallResult<Story>> {
    interface GetDraftIssueDetailsQueryNode extends ProjectV2ItemRef {
      content?: unknown;
      fieldValues?: { nodes: ItemFieldValue[] };
    }
    interface GetDraftIssueDetailsResponse {
      node?: GetDraftIssueDetailsQueryNode | null;
    }

    const { value: data, warnings } = await catchBackend(() =>
      this.ctx.gh.graphql<GetDraftIssueDetailsResponse>(
        GET_DRAFT_ISSUE_DETAILS_QUERY,
        { itemId: ref.id },
      )
    );

    // GraphQL call failed entirely - warnings carry the real error
    if (!data) {
      throw new GitHubApiError(`Failed to fetch project item ${ref.id}.`, {
        code: "FETCH_FAILED",
        recovery: "Check upstream warnings for details.",
        context: { itemId: ref.id, upstreamWarnings: warnings },
      });
    }

    // GraphQL succeeded but node is missing (legitimate NOT_FOUND)
    const node = data.node;
    if (!node) {
      throw new GitHubApiError(`Project item ${ref.id} could not be fetched.`, {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: "The item may have been deleted from the project. " +
          "Refresh your story list with scrum_orient or scrum_find_items.",
        context: { itemId: ref.id },
      });
    }

    const item: ProjectItem = {
      id: ref.id,
      type: (node.type ?? "DRAFT_ISSUE") as ProjectItem["type"],
      createdAt: node.createdAt ?? "",
      updatedAt: node.updatedAt ?? "",
      isArchived: node.isArchived ?? false,
      content: node.content as ProjectItem["content"],
      fieldValues: { nodes: node.fieldValues?.nodes ?? [] },
    };

    const base = buildStoryFromRaw(item, this.ctx.config);
    if (!base) {
      throw new GitHubApiError(
        `Project item ${ref.id} is missing required content fields.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "The item may have been deleted or corrupted in the project.",
          context: { itemId: ref.id },
        },
      );
    }

    return {
      value: applyStorySnapshotOverrides(base, overrides),
      warnings,
    };
  }

  async getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>> {
    const { value: resolved, warnings: resolveWarnings } = await catchBackend(() =>
      resolveStory(ref, this.ctx.gh)
    );
    const warnings: string[] = [...resolveWarnings];

    if (!resolved) {
      return { value: null, warnings };
    }

    if (!resolved.issueId) {
      return this._getDraftIssueDetail(resolved.itemId);
    }

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

    const { value: data, warnings } = await catchBackend(() =>
      this.ctx.gh.graphql<GetDraftIssueDetailsResponse>(
        GET_DRAFT_ISSUE_DETAILS_QUERY,
        { itemId },
      )
    );

    if (!data) {
      throw new GitHubApiError(`Failed to fetch draft issue ${itemId}.`, {
        code: "FETCH_FAILED",
        recovery: "Check upstream warnings for details.",
        context: { itemId, upstreamWarnings: warnings },
      });
    }

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

    return { value: { story, comments: null, linked_artifacts: null }, warnings };
  }

  /** Lean aggregate board scan (shared cache). */
  fetchAllItems(): Promise<ProjectItem[]> {
    return this.boardScan.fetchAggregateBoard();
  }

  /** Full ItemContent board scan for Story-shaped consumers (e.g. board health). */
  fetchFullItems(): Promise<ProjectItem[]> {
    return this.boardScan.fetchFullBoard();
  }

  async computeSprintCompletion(
    iterationId: string,
  ): Promise<{ completed: number; total: number }> {
    const allItems = await this.boardScan.fetchAggregateBoard();
    const aggregates = allItems.map((item) => buildAggregateFromRaw(item, this.ctx.config));
    return sprintCompletionFromAggregates(aggregates, iterationId, this.ctx.config);
  }
}
