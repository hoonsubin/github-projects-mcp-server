// =============================================================================
// src/scrum/terminal-statuses.ts - Terminal workflow columns from Scrum config
// =============================================================================

import type { ScrumConfig } from "../domain/config.ts";

/** Display names for terminal statuses (e.g. Done) — used to filter active sprint scope. */
export const terminalStatusDisplayNames = (scrumConfig: ScrumConfig): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const [canonical, semantics] of Object.entries(scrumConfig.scrum.status)) {
    if (semantics.terminal && scrumConfig.status_display?.[canonical]) {
      names.add(scrumConfig.status_display[canonical]);
    }
  }
  return names;
};
