// =============================================================================
// src/adapters/github/internal/assemblers/project-items-assembler.ts
//
// Handles `project_items` and `mixed` filter profiles.
// Delegates to StoryQueryService.findItems() with the full filter.
// Phase 3: routing refactor — reuses existing service methods.
// Phase 4: will produce PlatformRequest[] consumed by ExecutionEngine.
// =============================================================================

import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { StoryQueryService } from "../story-query-service.ts";
import type { AssemblerOutput } from "./types.ts";

/**
 * Handles board-field-based queries via the project items GraphQL endpoint.
 *
 * Passes the full ResolvedItemFilter through to StoryQueryService.findItems(),
 * which applies filters in order of selectivity (scope → sprint → epic →
 * assignee → labels → types → statuses → priority → search → estimated → limit).
 *
 * Also serves as the catch-all for `mixed` profiles (board fields + text search)
 * — the existing findItems() implementation handles this via sequential client-side
 * post-filtering.
 */
export class ProjectItemsAssembler {
  constructor(private readonly storyQueryService: StoryQueryService) {}

  async assemble(filter: ResolvedItemFilter): Promise<AssemblerOutput> {
    const result = await this.storyQueryService.findItems(filter);

    return {
      items: result.items,
      totalCount: result.total_count,
      scopeSummary: {
        sprint_count: result.scope_summary.sprint_count ?? 0,
        backlog_count: result.scope_summary.backlog_count ?? 0,
      },
      dependencyMap: result.dependency_map ?? null,
      warnings: [],
    };
  }
}
