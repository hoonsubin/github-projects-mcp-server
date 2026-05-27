// =============================================================================
// src/scrum/config-helpers.ts - Use-case layer config resolution helpers
//
// Resolves platform-specific display values from ScrumConfig so that
// domain-layer functions can remain pure (no config access, no adapter knowledge).
// These helpers belong in the use-case layer, not the domain layer.
// =============================================================================

import type { ScrumConfig } from "../domain/config.ts";

/**
 * Resolve the canonical terminal (done) status display name from config.
 *
 * Looks up the terminal key from scrum.status and maps it through
 * backends.github.status_display to get the platform-specific display string.
 * Falls back to "Done" when no terminal key is configured.
 */
/**
 * Resolve the highest-tier priority display label from config.
 *
 * Looks up the first priority key from scrum.priority (index 0) and maps it
 * through backends.github.priority_display to get the platform-specific label.
 * Falls back to "Must" when no priority tiers are configured.
 */
export const resolveHighestPriorityDisplay = (config: ScrumConfig): string => {
  const p0Key = config.scrum.priority?.[0]?.key ?? "p0";
  const priorityDisplay = config.priority_display ?? {};
  return priorityDisplay[p0Key] ?? "Must";
};

export const resolveTerminalDisplay = (config: ScrumConfig): string => {
  const scrumStatus = config.scrum.status ?? {};
  const terminalKey = Object.entries(scrumStatus).find(([, meta]) => meta.terminal)?.[0];

  if (!terminalKey) return "Done";

  const statusDisplay = config.status_display ?? {};

  return statusDisplay[terminalKey] ?? "Done";
};
