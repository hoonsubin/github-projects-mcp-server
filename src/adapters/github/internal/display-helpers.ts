// =============================================================================
// src/adapters/github/internal/display-helpers.ts — moved from src/scrum/config-helpers.ts
//
// Resolves platform-specific display values from GitHubBackendConfig so that
// service-layer functions that need display maps can operate without reaching
// into the domain ScrumConfig. These helpers belong in the adapter layer
// because they operate on adapter-specific types (GitHubBackendConfig).
//
// Previously an A9 violation: use-case layer file reading backend display
// config that had no business in src/scrum/.
// =============================================================================

import type { GitHubBackendConfig } from "../types.ts";

/**
 * Resolve the display name of the terminal (done) status from the GitHub backend config.
 *
 * Looks up the terminal key from scrum.status semantics and maps it through
 * ghConfig.status_display to get the platform-specific display string.
 * Falls back to "Done" when no terminal key is configured.
 *
 * Accepts the pre-extracted status keys and metadata map so callers
 * don't need a full ScrumConfig reference.
 */
export const resolveTerminalDisplay = (
  statusKeys: string[],
  statusMeta: Record<string, { terminal: boolean }>,
  ghConfig: GitHubBackendConfig,
): string => {
  const terminalKey = statusKeys.find((k) => statusMeta[k]?.terminal);
  if (!terminalKey) return "Done";
  return ghConfig.status_display[terminalKey] ?? "Done";
};

/**
 * Resolve the highest-tier priority display label from the GitHub backend config.
 *
 * Looks up the first priority key from the priority keys array (index 0, most urgent)
 * and maps it through ghConfig.priority_display to get the platform-specific label.
 * Falls back to "Must" when no priority tiers are configured.
 *
 * Accepts the pre-extracted priority keys array so callers don't need a full
 * ScrumConfig reference.
 */
export const resolveHighestPriorityDisplay = (
  priorityKeys: string[],
  ghConfig: GitHubBackendConfig,
): string => {
  const p0Key = priorityKeys[0];
  if (!p0Key) return "Must";
  return ghConfig.priority_display[p0Key] ?? "Must";
};
