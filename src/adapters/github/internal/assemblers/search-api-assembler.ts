// =============================================================================
// src/adapters/github/internal/assemblers/search-api-assembler.ts
//
// Shell implementation for search-based queries.
// Returns an empty result with a warning — the GitHub search API integration
// will be implemented in Phase 4b.
// =============================================================================

import type { AssemblerOutput } from "./types.ts";

/**
 * Shell assembler for GitHub search API queries.
 *
 * When a filter contains only searchable fields (search text, labels, assignee)
 * without any board fields (status, type, sprint, priority), the router
 * classifies it as `search_api`. This path is not yet implemented — it returns
 * an empty result set with a warning directing the agent to use board-field
 * filters or direct key lookup instead.
 *
 * Phase 4b will replace this with a real implementation that queries the
 * GitHub Search API (issues?q=...) and maps results to BacklogItemListing[].
 */
export class SearchApiAssembler {
  assemble(
    _profile: {
      readonly kind: "search_api";
      readonly search: string;
      readonly labels?: readonly string[];
      readonly assignee?: string;
    },
  ): AssemblerOutput {
    return {
      items: [],
      totalCount: 0,
      scopeSummary: { sprint_count: 0, backlog_count: 0 },
      dependencyMap: null,
      warnings: [
        "Search API is not yet implemented. Use board-field-based filters " +
        "(status, type, sprint, priority) or direct key lookup instead.",
      ],
    };
  }
}
