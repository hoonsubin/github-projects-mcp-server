// =============================================================================
// scripts/audit/pipeline.ts - Stage orchestration and depcruise runner
//
// 1. Spawn depcruise once (with --metrics) and cache the JSON results.
// 2. Run each enabled stage in order.
// 3. Return the full AuditResults map for renderers to consume.
// =============================================================================

import type {
  AnyStageResult,
  AuditConfig,
  AuditResults,
  DepcruiseOutput,
  StageDependencies,
} from "./types.ts";
import type { AuditStage } from "./types.ts";
import { globToRegExp } from "@std/path/glob-to-regexp";

import { complianceStage } from "./stages/compliance.ts";
import { layerGraphStage } from "./stages/layer-graph.ts";
import { stabilityStage } from "./stages/stability.ts";
import { fileStatsStage } from "./stages/file-stats.ts";
import { unusedExportsStage } from "./stages/unused-exports.ts";
import { c4DiagramStage } from "./stages/c4-diagram.ts";

// ── Pipeline definition ────────────────────────────────────────────────────────

const ALL_STAGES: readonly AuditStage<AnyStageResult>[] = [
  complianceStage,
  layerGraphStage,
  stabilityStage,
  fileStatsStage,
  unusedExportsStage,
  c4DiagramStage,
];

// ── depcruise runners ──────────────────────────────────────────────────────────

const runDepcruise = async (args: string[]): Promise<DepcruiseOutput> => {
  const command = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-run",
      "scripts/depcruise.ts",
      "--json",
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();
  const stderrText = new TextDecoder().decode(stderr);

  if (code !== 0 && stderrText.includes("SyntaxError")) {
    throw new Error(`depcruise failed: ${stderrText}`);
  }

  const stdoutText = new TextDecoder().decode(stdout);
  if (!stdoutText.trim()) {
    throw new Error("depcruise produced empty output");
  }

  try {
    return JSON.parse(stdoutText) as DepcruiseOutput;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse depcruise JSON: ${message}`);
  }
};

// ── Pipeline runner ────────────────────────────────────────────────────────────

export const runPipeline = async (config: AuditConfig): Promise<AuditResults> => {
  // Convert glob patterns to regex and add each as a separate --exclude argument.
  // depcruise rejects combined patterns joined with | as "too complex".
  const depcruiseArgs = config.excludedDirs.length > 0
    ? config.excludedDirs.flatMap((g) => ["--exclude", globToRegExp(g, { extended: true }).source])
    : [];

  // Step 1 — Collect: run depcruise for violations and metrics
  let depcruiseJson: DepcruiseOutput | undefined;
  let depcruiseMetricsJson: DepcruiseOutput | undefined;

  try {
    depcruiseJson = await runDepcruise(depcruiseArgs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Warning: depcruise failed - ${message}`);
    console.error("Compliance, layer-graph, and stability stages will be skipped.");
  }

  if (depcruiseJson && !config.skipStages.includes("stability")) {
    try {
      depcruiseMetricsJson = await runDepcruise(["--metrics", ...depcruiseArgs]);
    } catch {
      console.error("Warning: depcruise --metrics failed. Stability metrics will be unavailable.");
    }
  }

  const deps: StageDependencies = { depcruiseJson, depcruiseMetricsJson };
  const results: AuditResults = {};

  // Step 2 — Analyze: run all audit stages
  for (const stage of ALL_STAGES) {
    if (config.skipStages.includes(stage.name)) {
      console.error(`[audit] Skipping stage: ${stage.name}`);
      continue;
    }

    console.error(`[audit] Running stage: ${stage.name}`);
    try {
      const result = await stage.run(config, deps);
      results[stage.name] = result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[audit] Stage "${stage.name}" failed: ${message}`);
    }
  }

  return results;
};
