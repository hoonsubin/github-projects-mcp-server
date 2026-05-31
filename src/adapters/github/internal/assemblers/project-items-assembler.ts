// =============================================================================
// src/adapters/github/internal/assemblers/project-items-assembler.ts
//
// Handles `project_items` and `mixed` filter profiles via the assembler →
// engine → normalizer pipeline (Phase 4b).
// =============================================================================

import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { GitHubBootState } from "../../bootstrap.ts";
import type { ProjectItem } from "../../types.ts";
import type { AssemblerOutput, PlatformRequest } from "./types.ts";
import type { ProjectItemsResponse } from "../project-items-query-builder.ts";
import { ProjectItemsQueryBuilder } from "../project-items-query-builder.ts";
import { ExecutionEngine } from "../execution-engine.ts";
import { ResultNormalizer } from "../result-normalizer.ts";
import { buildItemFilterFn } from "../item-filter.ts";
import { buildDependencyMap } from "../story-query-service.ts";
import { finalizeAssemblerOutput } from "../assembler-output.ts";
import { createProjectItemsExtractor } from "./extractors.ts";

/**
 * Handles board-field-based queries via projectV2.items() pagination.
 * Also serves as the catch-all for `mixed` profiles (board fields + text search).
 */
export class ProjectItemsAssembler {
  constructor(
    private readonly engine: ExecutionEngine,
    private readonly normalizer: ResultNormalizer,
    private readonly queryBuilder: ProjectItemsQueryBuilder,
    private readonly config: GitHubBootState,
  ) {}

  async assemble(filter: ResolvedItemFilter): Promise<AssemblerOutput> {
    const document = this.queryBuilder.buildQuery();
    const request: PlatformRequest = {
      document,
      variables: {
        login: this.config.ghConfig.owner,
        number: this.config.ghConfig.project_number,
      },
      operationName: "ProjectItems",
    };

    const extractor = createProjectItemsExtractor(
      this.config.ghConfig.owner_type,
      this.config.ghConfig.project_number,
      this.config.ghConfig.owner,
    );

    const result = await this.engine.execute<ProjectItemsResponse>(request, extractor);
    const allItems = result.nodes as ProjectItem[];
    const filterFn = buildItemFilterFn(filter, this.config, allItems);

    const output = this.normalizer.normalize(result, filterFn, {
      allItems,
      includeDependencies: filter.include_dependencies,
      buildDependencyMap,
    });

    return finalizeAssemblerOutput(output, filter, this.config);
  }
}
