// =============================================================================
// src/services/error-enrichment.ts — Error formatting for the framework layer
//
// enrichError is the single point where adapter errors become agent-readable text.
//
// Every AdapterError thrown by the adapter layer carries an explicit backendName,
// code, and recovery instruction declared at the throw site. enrichError renders
// them as structured, agent-readable output.
//
// catchBackend wraps fallible backend calls at the use-case layer, converting
// AdapterError into per-field warning strings so partial data can still be
// returned to the agent.
// =============================================================================

import { AdapterError } from "../domain/errors.ts";

// ── enrichError — fatal-error path ──────────────────────────────────────────────

/**
 * Format a non-recoverable error into agent-readable text.
 *
 * For AdapterError subclasses: renders as "[CODE] message\n\n→ Recovery: ..."
 * For all other errors: returns "Error: <message>".
 */
export const enrichError = (err: unknown): string => {
  if (err instanceof AdapterError) {
    const detail = err.context ? `\nDetails: ${JSON.stringify(err.context)}` : "";

    return `[${err.code}] ${err.message}${detail}\n\n→ Recovery: ${err.recovery}`;
  }

  return err instanceof Error ? `Error: ${err.message}` : `Error: ${String(err)}`;
};

// ── catchBackend — partial-failure path ─────────────────────────────────────────

export interface BackendCallResult<T> {
  value: T | null;
  warnings: string[];
}

/**
 * Wrap a fallible backend call, converting any AdapterError into a warning
 * string formatted with the backend name prefix.
 *
 * Non-AdapterError exceptions propagate — they are real failures that the
 * handler's catch block will format via enrichError().
 *
 * Usage (use-case layer):
 *   const { value, warnings } = await catchBackend(
 *     () => backend.getEpics(sprintId),
 *   );
 */
export const catchBackend = async <T>(
  fn: () => Promise<T>,
): Promise<BackendCallResult<T>> => {
  try {
    const value = await fn();
    return { value, warnings: [] };
  } catch (err) {
    if (err instanceof AdapterError) {
      const warning = `[${err.backendName}] ${err.code}: ${err.message}` +
        (err.context ? `\n  Details: ${JSON.stringify(err.context)}` : "") +
        `\n  → ${err.recovery}`;
      return { value: null, warnings: [warning] };
    }
    throw err; // non-AdapterError — propagate to the handler
  }
};
