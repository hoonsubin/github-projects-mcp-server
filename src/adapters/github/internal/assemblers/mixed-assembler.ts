// =============================================================================
// src/adapters/github/internal/assemblers/mixed-assembler.ts
//
// Delegation wrapper for `mixed` filter profiles (board fields + text search).
// Routes to ProjectItemsAssembler for a single board scan + client-side filter.
// =============================================================================

import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { ProjectItemsAssembler } from "./project-items-assembler.ts";
import type { AssemblerOutput } from "./types.ts";

/** Board-field + searchable-term filters via projectV2.items() + post-filter. */
export class MixedAssembler {
  constructor(
    private readonly projectItemsAssembler: ProjectItemsAssembler,
  ) {}

  assemble(filter: ResolvedItemFilter): Promise<AssemblerOutput> {
    return this.projectItemsAssembler.assemble(filter);
  }
}
