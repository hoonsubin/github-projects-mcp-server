// =============================================================================
// scripts/audit/stages/layer-graph.ts — Layer dependency graph from depcruise JSON
//
// Classifies every module into an architectural layer, then builds a directed
// graph of cross-layer dependencies. Violation edges are detected by checking
// if a dependency pair appears in summary.violations.
// =============================================================================

import type { AuditStage, LayerEdge, LayerGraphResult, LayerName } from "../types.ts";
import { classifyModule } from "../layer-classification.ts";
import { createExclusionFilter } from "../filters.ts";

export const layerGraphStage: AuditStage<LayerGraphResult> = {
  name: "layer-graph",

  run: (config, deps) => {
    const depcruiseJson = deps.depcruiseJson;

    if (!depcruiseJson) {
      return { nodes: [], edges: [] };
    }

    const isExcluded = createExclusionFilter(config.excludedDirs);

    // Build a set of violation keys: "from→to" pairs with their rule names
    const violationMap = new Map<string, string[]>();
    for (const violation of depcruiseJson.summary.violations) {
      const key = `${violation.from}→${violation.to}`;
      const rules = violationMap.get(key) ?? [];
      rules.push(violation.rule.name);
      violationMap.set(key, rules);
    }

    // Build node set: each module is a node with its classified layer
    const moduleSources = new Set<string>();
    const moduleLayers = new Map<string, LayerName>();

    for (const mod of depcruiseJson.modules) {
      if (isExcluded(mod.source)) continue;
      moduleSources.add(mod.source);
      if (!moduleLayers.has(mod.source)) {
        moduleLayers.set(mod.source, classifyModule(mod.source));
      }
    }

    const nodes = [...moduleSources].map((source) => ({
      source,
      layer: moduleLayers.get(source) ?? "framework",
    }));

    // Build edges: only cross-layer dependencies are interesting
    const edges: LayerEdge[] = [];
    const seenEdges = new Set<string>();

    for (const mod of depcruiseJson.modules) {
      if (isExcluded(mod.source)) continue;
      const fromLayer = moduleLayers.get(mod.source) ?? "framework";

      for (const dep of mod.dependencies) {
        const toLayer = moduleLayers.get(dep.resolved) ?? classifyModule(dep.resolved);

        // Skip same-layer edges and external dependencies
        if (fromLayer === toLayer) continue;
        if (!dep.resolved.startsWith("src/")) continue;

        const edgeKey = `${mod.source}→${dep.resolved}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        const violatedRuleNames = violationMap.get(edgeKey) ?? [];

        edges.push({
          from: mod.source,
          to: dep.resolved,
          fromLayer,
          toLayer,
          isViolation: violatedRuleNames.length > 0,
          violatedRuleNames,
        });
      }
    }

    return { nodes, edges };
  },
};
