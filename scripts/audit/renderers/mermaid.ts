// =============================================================================
// scripts/audit/renderers/mermaid.ts — Layer dependency graph → mermaid flowchart
//
// Transforms a LayerGraphResult into a flowchart LR string. Each layer is a
// subgraph with colored nodes; violation edges are red, valid edges are green.
//
// Exports two variants:
//   renderMermaidSource   — raw mermaid source (no code fence)
//   renderMermaidFenced   — wrapped in markdown ```mermaid fence (for embedding)
//   renderMermaid         — (deprecated) alias for renderMermaidFenced
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

// ── Private: build raw lines (shared by both public functions) ─────────────────

const buildMermaidLines = (result: LayerGraphResult): string[] => {
  const lines: string[] = ["flowchart LR", ""];

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

  return lines;
};

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Render a mermaid flowchart as **raw** source (no markdown code fence).
 * Suitable for writing to a standalone `.mermaid` file.
 */
export const renderMermaidSource = (result: LayerGraphResult): string => {
  return buildMermaidLines(result).join("\n") + "\n";
};

/**
 * Render a mermaid flowchart wrapped in markdown ` ```mermaid ` fences.
 * Suitable for embedding inline in a markdown document (e.g. `docs/AUDIT.md`).
 */
export const renderMermaidFenced = (result: LayerGraphResult): string => {
  const body = buildMermaidLines(result).join("\n");
  return "```mermaid\n" + body + "\n```\n";
};

/**
 * @deprecated Use `renderMermaidFenced` (for markdown embedding) or
 * `renderMermaidSource` (for standalone file output).
 */
export const renderMermaid = renderMermaidFenced;
