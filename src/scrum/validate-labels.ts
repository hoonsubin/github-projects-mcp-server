// =============================================================================
// src/scrum/validate-labels.ts - Reserved label enforcement
//
// Labels that duplicate vocabulary declared in ScrumConfig (type keys/display
// names, status keys/display names, priority keys/display names) must never be
// applied to board items. They shadow field semantics that are already expressed
// via dedicated project fields, and confuse both agents and query filters.
//
// buildReservedLabelSet: derives the full set from config at call time.
// stripReservedLabels:   filters a label list, removing any reserved values.
// =============================================================================

import type { ScrumConfig } from "../domain/config.ts";

/**
 * Build the set of label values reserved by vocabulary declarations.
 * Matching is case-insensitive.
 *
 * Covers:
 *   - Canonical status keys        (e.g. "in_progress", "done")
 *   - Status display names         (e.g. "In Progress", "Done")
 *   - Canonical priority keys      (e.g. "p0", "p1")
 *   - Priority display names       (e.g. "Must", "Should")
 *   - Type canonical keys          (e.g. "bug", "impediment")
 *   - Type display names           (e.g. "Bug", "Impediment")
 */
export const buildReservedLabelSet = (scrumConfig: ScrumConfig): ReadonlySet<string> => {
  const reserved = new Set<string>();

  // Status canonical keys
  for (const key of Object.keys(scrumConfig.scrum.status)) {
    reserved.add(key.toLowerCase());
  }
  // Status display names
  for (const display of Object.values(scrumConfig.status_display ?? {})) {
    reserved.add(display.toLowerCase());
  }
  // Priority canonical keys
  for (const { key } of scrumConfig.scrum.priority) {
    reserved.add(key.toLowerCase());
  }
  // Priority display names
  for (const display of Object.values(scrumConfig.priority_display ?? {})) {
    reserved.add(display.toLowerCase());
  }
  // Type canonical keys + display names from backends.github.type_mapping.
  // ScrumConfig.backends is type-erased at the domain layer (Record<string, unknown>),
  // so we access type_mapping via a minimal structural cast without importing
  // the adapter-specific GitHubBackendConfig.
  const ghCfg = scrumConfig.backends.github as
    | { type_mapping?: Record<string, { display?: string }> }
    | undefined;
  for (const [key, entry] of Object.entries(ghCfg?.type_mapping ?? {})) {
    reserved.add(key.toLowerCase());
    if (entry.display) reserved.add(entry.display.toLowerCase());
  }

  return reserved;
};

/**
 * Strip labels that duplicate vocabulary declared in scrumConfig.
 * The server enforces this so agents and users cannot inadvertently
 * create label-based shadows of the type/status/priority fields.
 *
 * Returns a new array; input is not mutated.
 */
export const stripReservedLabels = (
  labels: readonly string[],
  scrumConfig: ScrumConfig,
): string[] => {
  const reserved = buildReservedLabelSet(scrumConfig);
  return labels.filter((l) => !reserved.has(l.toLowerCase()));
};
