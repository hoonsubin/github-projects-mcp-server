// =============================================================================
// scripts/generate-audit.ts — CLI entry point for the audit pipeline
//
// Usage: deno run --allow-read --allow-env --allow-write --allow-run scripts/generate-audit.ts
//
// Parses CLI arguments, runs the pipeline, renders audit.md, and writes the
// output (or prints to stdout with --output -).
// =============================================================================

import { parseCliArgs } from "./audit/config.ts";
import { runPipeline } from "./audit/pipeline.ts";
import { renderMarkdown } from "./audit/renderers/markdown.ts";

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
