// =============================================================================
// src/adapters/github/internal/assemblers/types.ts - Assembler Pipeline Types
//
// Shared types for the filter-strategy-router + assembler pipeline.
// Phase 3 routing refactor: classifies filter profiles; each assembler handles
// one execution path. The ExecutionEngine (Phase 4) will consume PlatformRequest[]
// to execute batched GraphQL queries.
// =============================================================================

import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import type { BacklogItemListing, DependencyMap } from "../../../../domain/types.ts";

// ── Discriminated union for filter strategy routing ─────────────────────────

/**
 * Each variant identifies a distinct execution strategy for findItems.
 * The router (`classifyFilter`) produces exactly one profile from a
 * ResolvedItemFilter; the backend dispatches to the matching assembler.
 */
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

// ── Sealed wire type ────────────────────────────────────────────────────────

/**
 * A single GraphQL request payload.
 *
 * All assemblers produce PlatformRequest[] — the execution engine (Phase 4)
 * only knows how to execute these; it has no knowledge of what they represent.
 *
 * For Phase 3 the assemblers consume these internally rather than passing them
 * to a separate engine. Each assembler still calls StoryQueryService methods
 * directly; the PlatformRequest shape is defined now so Phase 4 can wire the
 * execution engine without changing the assembler interface.
 */
export interface PlatformRequest {
  readonly document: string;
  readonly variables: Record<string, unknown>;
  readonly operationName?: string;
}

// ── Assembler output ────────────────────────────────────────────────────────

/**
 * Output from the full assembler pipeline.
 * Crosses into the port return type (ItemSearchResult) at the backend boundary.
 */
export interface AssemblerOutput {
  readonly items: readonly BacklogItemListing[];
  readonly totalCount: number;
  readonly scopeSummary: { sprint_count: number; backlog_count: number };
  readonly dependencyMap: DependencyMap | null;
  readonly warnings: readonly string[];
}
