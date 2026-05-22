// =============================================================================
// src/adapters/github/internal/impediment-service.ts — Impediment Operations
//
// Single responsibility: impediment queries and mutations extracted from the facade.
// Handles createImpediment, getOrphanImpediments, getSprintImpediments, updateImpediment.
//
// ImpedimentListing.ref.id is always a GitHub Issue node ID (I_...).
// The tool layer uses this ID directly with updateImpediment.
// The project item ID (PVTI_...) is returned separately for addComment calls.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type { GitHubClient } from "./http-client.ts";
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
import type { RuntimeConfig } from "../config-loader.ts";
import type { ProjectItemIssueContent } from "../types.ts";
import type { CreateStoryInput, ImpedimentListing, Ref } from "../../../scrum/ports.ts";
import type { SprintRef, StoryRef } from "../../../domain/types.ts";

// ── Shared issue node shape ────────────────────────────────────────────────────

interface ImpedimentIssueNode {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  createdAt: string;
  closedAt: string | null;
  author?: { login: string } | null;
  comments?: { nodes: Array<{ body: string | null }> };
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
    private readonly config: RuntimeConfig,
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
   * conversion flow. After creation, we resolve the item to get the underlying
   * issue node ID for the ImpedimentListing.ref.id field.
   */
  async createImpediment(
    input: CreateStoryInput,
  ): Promise<{ listing: ImpedimentListing; itemRef: StoryRef }> {
    // Delegate story creation to the canonical path — Draft Issue + Type board field
    const storyRef = await this.storyMutationService.createStory(input);

    // Resolve the project item to get the underlying issue node ID.
    // Draft Issues have issueId=null, but storyMutationService.createStory()
    // converts Draft → Issue when labels are present, so issueId will be set
    // since the handler passes labels: ["impediment"].
    const resolved = await resolveStory(storyRef, this.gh);

    const listing: ImpedimentListing = {
      ref: { id: resolved.issueId ?? storyRef.id },
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

    const fetcher = new PaginatedProjectItemFetcher(this.config, this.gh, {
      includeIssueContent: true,
      includePRContent: false,
      includeDraftIssueContent: false,
      pageSize: 100,
    });

    // Fetch all items, filter by sprint iteration
    const sprintItems = await fetcher.collect((item) => {
      const fv = item.fieldValues.nodes.find(
        (v) => v.field?.id === this.config.fields.sprintFieldId,
      );
      return fv?.iterationId === iterationId;
    });

    // Filter to Issues with the "impediment" label, map to ImpedimentListing
    return sprintItems
      .filter((item) =>
        item.content?.__typename === "Issue" &&
        item.content.labels.nodes.some((l) => l.name === "impediment")
      )
      .map((item) => {
        const issue = item.content as ProjectItemIssueContent;
        return {
          ref: { id: issue.id },
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
    ref: Ref,
    status: "open" | "in_progress" | "resolved",
    resolutionNotes?: string,
  ): Promise<ImpedimentListing> {
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
      { issueId: ref.id },
    );

    const issue = issueResult?.node;
    if (!issue || issue.__typename !== "Issue") {
      throw new GitHubApiError(
        `Could not resolve impediment "${ref.id}" to an Issue.`,
        {
          code: "NOT_FOUND",
          statusCode: 404,
          recovery: "The impediment ID may be stale or the issue was deleted. " +
            "Use scrum_get_sprint or scrum_get_backlog to refresh the list.",
          context: { impedimentId: ref.id },
        },
      );
    }

    // Remove stale status_* and priority_* labels (priority lives on the project field only)
    const removedLabels = issue.labels?.nodes.filter(
      (l) => l.name.startsWith("status_") || l.name.startsWith("priority_"),
    ) ?? [];
    const currentLabelIds = issue.labels?.nodes.map((l) => l.id) ?? [];
    const newLabelId = await this.labelResolver.resolveOrCreateLabel(`status_${status}`);

    const updatedLabelIds = currentLabelIds
      .filter((id) => !removedLabels.find((l) => l.id === id))
      .concat(newLabelId ?? []);

    await this.gh.graphql(
      REPLACE_ISSUE_LABELS_MUTATION,
      { issueId: ref.id, labelIds: updatedLabelIds },
    );

    if (status === "resolved" && resolutionNotes) {
      await this.gh.graphql(
        ADD_COMMENT_MUTATION,
        { subjectId: ref.id, body: resolutionNotes },
      );
    }

    // Close the GitHub Issue when resolved so it leaves the open issues board
    let resolvedAt = issue.closedAt;
    if (status === "resolved" && !issue.closed) {
      const closeResult = await this.gh.graphql<{
        closeIssue: { issue: { closedAt: string } };
      }>(
        CLOSE_ISSUE_MUTATION,
        { issueId: ref.id },
      );
      resolvedAt = closeResult.closeIssue?.issue?.closedAt ?? null;
    }

    const impedimentStatus: "open" | "in_progress" | "resolved" =
      issue.closed || status === "resolved" ? "resolved" : status;

    return {
      ref: { id: ref.id },
      description: issue.body ?? "",
      status: impedimentStatus,
      raised_by: null,
      raised_at: issue.createdAt,
      resolved_at: resolvedAt,
    };
  }
}
