// =============================================================================
// src/adapters/github/internal/resolve-issue-number.ts
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { GET_ISSUE_PROJECT_ITEM_QUERY, SEARCH_ISSUES_QUERY } from "../queries.ts";
import { buildSearchQueryString } from "./search-query-builder.ts";
import { mapWithConcurrency } from "./concurrent.ts";
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

interface SearchIssuesNode {
  number: number;
}

interface SearchIssuesResponse {
  search?: {
    nodes: SearchIssuesNode[];
  } | null;
}

const LOOKUP_CONCURRENCY = 4;

const pickProjectItem = (
  nodes: Array<ProjectItem & { project?: { number: number } | null } | null>,
  projectNumber: number,
): ProjectItem | null => {
  const match = nodes.find((n) => n?.project?.number === projectNumber);
  if (!match) return null;
  const { project: _project, ...item } = match;
  return item;
};

export const fetchProjectItemByIssueNumber = async (
  gh: GitHubClient,
  ghConfig: GitHubBackendConfig,
  issueNumber: number,
): Promise<ProjectItem | null> => {
  const { owner, tracked_repos, project_number } = ghConfig;
  const matches: Array<{ repo: string; item: ProjectItem }> = [];

  for (const repo of tracked_repos) {
    const response = await gh.graphql<GetIssueProjectItemResponse>(
      GET_ISSUE_PROJECT_ITEM_QUERY,
      { owner, repo, number: issueNumber },
    );

    const nodes = response.repository?.issue?.projectItems?.nodes ?? [];
    const item = pickProjectItem(nodes, project_number);
    if (item) {
      matches.push({ repo, item });
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!.item;

  throw new GitHubApiError(
    `Issue #${issueNumber} exists on this project board in multiple tracked repos: ` +
      matches.map((m) => `${owner}/${m.repo}#${issueNumber}`).join(", ") + ".",
    {
      code: "AMBIGUOUS_ISSUE_NUMBER",
      statusCode: 400,
      recovery:
        "Disambiguate by ensuring only one tracked repo has this issue on the board, " +
        "or use scrum_find_items with search/labels filters instead of keys.",
      context: {
        issueNumber,
        candidates: matches.map((m) => ({ repo: m.repo, itemId: m.item.id })),
      },
    },
  );
};

export const fetchProjectItemsByIssueNumbers = async (
  gh: GitHubClient,
  ghConfig: GitHubBackendConfig,
  issueNumbers: readonly number[],
): Promise<ProjectItem[]> => {
  const unique = [...new Set(issueNumbers.filter((n) => Number.isFinite(n)))];
  if (unique.length === 0) return [];

  if (unique.length === 1) {
    const item = await fetchProjectItemByIssueNumber(gh, ghConfig, unique[0]!);
    return item ? [item] : [];
  }

  const found = new Map<number, ProjectItem>();

  if (ghConfig.tracked_repos.length > 0) {
    const numberClause = unique.map((n) => n.toString()).join(" ");
    const queryString = buildSearchQueryString({ search: numberClause }, ghConfig);

    const response = await gh.graphql<SearchIssuesResponse>(
      SEARCH_ISSUES_QUERY,
      { query: queryString, first: Math.min(unique.length, 100) },
    );

    const hits = new Set((response.search?.nodes ?? []).map((n) => n.number));
    const toResolve = unique.filter((n) => hits.has(n));

    const resolved = await mapWithConcurrency(
      toResolve,
      LOOKUP_CONCURRENCY,
      (num) => fetchProjectItemByIssueNumber(gh, ghConfig, num),
    );
    for (let i = 0; i < toResolve.length; i++) {
      const item = resolved[i];
      if (item) {
        const num = toResolve[i]!;
        const content = item.content;
        if (content?.__typename === "Issue" && content.number === num) {
          found.set(num, item);
        }
      }
    }
  }

  const missing = unique.filter((n) => !found.has(n));
  if (missing.length > 0) {
    const rest = await mapWithConcurrency(
      missing,
      LOOKUP_CONCURRENCY,
      (num) => fetchProjectItemByIssueNumber(gh, ghConfig, num),
    );
    for (let i = 0; i < missing.length; i++) {
      const item = rest[i];
      if (item) found.set(missing[i]!, item);
    }
  }

  return unique.map((n) => found.get(n)).filter((i): i is ProjectItem => i !== null);
};

export const fetchProjectItemIdByIssueNumber = async (
  gh: GitHubClient,
  ghConfig: GitHubBackendConfig,
  issueNumber: number,
): Promise<string | null> => {
  const item = await fetchProjectItemByIssueNumber(gh, ghConfig, issueNumber);
  return item?.id ?? null;
};

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
