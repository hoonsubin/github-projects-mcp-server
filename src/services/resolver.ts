// =============================================================================
// src/services/resolver.ts
//
// ── BEFORE implementing anything here ────────────────────────────────────────
// StoryRef and SprintRef are temporarily defined and exported from this file.
// Per plan step 1, they belong in src/types.ts. Move them there first, then
// replace the definitions below with:
//   import type { StoryRef, SprintRef } from "../types.ts";
// (The RuntimeConfig import stays in this file.)
//
// ── Phase 1, step 4: implement resolveSprint ─────────────────────────────────
// ── Phase 1, step 9: implement resolveStory ──────────────────────────────────
// =============================================================================

import type { RuntimeConfig } from "./config.ts";

// Temporary home — move to src/types.ts (step 1), then import from there.
export interface StoryRef {
  number?: number; // user-facing issue number (e.g. GitHub issue #42)
  id?: string; // opaque backend handle returned by a previous tool call
}

// Temporary home — move to src/types.ts (step 1), then import from there.
export type SprintRef = "current" | "next" | null | string;

/**
 * Resolved story — both node IDs the backend mutations need.
 * { number } path requires a GraphQL call; { id } path is a direct item lookup.
 */
export interface ResolvedStory {
  itemId: string; // project item node ID (PVTI_...)
  issueId: string; // issue node ID (I_kwDO...)
  issueNumber: number; // user-facing issue number
}

/**
 * Resolve a StoryRef to the GitHub node IDs needed for mutations.
 *
 * todo: [Phase 1, step 9] Implement resolveStory:
 *   - { number } → query repository { issue(number:$n) { id, projectItems(first:10) { nodes { id, project { id } } } } }
 *                  filter projectItems to the item whose project.id === config.projectId
 *   - { id }     → treat id as project item ID (PVTI_...); query projectV2Item { content { ... on Issue { id, number } } }
 *   - Throw a descriptive error if the story is not found in the project
 */
export async function resolveStory(
  _ref: StoryRef,
  _config: RuntimeConfig,
  _github: { graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> },
): Promise<ResolvedStory> {
  throw new Error("not yet implemented: resolveStory");
}

/**
 * Resolve a SprintRef to a GitHub iteration ID (or null to clear the sprint field).
 * Pure function — operates on the already-fetched RuntimeConfig; no network call.
 *
 * todo: [Phase 1, step 4] Implement resolveSprint:
 *   - "current" → config.iterations.active?.id  — throw if active is null (no active sprint)
 *   - "next"    → config.iterations.next?.id     — throw if next is null; error should tell the
 *                 agent "no next sprint is scheduled" so it can inform the user rather than retrying
 *   - null      → return null (caller passes this to clear/remove the sprint field on an item)
 *   - string    → case-insensitive title match against config.iterations.all; throw if no match
 */
export function resolveSprint(
  _ref: SprintRef,
  _config: RuntimeConfig,
): string | null {
  throw new Error("not yet implemented: resolveSprint");
}
