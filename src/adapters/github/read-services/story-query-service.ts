// =============================================================================
// src/adapters/github/story-query-service.ts - Story Read Operations
//
// Read-side story queries: story detail, fetchAllItems.
// Item search is handled by the assembler → engine → normalizer pipeline.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { type BackendCallResult, catchBackend } from "../../../services/error-enrichment.ts";
import type * as GH from "../generated/github-types.ts";
import { BoardScanCoordinator } from "./board-scan-coordinator.ts";
import { resolveStory } from "../infra/resolver.ts";
import {
  applyStorySnapshotOverrides,
  buildCommentList,
  buildEnrichedStory,
  buildLinkedPrList,
  buildStoryFromRaw,
  type IssueDetailsInput,
} from "../mappers.ts";
import {
  extractLinkedPullRequestsFromFieldValues,
  mergeLinkedArtifacts,
} from "../linked-pull-requests.ts";
import type { ResolvedStory } from "../infra/resolver.ts";
import {
  GET_DRAFT_ISSUE_DETAILS_QUERY,
  GET_ISSUE_DETAILS_QUERY,
  GET_ITEM_FIELDS_QUERY,
  GET_PULL_REQUEST_QUERY,
} from "../queries.ts";
import type { GitHubInfraContext } from "../infra/infra-context.ts";
import type { StoryDetail, StorySnapshotOverrides } from "../../../scrum/ports.ts";
import type { ItemFieldValue, ProjectItem, ProjectV2ItemRef } from "../types.ts";
import type {
  BacklogItemListing,
  DependencyMap,
  DependencyPointer,
  EntityRef,
  Story,
  StoryRef,
} from "../../../domain/types.ts";
import { toIssueKey } from "../../../domain/types.ts";
import type { GitHubBootState } from "../bootstrap.ts";

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

const terminalStatusDisplayNames = (config: GitHubBootState): Set<string> => {
  const names = new Set<string>();
  for (const [canonical, semantics] of Object.entries(config.scrumConfig.scrum.status)) {
    if (semantics.terminal && config.ghConfig.status_display[canonical]) {
      names.add(config.ghConfig.status_display[canonical]);
    }
  }
  return names;
};

/** Active = not terminal Done, or assigned to the current active sprint. */
const isActiveBlocker = (
  status: string | null,
  sprintName: string | null,
  config: GitHubBootState,
  terminalStatuses: Set<string>,
): boolean => {
  const activeSprintTitle = config.live.iterations.active?.title ?? null;
  const inActiveSprint = activeSprintTitle !== null && sprintName === activeSprintTitle;
  if (status !== null && terminalStatuses.has(status) && !inActiveSprint) {
    return false;
  }
  return true;
};

/**
 * Supplementary pointers for off-listing active blockers referenced by returned items.
 * Scoped to the limited items[] slice; omits blockers already in items and reverse edges.
 */
export const buildDependencyMap = (
  items: readonly BacklogItemListing[],
  allItems: readonly ProjectItem[],
  config: GitHubBootState,
): DependencyMap => {
  const map: Record<string, DependencyPointer> = {};
  const returnedKeys = new Set(
    items.map((item) => item.ref.key).filter((key) => key.length > 0),
  );
  const terminalStatuses = terminalStatusDisplayNames(config);

  const allItemsById = new Map<string, ProjectItem>();
  for (const item of allItems) {
    allItemsById.set(item.id, item);
  }

  for (const item of items) {
    for (const dep of item.blocked_by) {
      if (!dep.key || returnedKeys.has(dep.key) || map[dep.key]) continue;

      const projectItem = dep.ref.id ? allItemsById.get(dep.ref.id) : undefined;
      let pointer: DependencyPointer = {
        key: toIssueKey(dep.key),
        ref: dep.ref,
        title: dep.title,
        status: null,
      };

      if (projectItem) {
        const depStory = buildStoryFromRaw(projectItem, config);
        if (depStory && (depStory.kind === "issue" || depStory.kind === "pr")) {
          pointer = {
            key: toIssueKey(depStory.key!),
            ref: depStory.ref,
            title: depStory.title,
            status: depStory.status,
          };
          if (
            !isActiveBlocker(depStory.status, depStory.sprint, config, terminalStatuses)
          ) {
            continue;
          }
        }
      } else if (!isActiveBlocker(null, null, config, terminalStatuses)) {
        continue;
      }

      map[pointer.key] = pointer;
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

    if (resolved.contentKind === "pull_request") {
      return this._getPullRequestDetail(resolved, warnings);
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
    const timelineLinked = issueData ? buildLinkedPrList(issue.timelineItems?.nodes ?? []) : null;
    const fieldLinked = extractLinkedPullRequestsFromFieldValues(
      itemData?.node?.fieldValues?.nodes ?? [],
    );
    const linked_artifacts = mergeLinkedArtifacts(timelineLinked, fieldLinked);

    return { value: { story, comments, linked_artifacts }, warnings };
  }

  private async _getPullRequestDetail(
    resolved: ResolvedStory,
    warnings: string[],
  ): Promise<BackendCallResult<StoryDetail>> {
    interface GetDraftIssueDetailsQueryNode extends ProjectV2ItemRef {
      content?: unknown;
      fieldValues?: { nodes: ItemFieldValue[] };
    }
    interface GetDraftIssueDetailsResponse {
      node?: GetDraftIssueDetailsQueryNode | null;
    }

    const { value: data, warnings: itemWarnings } = await catchBackend(() =>
      this.ctx.gh.graphql<GetDraftIssueDetailsResponse>(
        GET_DRAFT_ISSUE_DETAILS_QUERY,
        { itemId: resolved.itemId },
      )
    );
    warnings.push(...itemWarnings);

    const node = data?.node;
    if (!node) {
      throw new GitHubApiError(`Project item ${resolved.itemId} could not be fetched.`, {
        code: "NOT_FOUND",
        statusCode: 404,
        recovery: "Refresh your story list with scrum_orient or scrum_find_items.",
        context: { itemId: resolved.itemId },
      });
    }

    const item: ProjectItem = {
      id: resolved.itemId,
      type: (node.type ?? "PULL_REQUEST") as ProjectItem["type"],
      createdAt: node.createdAt ?? "",
      updatedAt: node.updatedAt ?? "",
      isArchived: node.isArchived ?? false,
      content: node.content as ProjectItem["content"],
      fieldValues: { nodes: node.fieldValues?.nodes ?? [] },
    };

    const story = buildStoryFromRaw(item, this.ctx.config);
    if (!story || story.kind !== "pr") {
      throw new GitHubApiError(
        `Project item ${resolved.itemId} is not a readable Pull Request.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "Use scrum_find_items to locate a valid project item ref.",
          context: { itemId: resolved.itemId },
        },
      );
    }

    const content = item.content;
    const repoOwner = resolved.repository?.owner ??
      (content?.__typename === "PullRequest"
        ? content.repository.nameWithOwner.split("/")[0]
        : this.ctx.owner);
    const repoName = resolved.repository?.name ??
      (content?.__typename === "PullRequest" ? content.repository.name : this.ctx.repo);

    if (resolved.issueNumber !== null && repoOwner && repoName) {
      const { value: prData, warnings: prWarnings } = await catchBackend(() =>
        this.ctx.gh.graphql<{
          repository?: {
            pullRequest?: {
              body?: string | null;
              url?: string;
              reviewDecision?: string | null;
            } | null;
          } | null;
        }>(GET_PULL_REQUEST_QUERY, {
          owner: repoOwner,
          name: repoName,
          number: resolved.issueNumber,
        })
      );
      warnings.push(...prWarnings);
      const pr = prData?.repository?.pullRequest;
      if (pr) {
        return {
          value: {
            story: {
              ...story,
              body: pr.body ?? story.body,
              url: pr.url ?? story.url,
            },
            comments: null,
            linked_artifacts: mergeLinkedArtifacts(
              extractLinkedPullRequestsFromFieldValues(item.fieldValues.nodes),
            ),
          },
          warnings,
        };
      }
    }

    return {
      value: {
        story,
        comments: null,
        linked_artifacts: mergeLinkedArtifacts(
          extractLinkedPullRequestsFromFieldValues(item.fieldValues.nodes),
        ),
      },
      warnings,
    };
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
}
