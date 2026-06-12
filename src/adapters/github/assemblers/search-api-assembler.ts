// =============================================================================
// src/adapters/github/assemblers/search-api-assembler.ts
//
// GitHub Search API integration (Phase 4c). Server-side filtering for
// search/labels/assignee without board fields. Falls back to board scan when
// scope=all (Draft Issues are not indexed by search).
// =============================================================================

import type { GitHubBootState } from "../bootstrap.ts";
import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { AssemblerOutput, PlatformRequest } from "./types.ts";
import { ExecutionEngine } from "../query-pipeline/execution-engine.ts";
import { ResultNormalizer } from "../query-strategies/result-normalizer.ts";
import { buildSearchQueryString } from "../query-strategies/search-query-builder.ts";
import { searchIssuesToProjectItems } from "../query-strategies/search-result-normalizer.ts";
import { buildItemFilterFn } from "../query-strategies/item-filter.ts";
import { finalizeAssemblerOutput } from "./assembler-output.ts";
import { SEARCH_ISSUES_QUERY } from "../queries.ts";
import { searchIssuesExtractor, type SearchIssuesResponse } from "./extractors.ts";
import type { ProjectItemsAssembler } from "./project-items-assembler.ts";

/**
 * Search-based item lookup via GitHub's search(query: ...) API.
 * Delegates to ProjectItemsAssembler when scope=all to preserve Draft Issue parity.
 */
export class SearchApiAssembler {
  constructor(
    private readonly engine: ExecutionEngine,
    private readonly normalizer: ResultNormalizer,
    private readonly projectItemsAssembler: ProjectItemsAssembler,
    private readonly config: GitHubBootState,
  ) {}

  async assemble(
    profile: {
      readonly kind: "search_api";
      readonly search: string;
      readonly labels?: readonly string[];
      readonly assignee?: string;
    },
    filter?: ResolvedItemFilter,
  ): Promise<AssemblerOutput> {
    // Draft Issues are not GitHub Issues - fall back to board scan for scope=all.
    if (filter?.scope === "all") {
      return this.projectItemsAssembler.assemble(filter);
    }

    const resolvedFilter = filter ?? searchOnlyFilter(profile);
    const queryString = buildSearchQueryString(
      {
        search: profile.search,
        labels: profile.labels,
        assignee: profile.assignee,
      },
      this.config.ghConfig,
    );

    const request: PlatformRequest = {
      document: SEARCH_ISSUES_QUERY,
      variables: { query: queryString, first: 100 },
      operationName: "SearchIssues",
    };

    const result = await this.engine.execute<SearchIssuesResponse>(
      request,
      searchIssuesExtractor,
    );

    const projectNumber = this.config.ghConfig.project_number;
    const projectItems = searchIssuesToProjectItems(result.nodes, projectNumber);

    const hadSearchIntent = !!(
      profile.search ||
      (profile.labels?.length ?? 0) > 0 ||
      profile.assignee
    );

    // GitHub Search can return zero results when the token lacks repository:search
    // permission for private tracked repos. Fall back to a board scan so project-level
    // visibility still surfaces matches.
    if (projectItems.length === 0 && hadSearchIntent && filter) {
      const boardOutput = await this.projectItemsAssembler.assemble(filter);
      return {
        ...boardOutput,
        warnings: [
          ...boardOutput.warnings,
          "GitHub search returned no results; results were loaded via board scan instead. " +
          "If you expected search hits in private repos, verify the token has repository:search permission.",
        ],
      };
    }

    const scopedResult = {
      nodes: projectItems,
      totalCount: projectItems.length,
      pagesConsumed: result.pagesConsumed,
      truncated: result.truncated,
    };

    const filterFn = buildItemFilterFn(resolvedFilter, this.config, projectItems);
    const output = this.normalizer.normalize(scopedResult, filterFn, {
      allItems: projectItems,
    });

    const warnings = [...output.warnings];
    if (result.truncated) {
      warnings.push(
        "Search results were truncated by pagination limits. " +
          "Narrow your search or use board-field filters for exhaustive results.",
      );
    }

    return finalizeAssemblerOutput(
      { ...output, warnings },
      resolvedFilter,
      this.config,
      projectItems,
    );
  }
}

const searchOnlyFilter = (
  profile: {
    readonly search: string;
    readonly labels?: readonly string[];
    readonly assignee?: string;
  },
): ResolvedItemFilter => ({
  scope: "backlog",
  keys: [],
  search: profile.search,
  types: [],
  statuses: [],
  priority: "",
  epic_id: "",
  labels: profile.labels ?? [],
  assignee: profile.assignee ?? "",
  estimated: undefined,
  sprint_ref: null,
  include_dependencies: false,
  limit: 50,
});
