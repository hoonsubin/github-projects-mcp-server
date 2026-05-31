// =============================================================================
// src/adapters/github/internal/assemblers/direct-lookup-assembler.ts
//
// Handles `keys`-only filter profile via targeted issue → project-item lookup.
// Avoids a full board scan for direct key lookups.
// =============================================================================

import type { GitHubBootState } from "../../bootstrap.ts";
import type { GitHubClient } from "../http-client.ts";
import type { ProjectItem } from "../../types.ts";
import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { AssemblerOutput } from "./types.ts";
import type { PaginationResult } from "../execution-engine.ts";
import { GET_ISSUE_PROJECT_ITEM_QUERY } from "../../queries.ts";
import { ResultNormalizer } from "../result-normalizer.ts";
import { buildItemFilterFn } from "../item-filter.ts";
import { buildDependencyMap } from "../story-query-service.ts";
import { finalizeAssemblerOutput } from "../assembler-output.ts";

interface GetIssueProjectItemResponse {
  repository?: {
    issue?: {
      projectItems?: {
        nodes: Array<ProjectItem & { project?: { number: number } | null } | null>;
      };
    } | null;
  } | null;
}

/** Direct issue-number lookups via GetIssueProjectItem (no board scan). */
export class DirectLookupAssembler {
  constructor(
    private readonly gh: GitHubClient,
    private readonly normalizer: ResultNormalizer,
    private readonly config: GitHubBootState,
  ) {}

  async assemble(
    profile: { readonly kind: "direct_lookup"; readonly keys: readonly string[] },
    filter: ResolvedItemFilter,
  ): Promise<AssemblerOutput> {
    const resolvedFilter: ResolvedItemFilter = { ...filter, keys: profile.keys };
    const projectItems = await this.fetchProjectItemsForKeys(profile.keys);

    const paginationResult: PaginationResult = {
      nodes: projectItems,
      totalCount: projectItems.length,
      pagesConsumed: 1,
      truncated: false,
    };

    const filterFn = buildItemFilterFn(resolvedFilter, this.config, projectItems);
    const output = this.normalizer.normalize(paginationResult, filterFn, {
      allItems: projectItems,
      includeDependencies: resolvedFilter.include_dependencies,
      buildDependencyMap,
    });

    return finalizeAssemblerOutput(output, resolvedFilter, this.config);
  }

  private async fetchProjectItemsForKeys(keys: readonly string[]): Promise<ProjectItem[]> {
    const { owner, tracked_repos, project_number } = this.config.ghConfig;
    const items: ProjectItem[] = [];

    for (const key of keys) {
      const number = Number.parseInt(key, 10);
      if (Number.isNaN(number)) continue;

      for (const repo of tracked_repos) {
        const response = await this.gh.graphql<GetIssueProjectItemResponse>(
          GET_ISSUE_PROJECT_ITEM_QUERY,
          { owner, repo, number },
        );

        const nodes = response.repository?.issue?.projectItems?.nodes ?? [];
        const match = nodes.find((n) => n?.project?.number === project_number);
        if (match) {
          const { project: _project, ...item } = match;
          items.push(item);
          break;
        }
      }
    }

    return items;
  }
}
