// =============================================================================
// src/adapters/github/assemblers/project-items-assembler.ts
//
// Handles `project_items` and `mixed` filter profiles. Fetches the full board
// via BoardScanCoordinator (session cache) and filters in memory.
// =============================================================================

import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { GitHubBootState } from "../bootstrap.ts";
import type { ProjectItem } from "../types.ts";
import type { AssemblerOutput } from "./types.ts";
import type { BoardScanCoordinator } from "../read-services/board-scan-coordinator.ts";
import { ResultNormalizer } from "../query-strategies/result-normalizer.ts";
import { buildItemFilterFn } from "../query-strategies/item-filter.ts";
import { buildDependencyMap } from "../read-services/story-query-service.ts";
import { finalizeAssemblerOutput } from "./assembler-output.ts";

/**
 * Handles board-field-based queries via a cached full-board scan.
 * Also serves as the catch-all for `mixed` profiles (board fields + text search).
 */
export class ProjectItemsAssembler {
  constructor(
    private readonly boardScan: BoardScanCoordinator,
    private readonly normalizer: ResultNormalizer,
    private readonly config: GitHubBootState,
  ) {}

  async assemble(filter: ResolvedItemFilter): Promise<AssemblerOutput> {
    // TODO: replace with boardScan.fetchSprintItems() once the correct
    // GitHub Projects v2 query filter syntax is confirmed (the `query` param
    // field name is project-specific and `@current` support needs validation).
    // Until then, use the full board scan with client-side sprintItemIds
    // filtering, which is correct and benefits from the session cache.
    const allItems = await this.boardScan.fetchFullBoard();

    const filterFn = buildItemFilterFn(filter, this.config, allItems);

    const output = this.normalizer.normalize(
      {
        nodes: allItems,
        totalCount: allItems.length,
        truncated: false,
        pagesConsumed: 1,
      },
      filterFn,
      {
        allItems,
        includeDependencies: filter.include_dependencies,
        buildDependencyMap,
      },
    );

    return finalizeAssemblerOutput(output, filter, this.config);
  }

  /** Exposed for tests that need raw project items without listing normalization. */
  fetchAllProjectItems(): Promise<ProjectItem[]> {
    return this.boardScan.fetchFullBoard();
  }
}
