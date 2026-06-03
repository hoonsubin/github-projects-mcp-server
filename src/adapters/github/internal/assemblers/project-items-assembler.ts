// =============================================================================
// src/adapters/github/internal/assemblers/project-items-assembler.ts
//
// Handles `project_items` and `mixed` filter profiles. Fetches the full board
// via BoardScanCoordinator (session cache) and filters in memory.
// =============================================================================

import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { GitHubBootState } from "../../bootstrap.ts";
import type { ProjectItem } from "../../types.ts";
import type { AssemblerOutput } from "./types.ts";
import type { BoardScanCoordinator } from "../board-scan-coordinator.ts";
import { ResultNormalizer } from "../result-normalizer.ts";
import { buildItemFilterFn } from "../item-filter.ts";
import { buildDependencyMap } from "../story-query-service.ts";
import { finalizeAssemblerOutput } from "../assembler-output.ts";

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
