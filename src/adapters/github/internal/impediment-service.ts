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
import { resolveSprint } from "./resolver.ts";
import { LabelResolver } from "./label-resolver.ts";
import { FieldValueMutator } from "./field-value-mutator.ts";
import { GET_IMPEDIMENT_ISSUES_QUERY } from "../queries.ts";
import type { RuntimeConfig } from "../config-loader.ts";
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
    private readonly fieldValueMutator: FieldValueMutator,
  ) {}

  async createImpediment(
    input: CreateStoryInput,
  ): Promise<{ listing: ImpedimentListing; itemRef: StoryRef }> {
    const labelNames: string[] = [`type_${input.type}`];
    if (input.labels) labelNames.push(...input.labels);

    const [labelIds, repositoryId] = await Promise.all([
      this.labelResolver.resolveOrCreateLabelNodeIds(labelNames),
      this.labelResolver.fetchRepoNodeId(),
    ]);

    const createResult = await this.gh.graphql<{
      createIssue?: { issue?: { id: string; number: number } };
    }>(
      `mutation CreateImpedimentIssue(
        $repositoryId: ID!, $title: String!, $body: String, $labelIds: [ID!]
      ) {
        createIssue(input: {
          repositoryId: $repositoryId, title: $title, body: $body, labelIds: $labelIds
        }) { issue { id number } }
      }`,
      {
        repositoryId,
        title: input.title,
        body: input.body,
        ...(labelIds.length > 0 ? { labelIds } : {}),
      },
    );

    const issue = createResult.createIssue?.issue;
    if (!issue) {
      throw new GitHubApiError("createIssue mutation returned no issue.", {
        code: "MUTATION_FAILED",
        recovery: "Check that your token has Issues (read/write) permission, then retry.",
      });
    }

    const addItemResult = await this.gh.graphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(
      `mutation AddImpedimentToProject($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }`,
      { projectId: this.config.projectId, contentId: issue.id },
    );

    const itemId = addItemResult.addProjectV2ItemById?.item?.id;
    if (!itemId) {
      throw new GitHubApiError("addProjectV2ItemById returned no item ID.", {
        code: "MUTATION_FAILED",
        recovery: "Check that your token has Projects (read/write) permission and the project " +
          "number in configuration is correct, then retry.",
        context: { issueId: issue.id },
      });
    }

    if (input.priority) {
      await this.fieldValueMutator.setFieldPriority(itemId, input.priority);
    }

    const listing: ImpedimentListing = {
      ref: { id: issue.id },
      description: input.body ?? "",
      status: "open",
      raised_by: null,
      raised_at: new Date().toISOString(),
      resolved_at: null,
    };

    return { listing, itemRef: { id: itemId } };
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

    const iterEntry = this.config.iterations.all.find((i) => i.id === iterationId);
    if (!iterEntry) return [];

    const sprintName = iterEntry.title;
    const result = await this.gh.graphql<ImpedimentIssuesResponse>(GET_IMPEDIMENT_ISSUES_QUERY, {
      owner: this.owner,
      repo: this.repo,
      states: ["OPEN", "CLOSED"],
    });

    const issues = result?.repository?.issues?.nodes ?? [];

    // TODO: Refactor to use PVTI_ project item resolution + iteration field check
    // instead of string matching. Currently, GitHub Issues lack a native sprint field,
    // so we match by sprint name in issue body/comments. A more robust approach would
    // resolve PVTI_ references in comments to project items and check their iterationId
    // field directly (see getSprintStories for the pattern).

    const sprintNamePattern = new RegExp(
      `\\b${sprintName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );

    return issues
      .filter((issue) => {
        const bodyMatches = sprintNamePattern.test(issue.body ?? "");
        const comments = issue.comments?.nodes ?? [];
        return bodyMatches || comments.some((c) => sprintNamePattern.test(c.body ?? ""));
      })
      .map((issue) => ({
        ref: { id: issue.id },
        description: issue.body ?? "",
        status: (issue.state === "OPEN" ? "open" : "resolved") as
          | "open"
          | "in_progress"
          | "resolved",
        raised_by: issue.author?.login ?? null,
        raised_at: issue.createdAt,
        resolved_at: issue.closedAt,
      }));
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
      `query GetIssue($issueId: ID!) {
        node(id: $issueId) {
          __typename
          ... on Issue {
            number body createdAt
            labels(first: 20) { nodes { name id } }
            closed closedAt
          }
        }
      }`,
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
      `mutation ReplaceIssueLabels($issueId: ID!, $labelIds: [ID!]!) {
        updateIssue(input: { id: $issueId, labelIds: $labelIds }) {
          issue { id }
        }
      }`,
      { issueId: ref.id, labelIds: updatedLabelIds },
    );

    if (status === "resolved" && resolutionNotes) {
      await this.gh.graphql(
        `mutation AddComment($subjectId: ID!, $body: String!) {
          addComment(input: { subjectId: $subjectId, body: $body }) {
            commentEdge { node { id } }
          }
        }`,
        { subjectId: ref.id, body: resolutionNotes },
      );
    }

    // Close the GitHub Issue when resolved so it leaves the open issues board
    let resolvedAt = issue.closedAt;
    if (status === "resolved" && !issue.closed) {
      const closeResult = await this.gh.graphql<{
        closeIssue: { issue: { closedAt: string } };
      }>(
        `mutation CloseIssue($issueId: ID!) {
          closeIssue(input: { issueId: $issueId }) {
            issue { closedAt }
          }
        }`,
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
