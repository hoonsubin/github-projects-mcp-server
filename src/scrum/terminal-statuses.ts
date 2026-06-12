// =============================================================================
// src/scrum/terminal-statuses.ts - Terminal workflow columns from Scrum config
// =============================================================================

import type { ScrumConfig } from "../domain/config.ts";

/**
 * Display names for terminal statuses (e.g. "Done") — used to filter active
 * sprint scope in sprint-summary and sprint-data-format.
 *
 * Resolution order for the status_display map:
 *   1. scrumConfig.status_display  (top-level override; populated by server.ts
 *      at wiring time from the active backend's status_display)
 *   2. scrumConfig.backends.github.status_display  (direct fallback so this
 *      function works even when the wiring hoist hasn't run yet, e.g. tests)
 *   3. {} (empty — no terminal statuses; active_only has no effect)
 *
 * The double-source is intentional: ScrumConfig.status_display is a
 * platform-agnostic field, while backends.github.status_display is the
 * GitHub-specific source-of-truth. server.ts should hoist one into the other
 * at startup; this fallback guards against ordering surprises.
 */
export const terminalStatusDisplayNames = (scrumConfig: ScrumConfig): ReadonlySet<string> => {
  const ghCfg = scrumConfig.backends.github as
    | { status_display?: Record<string, string> }
    | undefined;

  const display: Record<string, string> = scrumConfig.status_display ?? ghCfg?.status_display ?? {};

  const names = new Set<string>();
  for (const [canonical, semantics] of Object.entries(scrumConfig.scrum.status)) {
    if (semantics.terminal && display[canonical]) {
      names.add(display[canonical]);
    }
  }
  return names;
};
