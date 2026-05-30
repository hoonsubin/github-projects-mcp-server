// =============================================================================
// src/adapters/github/internal/assemblers/direct-lookup-assembler.ts
//
// Handles `keys`-only filter profile.
// Delegates to StoryQueryService.findItems() with a keys-only filter.
// Phase 3: routing refactor — reuses existing service methods.
// Phase 4: will produce PlatformRequest[] consumed by ExecutionEngine.
// =============================================================================

import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { StoryQueryService } from "../story-query-service.ts";
import type { AssemblerOutput } from "./types.ts";

/**
 * Handles direct issue-number lookups (keys-only filter).
 *
 * Constructs a minimal ResolvedItemFilter from the keys array and delegates
 * to StoryQueryService.findItems(). No other filter fields are applied —
 * keys bypass scope, sprint, and all other filtering.
 */
export class DirectLookupAssembler {
  constructor(private readonly storyQueryService: StoryQueryService) {}

  async assemble(
    profile: { readonly kind: "direct_lookup"; readonly keys: readonly string[] },
  ): Promise<AssemblerOutput> {
    const filter: ResolvedItemFilter = {
      scope: "all",
      keys: profile.keys,
      search: "",
      types: [],
      statuses: [],
      priority: "",
      epic_id: "",
      labels: [],
      assignee: "",
      estimated: undefined,
      sprint_ref: null,
      include_dependencies: false,
      limit: 50,
    };

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
