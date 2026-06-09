// =============================================================================
// src/adapters/github/assemblers/types.ts - Assembler Pipeline Types
// =============================================================================

import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { BacklogItemListing, DependencyMap } from "../../../domain/types.ts";

export type { PlatformRequest } from "../infra/platform-request.ts";

/** Discriminated union - one execution strategy per findItems request. */
export type FilterProfile =
  | { readonly kind: "direct_lookup"; readonly keys: readonly string[] }
  | {
    readonly kind: "search_api";
    readonly search: string;
    readonly labels?: readonly string[];
    readonly assignee?: string;
  }
  | { readonly kind: "project_items"; readonly filter: ResolvedItemFilter }
  | { readonly kind: "mixed"; readonly filter: ResolvedItemFilter };

/** Output from the assembler pipeline, mapped to ItemSearchResult at the backend boundary. */
export interface AssemblerOutput {
  readonly items: readonly BacklogItemListing[];
  readonly totalCount: number;
  readonly scopeSummary: { sprint_count: number; backlog_count: number };
  readonly dependencyMap: DependencyMap | null;
  readonly warnings: readonly string[];
}
