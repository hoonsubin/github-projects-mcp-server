// =============================================================================
// scripts/generate-audit.ts — CLI entry point for the audit pipeline
//
// Usage: deno run --allow-read --allow-env --allow-write --allow-run scripts/generate-audit.ts
//
// Parses CLI arguments, runs the pipeline, renders audit.md, writes the
// output (or prints to stdout with --output -), and optionally writes a
// standalone .mermaid diagram file.
// =============================================================================

import type { C4DiagramResult, LayerGraphResult } from "./audit/types.ts";
import { parseCliArgs } from "./audit/config.ts";
import { runPipeline } from "./audit/pipeline.ts";
import { renderMarkdown } from "./audit/renderers/markdown.ts";
import { saveMermaidFile } from "./audit/renderers/mermaid-file.ts";
import { savePlantumlFile } from "./audit/renderers/plantuml-file.ts";

// ── Main ───────────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const config = parseCliArgs(Deno.args);

  console.error("[audit] Starting audit pipeline...");

  const results = await runPipeline(config);

  console.error("[audit] Rendering audit.md...");
  const timestamp = new Date().toISOString();
  const commitSha = await getCommitSha();
  const markdown = renderMarkdown(results, config, timestamp, commitSha);

  if (config.outputPath === "-") {
    console.log(markdown);
    console.error("[audit] Complete (printed to stdout).");
  } else {
    await Deno.writeTextFile(config.outputPath, markdown);
    console.error(`[audit] Written to ${config.outputPath}`);
  }

  // ── Standalone PlantUML file (only when c4Mode === "file") ───────────────
  if (config.c4Mode === "file") {
    const c4Diagram = results["c4-diagram"] as C4DiagramResult | undefined;
    if (
      c4Diagram &&
      c4Diagram.readTools.context.elements.length > 0 &&
      config.c4OutputPath
    ) {
      console.error(`[audit] Writing PlantUML diagram to ${config.c4OutputPath}...`);
      await savePlantumlFile(c4Diagram, config.c4OutputPath);
      console.error(`[audit] PlantUML diagram written to ${config.c4OutputPath}`);
    } else {
      console.error("[audit] Skipping PlantUML diagram — C4 data unavailable.");
    }
  }

  // ── Standalone mermaid diagram (only when mermaidMode === "file") ──────────
  if (config.mermaidMode === "file") {
    const layerGraph = results["layer-graph"] as LayerGraphResult | undefined;
    if (layerGraph && layerGraph.nodes.length > 0 && config.mermaidOutputPath) {
      console.error(`[audit] Writing mermaid diagram to ${config.mermaidOutputPath}...`);
      await saveMermaidFile(layerGraph, config.mermaidOutputPath);
      console.error(`[audit] Mermaid diagram written to ${config.mermaidOutputPath}`);
    } else if (!layerGraph || layerGraph.nodes.length === 0) {
      console.error("[audit] Skipping mermaid diagram — layer-graph data unavailable.");
    }
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const getCommitSha = async (): Promise<string | null> => {
  try {
    const command = new Deno.Command("git", {
      args: ["rev-parse", "--short", "HEAD"],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout } = await command.output();
    if (code === 0) {
      return new TextDecoder().decode(stdout).trim();
    }
  } catch {
    // Not a git repo or git not available — skip
  }
  return null;
};

// ── Entry ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  await main();
}
