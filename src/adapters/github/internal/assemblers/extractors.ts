// =============================================================================
// src/adapters/github/internal/assemblers/extractors.ts
//
// PageExtractor callbacks for ExecutionEngine - navigate typed GraphQL response
// shapes to extract nodes, pageInfo, and totalCount.
// =============================================================================

import { GitHubApiError } from "../../errors.ts";
import type { PageExtractor } from "../execution-engine.ts";
import type { ProjectItemsResponse, ProjectV2ItemsPage } from "../project-items-response-types.ts";
import { projectV2FromOwnerResponse } from "../owner-graphql.ts";
import type { OwnerType } from "../../types.ts";

/** SearchIssues GraphQL response shape (minimal projection). */
export interface SearchIssuesResponse {
  search?: {
    issueCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: readonly unknown[];
  } | null;
}

/**
 * Navigate a ProjectItemsResponse to extract nodes, pageInfo, and totalCount.
 * Throws GitHubApiError when the project is not found.
 */
export const createProjectItemsExtractor = (
  ownerType: OwnerType,
  projectNumber: number,
  login: string,
): PageExtractor<ProjectItemsResponse> => {
  return (response: ProjectItemsResponse) => {
    const project = projectV2FromOwnerResponse<ProjectV2ItemsPage>(response, ownerType);
    if (!project) {
      throw new GitHubApiError(
        `Project #${projectNumber} not found for ${ownerType} '${login}'.`,
        {
          code: "NOT_FOUND",
          recovery: "Verify the project number and owner in backends.github config.",
        },
      );
    }
    return {
      nodes: project.items?.nodes ?? [],
      pageInfo: project.items?.pageInfo ?? { hasNextPage: false, endCursor: null },
      totalCount: project.items?.totalCount ?? 0,
    };
  };
};

/** Extract paginated nodes from a GitHub search(query: ...) response. */
export const searchIssuesExtractor: PageExtractor<SearchIssuesResponse> = (response) => {
  const search = response.search;
  if (!search) {
    throw new GitHubApiError("Search query returned no results container.", {
      code: "NOT_FOUND",
      recovery: "Verify the search query syntax and repository scope.",
    });
  }
  return {
    nodes: search.nodes ?? [],
    pageInfo: search.pageInfo ?? { hasNextPage: false, endCursor: null },
    totalCount: search.issueCount ?? 0,
  };
};
