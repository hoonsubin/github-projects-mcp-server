// =============================================================================
// src/adapters/github/internal/search-query-builder.ts
//
// Builds GitHub search query strings from ResolvedItemFilter searchable fields.
// Board fields (status, sprint, type, priority) are excluded - they are not
// indexed by the GitHub search engine.
// =============================================================================

import type { GitHubBackendConfig } from "../types.ts";

export interface SearchQueryParts {
  readonly search: string;
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly epicTitle?: string;
}

/**
 * Compose a GitHub issue search query from filter parts and backend config.
 *
 * Parity note: does NOT add `is:open` - board scans include closed issues on
 * the project. Project-membership filtering happens post-search.
 */
export const buildSearchQueryString = (
  parts: SearchQueryParts,
  ghConfig: GitHubBackendConfig,
): string => {
  const clauses: string[] = [];

  for (const repo of ghConfig.tracked_repos) {
    clauses.push(`repo:${ghConfig.owner}/${repo}`);
  }

  clauses.push("is:issue");

  if (parts.search.trim()) {
    clauses.push(`${parts.search.trim()} in:title,body`);
  }

  for (const label of parts.labels ?? []) {
    clauses.push(`label:"${label.replace(/"/g, '\\"')}"`);
  }

  if (parts.assignee) {
    clauses.push(`assignee:${parts.assignee}`);
  }

  if (parts.epicTitle) {
    clauses.push(`milestone:"${parts.epicTitle.replace(/"/g, '\\"')}"`);
  }

  return clauses.join(" ");
};
