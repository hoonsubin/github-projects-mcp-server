// =============================================================================
// src/adapters/github/internal/resolve-issue-number.ts
//
// Resolves a repository issue number to a project board item via targeted
// GetIssueProjectItem queries — avoids a full ProjectItems board scan.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { GET_ISSUE_PROJECT_ITEM_QUERY } from "../queries.ts";
import type { GitHubClient } from "./http-client.ts";
import type { GitHubBackendConfig, ProjectItem } from "../types.ts";

interface GetIssueProjectItemResponse {
  repository?: {
    issue?: {
      projectItems?: {
        nodes: Array<ProjectItem & { project?: { number: number } | null } | null>;
      };
    } | null;
  } | null;
}

/**
 * Look up the project item for an issue number on the configured board.
 * Returns null when the issue is not linked to the project.
 */
export const fetchProjectItemByIssueNumber = async (
  gh: GitHubClient,
  ghConfig: GitHubBackendConfig,
  issueNumber: number,
): Promise<ProjectItem | null> => {
  const { owner, tracked_repos, project_number } = ghConfig;

  for (const repo of tracked_repos) {
    const response = await gh.graphql<GetIssueProjectItemResponse>(
      GET_ISSUE_PROJECT_ITEM_QUERY,
      { owner, repo, number: issueNumber },
    );

    const nodes = response.repository?.issue?.projectItems?.nodes ?? [];
    const match = nodes.find((n) => n?.project?.number === project_number);
    if (match) {
      const { project: _project, ...item } = match;
      return item;
    }
  }

  return null;
};

/** Project item ID for an issue on the configured board, or null. */
export const fetchProjectItemIdByIssueNumber = async (
  gh: GitHubClient,
  ghConfig: GitHubBackendConfig,
  issueNumber: number,
): Promise<string | null> => {
  const item = await fetchProjectItemByIssueNumber(gh, ghConfig, issueNumber);
  return item?.id ?? null;
};

/**
 * Resolve an issue number to a project item ID or throw NOT_FOUND.
 */
export const resolveProjectItemIdByIssueNumber = async (
  gh: GitHubClient,
  ghConfig: GitHubBackendConfig,
  issueNumber: number,
): Promise<string> => {
  const itemId = await fetchProjectItemIdByIssueNumber(gh, ghConfig, issueNumber);
  if (itemId) return itemId;

  throw new GitHubApiError(
    `Story #${issueNumber} not found on the project board.`,
    {
      code: "NOT_FOUND",
      recovery: "Verify the issue number and ensure it appears in the project. " +
        "Use scrum_find_items to search for stories by keyword if the number may be incorrect.",
      context: { storyNumber: issueNumber },
    },
  );
};
