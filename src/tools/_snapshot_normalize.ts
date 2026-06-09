// =============================================================================
// Normalize tool payloads for golden / bridge snapshot comparison.
// =============================================================================

const VOLATILE_KEYS = new Set([
  "days_elapsed",
  "days_remaining",
  "time_elapsed_pct",
  "capturedAt",
]);

export const SNAPSHOT_PLACEHOLDER = "[COMPUTED]";

export const normalizeSnapshot = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeSnapshot);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = VOLATILE_KEYS.has(key) ? SNAPSHOT_PLACEHOLDER : normalizeSnapshot(child);
    }
    return out;
  }
  return value;
};
