// =============================================================================
// src/adapters/github/internal/assemblers/direct-lookup-assembler.ts
// =============================================================================

import type { GitHubBootState } from "../../bootstrap.ts";
import type { GitHubClient } from "../http-client.ts";
import type { ProjectItem } from "../../types.ts";
import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { AssemblerOutput } from "./types.ts";
import type { PaginationResult } from "../execution-engine.ts";
import { fetchProjectItemsByIssueNumbers } from "../resolve-issue-number.ts";
import { ResultNormalizer } from "../result-normalizer.ts";
import { buildItemFilterFn } from "../item-filter.ts";
import { buildDependencyMap } from "../story-query-service.ts";
import { finalizeAssemblerOutput } from "../assembler-output.ts";

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

  private fetchProjectItemsForKeys(keys: readonly string[]): Promise<ProjectItem[]> {
    const numbers = keys
      .map((key) => Number.parseInt(key, 10))
      .filter((n) => !Number.isNaN(n));
    return fetchProjectItemsByIssueNumbers(this.gh, this.config.ghConfig, numbers);
  }
}
