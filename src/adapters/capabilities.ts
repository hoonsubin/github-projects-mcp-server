// src/adapters/capabilities.ts - PlatformCapabilities
//
// Declares what features an adapter supports. Each adapter exports a constant
// of this type; the composition root uses it for capability-gated decisions
// (e.g. skipping template registration when fileReader is not available).

// ── CapabilityStatus ─────────────────────────────────────────────────────────

/**
 * Three-value capability status that replaces boolean flags.
 *
 * NATIVE    - operation maps directly to a platform API call; full fidelity.
 * EMULATED  - supported by encoding scrum semantics onto available primitives;
 *             constraints apply and a warning is appended to warnings[].
 * UNAVAILABLE - cannot be expressed on this platform; throws
 *             CapabilityUnavailableError with a recoverySuggestion.
 */
export const CapabilityStatus = {
  NATIVE: "NATIVE",
  EMULATED: "EMULATED",
  UNAVAILABLE: "UNAVAILABLE",
} as const;

export type CapabilityStatus = typeof CapabilityStatus[keyof typeof CapabilityStatus];

// ── CapabilityUnavailableError ────────────────────────────────────────────────

/**
 * Thrown by checkCapability() when the requested operation has status UNAVAILABLE
 * on the current platform. Carries a recoverySuggestion for agent-readable output.
 */
export class CapabilityUnavailableError extends Error {
  override readonly name = "CapabilityUnavailableError";
  readonly platform: string;
  readonly operation: string;
  readonly recoverySuggestion: string;

  constructor(platform: string, operation: string, recoverySuggestion?: string) {
    const suggestion = recoverySuggestion ??
      `Use a platform adapter that supports "${operation}", or check capabilities before calling.`;
    super(`Platform "${platform}" cannot perform "${operation}". ${suggestion}`);
    this.platform = platform;
    this.operation = operation;
    this.recoverySuggestion = suggestion;
  }
}

// ── CapabilityMap ─────────────────────────────────────────────────────────────

/**
 * Maps every declared feature to its CapabilityStatus on a given platform.
 * Used as the type of PlatformCapabilities.supports and the return type of
 * getCapabilities().
 */
export type CapabilityMap = {
  /** Can compute burndown series from audit-log timestamps (full fidelity).
   * EMULATED = falls back to issue-close-date proxies; data carries a quality warning.
   * UNAVAILABLE = burndown data cannot be produced at all. */
  readonly auditLogBurndown: CapabilityStatus;

  /** Has native sprint/iteration field support in the project board.
   * EMULATED = sprint semantics encoded onto available label/milestone primitives.
   * UNAVAILABLE = sprint-related operations cannot be performed. */
  readonly nativeSprints: CapabilityStatus;

  /** Supports dependency tracking between items (blocked_by / blocks).
   * EMULATED = dependency links inferred from body text or labels.
   * UNAVAILABLE = dependency graph queries always return empty maps. */
  readonly dependencies: CapabilityStatus;

  /** Can read files from the repository backing the PM platform.
   * EMULATED = files fetched via a secondary API with rate-limit caveats.
   * UNAVAILABLE = template file reading unavailable; MCP resources not registered. */
  readonly fileReader: CapabilityStatus;

  /** Item keys are stable across board moves, renames, and project transfers.
   * EMULATED = keys are stable within a session but may shift after transfers.
   * UNAVAILABLE = every resolution must round-trip to the API. */
  readonly stableItemKeys: CapabilityStatus;
};

// ── PlatformCapabilities ──────────────────────────────────────────────────────

/**
 * Feature declaration for a single platform adapter.
 *
 * Each field in supports is a CapabilityStatus rather than a boolean so the
 * adapter can distinguish NATIVE (full fidelity), EMULATED (works with caveats),
 * and UNAVAILABLE (cannot be expressed on this platform).
 */
export interface PlatformCapabilities {
  /** Platform identifier key - must match an AdapterFactory.platform value. */
  readonly platform: string;

  /** Per-feature capability statuses. */
  readonly supports: CapabilityMap;
}

// ── getCapabilities ───────────────────────────────────────────────────────────

/**
 * Returns the CapabilityMap for a platform. The map is derived directly from
 * supports - no separate sync needed; updating a status field is reflected
 * immediately in the returned map.
 */
export const getCapabilities = (cap: PlatformCapabilities): CapabilityMap => cap.supports;

// ── checkCapability ───────────────────────────────────────────────────────────

/**
 * Enforce the capability contract for a single operation before executing it.
 *
 * NATIVE     → no-op; full-fidelity path.
 * EMULATED   → appends a human-readable warning to warnings[]; execution continues.
 * UNAVAILABLE → throws CapabilityUnavailableError; execution is prevented.
 */
export const checkCapability = (
  cap: PlatformCapabilities,
  operation: keyof CapabilityMap,
  warnings: string[],
): void => {
  const status = cap.supports[operation];
  if (status === CapabilityStatus.UNAVAILABLE) {
    throw new CapabilityUnavailableError(
      cap.platform,
      operation,
      `"${operation}" is not supported on platform "${cap.platform}". Use a compatible adapter.`,
    );
  }
  if (status === CapabilityStatus.EMULATED) {
    warnings.push(
      `[${cap.platform}] "${operation}" is emulated - results may have limited fidelity.`,
    );
  }
};

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
    auditLogBurndown: CapabilityStatus.NATIVE,
    nativeSprints: CapabilityStatus.NATIVE,
    dependencies: CapabilityStatus.NATIVE,
    fileReader: CapabilityStatus.NATIVE,
    stableItemKeys: CapabilityStatus.NATIVE,
  },
};
