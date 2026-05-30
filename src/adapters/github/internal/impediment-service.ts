// =============================================================================
// src/adapters/github/internal/impediment-service.ts - Impediment Operations
//
// Single responsibility: impediment queries and mutations extracted from the facade.
// Handles createImpediment, getOrphanImpediments, getSprintImpediments, updateImpediment.
//
// ImpedimentListing.ref.id is an EntityRef (project item ID, PVTI_...), consistent
// with every other ref.id in the codebase. updateImpediment resolves the item ID to
// the underlying GitHub Issue node ID (I_...) internally before making GraphQL calls.
//
// Orphan impediments (getOrphanImpediments) carry GitHub Issue node IDs because they
// are fetched directly from the Issues API and have no project item ID.
// This is a known adapter-layer leak - see the getOrphanImpediments method docs.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type * as GH from "../generated/github-types.ts";
import type { GitHubClient } from "./http-client.ts";
import type { ImpedimentStatus } from "../../../domain/types.ts";
import { resolveSprint, resolveStory } from "./resolver.ts";
import { LabelResolver } from "./label-resolver.ts";
import { StoryMutationService } from "./story-mutation-service.ts";
import {
  ADD_COMMENT_MUTATION,
  CLOSE_ISSUE_MUTATION,
  GET_IMPEDIMENT_ISSUES_QUERY,
  GET_ISSUE_BY_ID_QUERY,
  REPLACE_ISSUE_LABELS_MUTATION,
} from "../queries.ts";
import { PaginatedProjectItemFetcher } from "./pagination.ts";
import type { GitHubBootState } from "../bootstrap.ts";
import type { ProjectItemIssueContent, UserLogin } from "../types.ts";
import type { CreateStoryInput, ImpedimentListing } from "../../../scrum/ports.ts";
import type { ImpedimentRef, SprintRef, StoryRef } from "../../../domain/types.ts";

// ── Shared issue node shape ────────────────────────────────────────────────────

/** Query projection of GH.Issue for impediment listing queries. */
interface ImpedimentIssueNode {
  id: string;
  number: number;
  title: string;
  body: string;
  state: GH.IssueState;
  createdAt: string;
  closedAt: Exclude<GH.Issue["closedAt"], undefined>;
  author?: UserLogin | null;
  comments?: { nodes: Array<{ body: string }> };
}

interface ImpedimentIssuesResponse {
  repository?: {
    issues?: {
      nodes: ImpedimentIssueNode[];
    };
  };
}

// ── ImpedimentService class ────────────────────────────────────────────────────

/**
 * Impediment read and write operations.
 * Injected into GitHubProjectBackend via constructor (DIP).
 *
 * ImpedimentListing.ref.id is always the GitHub Issue node ID (I_...).
 * createImpediment also returns itemRef (PVTI_...) for addComment calls.
 */
export class ImpedimentService {
  constructor(
    private readonly config: GitHubBootState,
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repo: string,
    private readonly labelResolver: LabelResolver,
    private readonly storyMutationService: StoryMutationService,
  ) {}

  /**
   * Create an impediment by delegating story creation to StoryMutationService.
   *
   * The StoryMutationService handles the full Draft Issue → Type field → optional
   * conversion flow. The returned ref is the project item ID (PVTI_...) -
   * consistent with every other ref.id in the codebase.
   */
  async createImpediment(
    input: CreateStoryInput,
  ): Promise<{ listing: ImpedimentListing; itemRef: StoryRef }> {
    // Delegate story creation to the canonical path - Draft Issue + Type board field
    const storyRef = await this.storyMutationService.createStory(input);

    const listing: ImpedimentListing = {
      ref: { id: "id" in storyRef ? storyRef.id : String(storyRef.number) },
      description: input.body ?? "",
      status: "open",
      raised_by: null,
      raised_at: new Date().toISOString(),
      resolved_at: null,
    };

    return { listing, itemRef: storyRef };
  }

  async getOrphanImpediments(): Promise<ImpedimentListing[]> {
    const result = await this.gh.graphql<ImpedimentIssuesResponse>(GET_IMPEDIMENT_ISSUES_QUERY, {
      owner: this.owner,
      repo: this.repo,
      states: ["OPEN"],
    });

    const issues = result?.repository?.issues?.nodes ?? [];
    const PVTI_PATTERN = /PVTI_[\w-]+/;

    return issues
      .filter((issue) => {
        const comments = issue.comments?.nodes ?? [];
        return !comments.some((c) => c.body && PVTI_PATTERN.test(c.body));
      })
      .map((issue) => ({
        ref: { id: issue.id },
        description: issue.body ?? "",
        status: (issue.state === "OPEN" ? "open" : "in_progress") as
          | "open"
          | "in_progress"
          | "resolved",
        raised_by: issue.author?.login ?? null,
        raised_at: issue.createdAt,
        resolved_at: issue.closedAt,
      }));
  }

  async getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]> {
    const iterationId = resolveSprint(sprint, this.config);
    if (!iterationId) return [];

    const fetcher = new PaginatedProjectItemFetcher(this.config, this.gh);

    // Fetch all items, filter by sprint iteration
    const sprintItems = await fetcher.collect((item) => {
      const fv = item.fieldValues.nodes.find(
        (v) => v.field?.id === this.config.live.fields.sprintFieldId,
      );
      return fv?.iterationId === iterationId;
    });

    // Filter to Issues with the Type board field set to "impediment"
    const impedimentOptionId = this.config.live.typeOptions["impediment"];
    if (!impedimentOptionId) {
      throw new GitHubApiError(
        `"impediment" type option not found in config.typeOptions. ` +
          `Valid type keys: ${Object.keys(this.config.live.typeOptions).join(", ")}. ` +
          `Add "impediment" to type_mapping in your config file.`,
        {
          code: "OPTION_NOT_FOUND",
          recovery: "Check your config type_mapping for an 'impediment' entry.",
          context: { valid: Object.keys(this.config.live.typeOptions) },
        },
      );
    }
    return sprintItems
      .filter((item) =>
        item.content?.__typename === "Issue" &&
        item.fieldValues.nodes.some((v) =>
          v.field?.id === this.config.live.fields.typeFieldId &&
          "optionId" in v && v.optionId === impedimentOptionId
        )
      )
      .map((item) => {
        const issue = item.content as ProjectItemIssueContent;
        return {
          ref: { id: item.id },
          description: issue.body ?? "",
          status: (issue.state === "OPEN" ? "open" : "resolved") as
            | "open"
            | "in_progress"
            | "resolved",
          raised_by: null,
          raised_at: item.createdAt,
          resolved_at: null,
        };
      });
  }

  async updateImpediment(
    ref: ImpedimentRef,
    status: ImpedimentStatus,
    resolutionNotes?: string,
  ): Promise<ImpedimentListing> {
    // Resolve the project item ID (PVTI_...) to the underlying GitHub Issue node ID (I_...).
    // Mutation operations (label changes, comments, close) target the Issue, not the project item.
    const resolved = await resolveStory({ id: ref.id }, this.gh);
    if (!resolved.issueId) {
      throw new GitHubApiError(
        `Impediment "${ref.id}" is a Draft Issue - it has no underlying GitHub Issue.`,
        {
          code: "DRAFT_ISSUE_CONSTRAINT",
          statusCode: 400,
          recovery: "Draft Issues cannot be used as impediments. " +
            "Convert it to a full Issue (by adding a label) before updating.",
          context: { itemId: ref.id },
        },
      );
    }
    const issueId = resolved.issueId;

    const issueResult = await this.gh.graphql<{
      node: {
        __typename: "Issue";
        number: number;
        body: string | null;
        createdAt: string;
        labels?: { nodes: Array<{ name: string; id: string }> };
        closed: boolean;
        closedAt: string | null;
      };
    }>(
      GET_ISSUE_BY_ID_QUERY,
      { issueId },
    );

    const issue = issueResult?.node;
    if (!issue || issue.__typename !== "Issue") {
      throw new GitHubApiError(
        `Could not resolve impediment "${ref.id}" to an Issue.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "The impediment ID may be stale or the issue was deleted. " +
            "Use scrum_orient or scrum_find_items to refresh the list.",
          context: { impedimentId: ref.id },
        },
      );
    }

    // Remove stale status_* and priority_* labels (priority lives on the project field only)
    const removedLabels = issue.labels?.nodes.filter(
      (label) => label.name.startsWith("status_") || label.name.startsWith("priority_"),
    ) ?? [];
    const currentLabelIds = issue.labels?.nodes.map((label) => label.id) ?? [];
    const newLabelId = await this.labelResolver.resolveOrCreateLabel(`status_${status}`);
    if (!newLabelId) {
      throw new GitHubApiError(
        `Failed to resolve or create the status label "status_${status}".`,
        {
          code: "MUTATION_FAILED",
          recovery: "Verify that your token has Issues (read/write) permission. " +
            "Check GitHub API status and retry.",
          context: { status, labelName: `status_${status}` },
        },
      );
    }

    const updatedLabelIds = currentLabelIds
      .filter((id) => !removedLabels.find((label) => label.id === id))
      .concat(newLabelId);

    await this.gh.graphql(
      REPLACE_ISSUE_LABELS_MUTATION,
      { issueId, labelIds: updatedLabelIds },
    );

    if (status === "resolved" && resolutionNotes) {
      await this.gh.graphql(
        ADD_COMMENT_MUTATION,
        { subjectId: issueId, body: resolutionNotes },
      );
    }

    // Close the GitHub Issue when resolved so it leaves the open issues board
    let resolvedAt = issue.closedAt;
    if (status === "resolved" && !issue.closed) {
      const closeResult = await this.gh.graphql<{
        closeIssue?: { issue?: { closedAt: string } | null } | null;
      }>(
        CLOSE_ISSUE_MUTATION,
        { issueId },
      );
      const closedAt = closeResult.closeIssue?.issue?.closedAt;
      if (!closedAt) {
        throw new GitHubApiError(
          `Issue close mutation succeeded but returned no closedAt timestamp.`,
          {
            code: "MUTATION_FAILED",
            recovery: "The issue may have been closed but the timestamp is unavailable. " +
              "Use scrum_get_story to verify the current state.",
            context: { issueId, impedimentId: ref.id },
          },
        );
      }
      resolvedAt = closedAt;
    }

    const impedimentStatus: ImpedimentStatus = issue.closed || status === "resolved"
      ? "resolved"
      : status;

    return {
      ref,
      description: issue.body ?? "",
      status: impedimentStatus,
      raised_by: null,
      raised_at: issue.createdAt,
      resolved_at: resolvedAt,
    };
  }
}
