// =============================================================================
// src/scrum/config-helpers.ts — Use-case layer config resolution helpers
//
// Resolves platform-specific display values from ScrumConfig so that
// domain-layer functions can remain pure (no config access, no adapter knowledge).
// These helpers belong in the use-case layer, not the domain layer.
// =============================================================================

import type { CommitBackendDisplayConfig, ScrumConfig } from "../domain/config.ts";

/**
 * Resolve the canonical terminal (done) status display name from config.
 *
 * Looks up the terminal key from scrum.status and maps it through
 * backends.github.status_display to get the platform-specific display string.
 * Falls back to "Done" when no terminal key is configured.
 */
export const resolveTerminalDisplay = (config: ScrumConfig): string => {
  const scrumStatus = config.scrum.status ?? {};
  const terminalKey = Object.entries(scrumStatus).find(([, meta]) => meta.terminal)?.[0];

  if (!terminalKey) return "Done";

  const ghConfig = config.backends.github as CommitBackendDisplayConfig;
  const statusDisplay = ghConfig.status_display ?? {};

  return statusDisplay[terminalKey] ?? "Done";
};
