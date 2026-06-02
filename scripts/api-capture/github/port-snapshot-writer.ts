// =============================================================================
// Normalize port/handler snapshots — replace volatile computed fields.
// =============================================================================

import { normalizeSnapshot } from "../../../src/tools/_snapshot_normalize.ts";

export { normalizeSnapshot };

export const writeJsonSnapshot = async (
  path: string,
  value: unknown,
): Promise<void> => {
  const normalized = normalizeSnapshot(value);
  await Deno.writeTextFile(path, JSON.stringify(normalized, null, 2));
};
