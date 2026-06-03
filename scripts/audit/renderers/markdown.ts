// =============================================================================
// scripts/audit/renderers/markdown.ts — All stage results → docs/audit.md
//
// Assembles the output of all 5 stages into a single markdown report with
// sections in the prescribed order.
// =============================================================================

import type {
  AuditConfig,
  AuditResults,
  ComplianceResult,
  FileStatsResult,
  LayerGraphResult,
  StabilityResult,
  UnusedExportResult,
} from "../types.ts";
import { renderMermaidFenced } from "./mermaid.ts";

export const renderMarkdown = (
  results: AuditResults,
  config: AuditConfig,
  timestamp: string,
  commitSha: string | null,
): string => {
  const sections: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  sections.push("# Architecture Audit Report");
  sections.push("");
  sections.push(`**Generated:** ${timestamp}`);
  if (commitSha) {
    sections.push(`**Commit:** \`${commitSha}\``);
  }
  sections.push(`**Source directory:** \`${config.srcDir}\``);
  sections.push("");

  // ── 1. Architecture Compliance ─────────────────────────────────────────────
  const compliance = results.compliance as ComplianceResult | undefined;
  sections.push("## Architecture Compliance");
  sections.push("");
  if (compliance && compliance.rules.length > 0) {
    sections.push(`Modules scanned: **${compliance.moduleCount}**`);
    sections.push("");
    sections.push("| Rule | Severity | Status | Violations |");
    sections.push("|------|----------|--------|------------|");
    for (const rule of compliance.rules) {
      const status = rule.passed ? "🟢 Pass" : "🔴 Fail";
      sections.push(
        `| ${rule.ruleName} | ${rule.severity} | ${status} | ${rule.violationCount} |`,
      );
    }
    sections.push("");

    // Detail for failing rules
    const failingRules = compliance.rules.filter((r) => !r.passed);
    if (failingRules.length > 0) {
      sections.push("### Violation Details");
      sections.push("");
      for (const rule of failingRules) {
        sections.push(`**${rule.ruleName}** (${rule.violationCount} violations)`);
        for (const mod of rule.offendingModules.slice(0, 5)) {
          sections.push(`  - \`${mod}\``);
        }
        if (rule.offendingModules.length > 5) {
          sections.push(`  - ... and ${rule.offendingModules.length - 5} more`);
        }
        sections.push("");
      }
    }
  } else {
    sections.push("_No architecture rules configured or depcruise output unavailable._");
    sections.push("");
  }

  // ── 2. Layer Dependency Graph (only when mermaidMode === "embed") ──────────
  if (config.mermaidMode === "embed") {
    sections.push("## Layer Dependency Graph");
    sections.push("");
    const layerGraph = results["layer-graph"] as LayerGraphResult | undefined;
    if (layerGraph && layerGraph.nodes.length > 0) {
      sections.push(renderMermaidFenced(layerGraph));
      sections.push("");
    } else {
      sections.push("_Layer graph data unavailable._");
      sections.push("");
    }
  }

  // ── 3. Stability (Instability) Metrics ─────────────────────────────────────
  const stability = results.stability as StabilityResult | undefined;
  sections.push("## Stability (Instability) Metrics");
  sections.push("");
  sections.push(
    "_Instability (I) measures outgoing dependencies. I=0 means the module depends on nothing " +
      "(highly stable); I=1 means it depends on many things (fragile)._",
  );
  sections.push("");
  if (stability && stability.modules.length > 0) {
    sections.push("| Module | Layer | I | Risk |");
    sections.push("|--------|-------|---|------|");
    for (const mod of stability.modules) {
      const zoneEmoji = mod.zone === "high-risk" ? "🔴" : mod.zone === "moderate" ? "🟡" : "🟢";
      sections.push(
        `| \`${mod.source}\` | ${mod.layer} | ${
          mod.instability.toFixed(2)
        } | ${zoneEmoji} ${mod.zone} |`,
      );
    }
    sections.push("");
  } else {
    sections.push("_Stability data unavailable. Run with `--metrics` flag if not enabled._");
    sections.push("");
  }

  // ── 4. File Stats ─────────────────────────────────────────────────────────
  const fileStats = results["file-stats"] as FileStatsResult | undefined;
  sections.push("## File Statistics");
  sections.push("");
  if (fileStats && fileStats.layers.length > 0) {
    sections.push("| Layer | Files | Total LOC | Top 3 Largest |");
    sections.push("|-------|-------|-----------|---------------|");
    for (const layer of fileStats.layers) {
      const top3 = layer.topThreeLargest
        .map((f) => `\`${f.path}\` (${f.lines} LOC)`)
        .join(", ");
      sections.push(
        `| ${layer.layer} | ${layer.fileCount} | ${layer.totalLines} | ${top3} |`,
      );
    }
    sections.push("");
  } else {
    sections.push("_File stats unavailable._");
    sections.push("");
  }

  // ── 5. Unused Exports ─────────────────────────────────────────────────────
  const unusedExports = results["unused-exports"] as UnusedExportResult | undefined;
  sections.push("## Unused Exports");
  sections.push("");
  if (unusedExports && unusedExports.exports.length > 0) {
    sections.push(`**Total unused exports:** ${unusedExports.exports.length}`);
    sections.push("");
    sections.push("| File | Export | Kind |");
    sections.push("|------|--------|------|");
    for (const exp of unusedExports.exports) {
      sections.push(`| \`${exp.modulePathName}\` | ${exp.name} | ${exp.kind} |`);
    }
    sections.push("");
  } else if (unusedExports && unusedExports.exports.length === 0) {
    sections.push("_No unused exports detected._");
    sections.push("");
  } else {
    sections.push("_Unused export data unavailable._");
    sections.push("");
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  sections.push("---");
  sections.push("");
  sections.push("*Report generated by `deno task audit`. Do not edit manually.*");

  return sections.join("\n");
};
