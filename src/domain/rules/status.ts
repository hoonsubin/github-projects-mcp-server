// =============================================================================
// src/domain/rules/status.ts — Domain rules for status handling
//
// Pure domain rules belong here — no platform-specific
// logic, no GraphQL shapes, no adapter dependencies.
// =============================================================================

/**
 * Returns true when `status` matches the given terminal display value (case-insensitive).
 * Domain-pure: no config access, no platform-specific logic.
 *
 * The caller (use-case layer) resolves the terminal display from ScrumConfig
 * before calling this function — see resolveTerminalDisplay() in src/scrum/config-helpers.ts.
 */
export const isTerminalStatus = (status: string | null, terminalDisplay: string): boolean =>
  (status?.toLowerCase() ?? "") === terminalDisplay.toLowerCase();
