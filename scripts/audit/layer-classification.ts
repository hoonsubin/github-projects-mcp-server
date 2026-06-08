// =============================================================================
// scripts/audit/layer-classification.ts - Shared layer classification logic
//
// Used by layer-graph, stability, and file-stats stages.
// Handles both "src/tools/foo.ts" and "tools/foo.ts" path formats.
// =============================================================================

import type { LayerName } from "./types.ts";

const CLASSIFY_LAYER: ReadonlyArray<{ prefix: string; layer: LayerName }> = [
  { prefix: "src/server.ts", layer: "entrypoint" },
  { prefix: "server.ts", layer: "entrypoint" },
  { prefix: "src/tools/", layer: "framework" },
  { prefix: "tools/", layer: "framework" },
  { prefix: "src/schemas/", layer: "framework" },
  { prefix: "schemas/", layer: "framework" },
  { prefix: "src/services/", layer: "framework" },
  { prefix: "services/", layer: "framework" },
  { prefix: "src/scrum/", layer: "use-case" },
  { prefix: "scrum/", layer: "use-case" },
  { prefix: "src/domain/", layer: "domain" },
  { prefix: "domain/", layer: "domain" },
  { prefix: "src/adapters/", layer: "adapter" },
  { prefix: "adapters/", layer: "adapter" },
];

/**
 * Classify a module path into an architectural layer.
 * Handles both "src/scrum/ports.ts" (depcruise) and "scrum/ports.ts" (file walker) formats.
 * Falls back to "framework" for unrecognized paths.
 */
export const classifyModule = (modulePath: string): LayerName => {
  for (const entry of CLASSIFY_LAYER) {
    if (modulePath.startsWith(entry.prefix)) return entry.layer;
  }
  return "framework";
};
