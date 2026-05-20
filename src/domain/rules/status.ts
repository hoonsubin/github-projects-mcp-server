// =============================================================================
// src/domain/rules/status.ts — Domain rules for status handling
//
// Pure domain rules belong here — no platform-specific
// logic, no GraphQL shapes, no adapter dependencies.
// =============================================================================

import type { ScrumConfig } from "../config.ts";

/**
 * Returns true when `status` matches the terminal (done) status declared in config.
 * Resolves via scrum.status[terminal=true] → backends.github.status_display.
 * Falls back to "Done" if no terminal key is found.
 */
export const isTerminalStatus = (status: string | null, config: ScrumConfig): boolean => {
  const scrumStatus = config.scrum.status ?? {};
  const terminalKey = Object.entries(scrumStatus).find(([, meta]) => meta.terminal)?.[0];
  if (!terminalKey) return (status?.toLowerCase() ?? "") === "done";

  const ghConfig = config.backends.github as Record<string, unknown>;
  const statusDisplay = (ghConfig.status_display as Record<string, string>) ?? {};
  const displayValue = statusDisplay[terminalKey] ?? "Done";

  return (status?.toLowerCase() ?? "") === displayValue.toLowerCase();
};
