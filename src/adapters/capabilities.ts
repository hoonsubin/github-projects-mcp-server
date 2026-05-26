// src/adapters/capabilities.ts - PlatformCapabilities
//
// Declares what features an adapter supports. Each adapter exports a constant
// of this type; the composition root uses it for capability-gated decisions
// (e.g. skipping template registration when fileReader is not available).

/**
 * Feature declaration for a single platform adapter.
 *
 * Each boolean signals whether the adapter implements the corresponding port
 * method or infrastructure capability. The composition root gates optional
 * behavior (template resource registration, burndown data source selection,
 * dependency graph rendering) on these flags.
 */
export interface PlatformCapabilities {
  /** Platform identifier key - must match an AdapterFactory.platform value. */
  readonly platform: string;

  /** Supported feature flags. */
  readonly supports: {
    /** Can compute burndown series from GitHub audit-log timestamps rather than
     * falling back to issue-close-date proxies. When false, burndown data will
     * always carry a warning about data-source quality. */
    readonly auditLogBurndown: boolean;

    /** Has native sprint/iteration field support in the project board.
     * When false, sprint-related operations (plan, burndown, history) are
     * unavailable and callers should guard accordingly. */
    readonly nativeSprints: boolean;

    /** Supports dependency tracking between items (blocked_by / blocks).
     * When false, dependency graph queries return empty maps and the
     * blocked_by field is never populated. */
    readonly dependencies: boolean;

    /** Can read files from the repository backing the PM platform.
     * When false, template file reading is unavailable and the composition
     * root will skip MCP template resource registration. */
    readonly fileReader: boolean;

    /** Item keys (issue numbers, short IDs) are stable across board moves,
     * renames, and project transfers. When true, callers can cache lookups
     * keyed by number. When false, every resolution round-trips to the API. */
    readonly stableItemKeys: boolean;
  };
}

// ── Pre-built capability constants ───────────────────────────────────────────

/**
 * Capabilities for the GitHub Projects (V2) adapter.
 *
 * GitHub Projects supports audit-log burndown computation, native iteration
 * fields, issue dependency links, repo file reading via the Contents API,
 * and stable issue numbers that never change.
 */
export const GITHUB_CAPABILITIES: PlatformCapabilities = {
  platform: "github",
  supports: {
    auditLogBurndown: true,
    nativeSprints: true,
    dependencies: true,
    fileReader: true,
    stableItemKeys: true,
  },
};
