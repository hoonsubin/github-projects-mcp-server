// =============================================================================
// scripts/audit/config.ts — AuditConfig type + CLI argument parsing
// =============================================================================

import type { AuditConfig } from "./types.ts";

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_OUTPUT_PATH = "./docs/AUDIT.md";
const DEFAULT_SRC_DIR = "./src";

const HELP_TEXT = `Usage: deno run -A scripts/generate-audit.ts [options]

Options:
  --output, -o <path>    Output path (default: ./docs/AUDIT.md). Pass "-" for stdout
  --skip <stage>         Skip a stage (repeatable). Stages: compliance, layer-graph,
                         stability, file-stats, unused-exports
  --exclude-tests        Exclude test files (*.test.ts) from the audit
  --dry-run              Shortcut for --output - (print to stdout)
  --help, -h             Show this help

Examples:
  deno run -A scripts/generate-audit.ts
  deno run -A scripts/generate-audit.ts --skip unused-exports --skip file-stats
  deno run -A scripts/generate-audit.ts --output -
  deno run -A scripts/generate-audit.ts --exclude-tests
`;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse CLI arguments and return a resolved AuditConfig.
 * Uses minimal manual parsing to avoid @std/cli type complexities.
 */
export const parseCliArgs = (args: string[]): AuditConfig => {
  const skipStages: string[] = [];
  let outputPath = DEFAULT_OUTPUT_PATH;
  let excludeTests = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      console.log(HELP_TEXT);
      Deno.exit(0);
    } else if (arg === "--dry-run") {
      outputPath = "-";
    } else if (arg === "--exclude-tests") {
      excludeTests = true;
    } else if (arg === "--skip" && i + 1 < args.length) {
      skipStages.push(args[++i]);
    } else if ((arg === "--output" || arg === "-o") && i + 1 < args.length) {
      outputPath = args[++i];
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    } else if (arg.startsWith("-o=")) {
      outputPath = arg.slice("-o=".length);
    }
  }

  return {
    srcDir: DEFAULT_SRC_DIR,
    outputPath,
    skipStages,
    excludeTests,
  };
};
