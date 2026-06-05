// =============================================================================
// scripts/audit/filters.ts — Shared exclusion filter from AuditConfig.excludedDirs
//
// Converts glob patterns (e.g. "**/*.test.ts", "**/generated/") to a reusable
// predicate. All audit stages use this single function so config.excludedDirs
// is the one source of truth for file filtering.
// =============================================================================

import { globToRegExp } from "@std/path/glob-to-regexp";

/**
 * Create a predicate that returns `true` when a file path matches any of the
 * `excludedDirs` glob patterns.
 *
 * Use `config.excludedDirs` as the input — it is the single source of truth
 * for all audit-pipeline file exclusions.
 */
export const createExclusionFilter = (
  excludedDirs: readonly string[],
): (path: string) => boolean => {
  const patterns = excludedDirs.map((g) => globToRegExp(g, { extended: true }));
  return (path: string): boolean => patterns.some((re) => re.test(path));
};
