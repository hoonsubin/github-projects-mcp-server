// =============================================================================
// src/adapters/github/internal/assemblers/mixed-assembler.ts
//
// Delegation wrapper for `mixed` filter profiles (board fields + text search).
// Routes to ProjectItemsAssembler — the existing findItems() implementation
// handles the combined filter via sequential client-side post-filtering.
// =============================================================================

import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { ProjectItemsAssembler } from "./project-items-assembler.ts";
import type { AssemblerOutput } from "./types.ts";

/**
 * Handles `mixed` filter profiles by delegating to ProjectItemsAssembler.
 *
 * A `mixed` profile means the filter has both searchable terms (search text,
 * labels, assignee) AND board fields (status, type, sprint, priority).
 * The existing StoryQueryService.findItems() implementation handles this
 * combination via sequential client-side post-filtering — all project items
 * are fetched, then filtered by board fields first, then by search terms.
 *
 * This is a thin delegation wrapper; Phase 4 may replace it with a two-phase
 * execution (search API + project items intersection).
 */
export class MixedAssembler {
  constructor(
    private readonly projectItemsAssembler: ProjectItemsAssembler,
  ) {}

  assemble(filter: ResolvedItemFilter): Promise<AssemblerOutput> {
    return this.projectItemsAssembler.assemble(filter);
  }
}
