// =============================================================================
// scripts/audit/stages/stability.ts - Instability (I) metrics from depcruise JSON
//
// Uses depcruise output with --metrics flag to get instability per module.
// Abstractness (A) requires additional source analysis not available from
// depcruise alone; it can be added as a future enhancement.
// =============================================================================

import type { AuditStage, ModuleStability, StabilityResult } from "../types.ts";
import { classifyModule } from "../layer-classification.ts";
import { createExclusionFilter } from "../filters.ts";

export const stabilityStage: AuditStage<StabilityResult> = {
  name: "stability",

  run: (config, deps) => {
    // Prefer metrics output; fall back to regular output
    const depcruiseJson = deps.depcruiseMetricsJson ?? deps.depcruiseJson;

    if (!depcruiseJson) {
      return { modules: [] };
    }

    const isExcluded = createExclusionFilter(config.excludedDirs);

    const modules: ModuleStability[] = depcruiseJson.modules
      .filter((mod) => mod.instability !== undefined && !isExcluded(mod.source))
      .map((mod) => ({
        source: mod.source,
        layer: classifyModule(mod.source),
        // depcruise --metrics only provides instability (abstractness/distance
        // require source-level analysis). Future: integrate TS Compiler API
        // to count abstract vs. concrete exports per module.
        abstractness: 0,
        instability: mod.instability ?? 0,
        distance: 0,
        zone: classifyZone(mod.instability ?? 0),
      }))
      /** Instability is the inverse of stability: 0 = maximally stable,
       *  1 = maximally instable. High instability = depends on many things
       *  but not depended upon by much → fragile. */
      .sort((a, b) => b.instability - a.instability);

    return { modules };
  },
};

// ── Zone classification (based on instability, since abstractness is N/A) ──────

const classifyZone = (instability: number) => {
  if (instability <= 0.2) return "low-risk" as const;
  if (instability >= 0.8) return "high-risk" as const;
  return "moderate" as const;
};
