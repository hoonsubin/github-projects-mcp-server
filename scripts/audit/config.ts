// =============================================================================
// scripts/audit/config.ts - AuditConfig type + CLI argument parsing
// =============================================================================

import type { AuditConfig } from "./types.ts";

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_OUTPUT_PATH = "./docs/AUDIT.md";
const DEFAULT_SRC_DIR = "./src";
const DEFAULT_EXCLUDED_DIRS = [
  "**/*.test.ts",
  "**/test/*.ts",
  "**/generated/",
  "**/*.graphql",
  "_test*.ts",
];

const HELP_TEXT = `Usage: deno run -A scripts/generate-audit.ts [options]

Options:
  --output, -o <path>    Output path (default: ./docs/AUDIT.md). Pass "-" for stdout
  --mermaid [<path>]     Layer dependency graph handling:
                           (not passed)  → section omitted from report
                           --mermaid     → embedded inline in the report
                           --mermaid <path> → saved to standalone .mermaid file
  --c4-map [<path>]      C4 diagram handling:
                           (not passed) → section omitted from report
                           --c4-map     → embedded inline in the report
                           --c4-map <path> → saved to standalone .puml file
  --skip <stage>         Skip a stage (repeatable). Stages: compliance, layer-graph,
                         stability, file-stats, unused-exports, c4-diagram
  --exclude-dir <glob>   Exclude files/directories matching glob (repeatable).
                         Default: **/*.test.ts generated/ graphql/
  --dry-run              Shortcut for --output - (print to stdout)
  --help, -h             Show this help

Examples:
  deno run -A scripts/generate-audit.ts
  deno run -A scripts/generate-audit.ts --skip unused-exports --skip file-stats
  deno run -A scripts/generate-audit.ts --output -
  deno run -A scripts/generate-audit.ts --mermaid
  deno run -A scripts/generate-audit.ts --mermaid docs/layer-graph.mermaid
  deno run -A scripts/generate-audit.ts --exclude-dir "**/vendor/**"
 `;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse CLI arguments and return a resolved AuditConfig.
 * Uses minimal manual parsing to avoid @std/cli type complexities.
 */
export const parseCliArgs = (args: string[]): AuditConfig => {
  const skipStages: string[] = [];
  let outputPath = DEFAULT_OUTPUT_PATH;
  let mermaidMode: "off" | "embed" | "file" = "off";
  let mermaidOutputPath: string | undefined;
  let c4Mode: "off" | "embed" | "file" = "off";
  let c4OutputPath: string | undefined;
  const excludedDirs = [...DEFAULT_EXCLUDED_DIRS];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      console.log(HELP_TEXT);
      Deno.exit(0);
    } else if (arg === "--dry-run") {
      outputPath = "-";
    } else if (arg === "--exclude-dir" && i + 1 < args.length) {
      excludedDirs.push(args[++i]);
    } else if (arg === "--skip" && i + 1 < args.length) {
      skipStages.push(args[++i]);
    } else if ((arg === "--output" || arg === "-o") && i + 1 < args.length) {
      outputPath = args[++i];
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    } else if (arg.startsWith("-o=")) {
      outputPath = arg.slice("-o=".length);
    } else if (arg.startsWith("--mermaid=")) {
      // --mermaid=<path> → file mode
      const value = arg.slice("--mermaid=".length);
      if (value) {
        mermaidMode = "file";
        mermaidOutputPath = value;
      }
    } else if (arg === "--mermaid") {
      // Peek ahead: if next arg exists and does NOT start with --, treat it as a path
      const nextArg = i + 1 < args.length ? args[i + 1] : undefined;
      if (nextArg && !nextArg.startsWith("-")) {
        mermaidMode = "file";
        mermaidOutputPath = nextArg;
        i++; // consume the path argument
      } else {
        mermaidMode = "embed";
      }
    } else if (arg.startsWith("--c4-map=")) {
      const value = arg.slice("--c4-map=".length);
      if (value) {
        c4Mode = "file";
        c4OutputPath = value;
      }
    } else if (arg === "--c4-map") {
      const nextArg = i + 1 < args.length ? args[i + 1] : undefined;
      if (nextArg && !nextArg.startsWith("-")) {
        c4Mode = "file";
        c4OutputPath = nextArg;
        i++;
      } else {
        c4Mode = "embed";
      }
    }
  }

  return {
    srcDir: DEFAULT_SRC_DIR,
    outputPath,
    mermaidMode,
    mermaidOutputPath,
    c4Mode,
    c4OutputPath,
    skipStages,
    excludedDirs,
  };
};
