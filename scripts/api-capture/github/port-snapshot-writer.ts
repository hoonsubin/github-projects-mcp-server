// =============================================================================
// Normalize port/handler snapshots — replace volatile computed fields.
// =============================================================================

const VOLATILE_KEYS = new Set([
  "days_elapsed",
  "days_remaining",
  "time_elapsed_pct",
  "riskStance",
  "work_completion_pct",
  "capturedAt",
]);

const PLACEHOLDER = "[COMPUTED]";

export const normalizeSnapshot = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeSnapshot);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = VOLATILE_KEYS.has(key) ? PLACEHOLDER : normalizeSnapshot(child);
    }
    return out;
  }
  return value;
};

export const writeJsonSnapshot = async (
  path: string,
  value: unknown,
): Promise<void> => {
  const normalized = normalizeSnapshot(value);
  await Deno.writeTextFile(path, JSON.stringify(normalized, null, 2));
};
