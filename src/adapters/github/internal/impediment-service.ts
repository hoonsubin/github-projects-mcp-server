// =============================================================================
// src/adapters/github/internal/impediment-service.ts — Impediment Operations
//
// Single responsibility: impediment queries and mutation extracted from the facade.
// Handles getOrphanImpediments, getSprintImpediments, and updateImpediment.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import type { GitHubClient } from "./http-client.ts";
import { resolveSprint } from "./resolver.ts";
import { LabelResolver } from "./label-resolver.ts";
import { GET_IMPEDIMENT_ISSUES_QUERY } from "../queries.ts";
import type { RuntimeConfig } from "../config-loader.ts";
import type { ImpedimentListing, Ref } from "../../../scrum/ports.ts";
import type { SprintRef } from "../../../domain/types.ts";

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
 */
export class ImpedimentService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repo: string,
    private readonly labelResolver: LabelResolver,
  ) {}

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
            "Use scrum_get_impediments to refresh the list.",
          context: { impedimentId: ref.id },
        },
      );
    }

    const oldStatusLabels = issue.labels?.nodes.filter((l) => l.name.startsWith("status_")) ?? [];
    const currentLabelIds = issue.labels?.nodes.map((l) => l.id) ?? [];
    const newLabelId = await this.labelResolver.resolveOrCreateLabel(`status_${status}`);

    const updatedLabelIds = currentLabelIds
      .filter((id) => !oldStatusLabels.find((l) => l.id === id))
      .concat(newLabelId ?? []);

    await this.gh.graphql(
      `mutation ReplaceIssueLabels($issueId: ID!, $labelIds: [ID!]!) {
        replaceLabelsOnLabelable(input: { labelableId: $issueId, labelIds: $labelIds }) {
          labelable { ... on Issue { number } }
        }
      }`,
      { issueId: ref.id, labelIds: updatedLabelIds },
    );

    if (status === "resolved" && resolutionNotes) {
      await this.gh.graphql(
        `mutation AddComment($subjectId: ID!, $body: String!) {
          addComment(input: { subjectId: $subjectId, body: $body }) {
            comment { id }
          }
        }`,
        { subjectId: ref.id, body: resolutionNotes },
      );
    }

    const impedimentStatus: "open" | "in_progress" | "resolved" =
      issue.closed || status === "resolved" ? "resolved" : status;

    return {
      ref: { id: ref.id },
      description: issue.body ?? "",
      status: impedimentStatus,
      raised_by: null,
      raised_at: issue.createdAt,
      resolved_at: issue.closedAt,
    };
  }
}
