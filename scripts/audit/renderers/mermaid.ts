// =============================================================================
// scripts/audit/renderers/mermaid.ts — Layer dependency graph → mermaid flowchart
//
// Transforms a LayerGraphResult into a flowchart TB string. Each layer is a
// subgraph with colored nodes; violation edges are red, valid edges are green.
// =============================================================================

import type { LayerGraphResult, LayerName } from "../types.ts";

// ── Layer display config ───────────────────────────────────────────────────────

const LAYER_STYLES: Record<LayerName, { label: string; color: string }> = {
  entrypoint: { label: "Entry Point", color: "#6366f1" },
  framework: { label: "Framework", color: "#3b82f6" },
  "use-case": { label: "Use-Case", color: "#10b981" },
  domain: { label: "Domain", color: "#f59e0b" },
  adapter: { label: "Adapter", color: "#ef4444" },
};

const LAYER_ORDER: readonly LayerName[] = [
  "entrypoint",
  "framework",
  "use-case",
  "domain",
  "adapter",
];

const NODE_ID = (source: string): string => {
  // Sanitize: replace path separators and special chars for mermaid compatibility
  return source
    .replace(/[\/\\]/g, "_")
    .replace(/\./g, "_")
    .replace(/-/g, "_");
};

const NODE_LABEL = (source: string): string => {
  // Show just the relative filename part for readability
  const parts = source.split("/");
  return parts.slice(-2).join("/");
};

export const renderMermaid = (result: LayerGraphResult): string => {
  const lines: string[] = ["```mermaid", "flowchart LR", ""];

  // Group nodes by layer
  const layerNodes = new Map<LayerName, string[]>();
  for (const node of result.nodes) {
    const arr = layerNodes.get(node.layer) ?? [];
    arr.push(node.source);
    layerNodes.set(node.layer, arr);
  }

  // Render subgraphs in architectural order
  for (const layer of LAYER_ORDER) {
    const nodes = layerNodes.get(layer);
    if (!nodes || nodes.length === 0) continue;

    const style = LAYER_STYLES[layer];
    lines.push(`  subgraph ${layer}["${style.label} Layer"]`);
    for (const source of nodes) {
      const id = NODE_ID(source);
      const label = NODE_LABEL(source);
      lines.push(`    ${id}["${label}"]`);
    }
    lines.push("  end");
    lines.push("");
  }

  // Render edges
  const crossLayerEdges = result.edges;
  if (crossLayerEdges.length > 0) {
    for (const edge of crossLayerEdges) {
      const fromId = NODE_ID(edge.from);
      const toId = NODE_ID(edge.to);
      const color = edge.isViolation ? "red" : "green";
      const ruleLabel = edge.isViolation && edge.violatedRuleNames.length > 0
        ? `|${edge.violatedRuleNames.join(", ")}|`
        : "";
      lines.push(`  ${fromId} --${color}-->${ruleLabel} ${toId}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
};
