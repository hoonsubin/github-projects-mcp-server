// =============================================================================
// scripts/capture-test-fixtures.ts - Offline test fixture capture CLI
// =============================================================================

import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import { loadScrumConfig } from "../src/scrum/config-boot.ts";
import { resolveLocation } from "../src/scrum/resolve-location.ts";
import type { ScrumConfig } from "../src/domain/config.ts";

export interface CaptureResult {
  readonly platform: string;
  readonly outputDir: string;
  readonly files: string[];
  readonly capturedAt: string;
}

export interface FixtureCapturer {
  readonly platform: string;
  capture(
    scrumConfig: ScrumConfig,
    outputDir?: string,
    options?: Record<string, unknown>,
  ): Promise<CaptureResult>;
}

import { GitHubFixtureCapturer } from "./api-capture/github-capturer.ts";

const CAPTURERS: FixtureCapturer[] = [
  new GitHubFixtureCapturer(),
];

const args = parseArgs(Deno.args, {
  string: ["config", "platform", "output-dir", "mode", "scenario"],
  alias: { c: "config", p: "platform", o: "output-dir", m: "mode", s: "scenario" },
  unknown: (flag) => {
    console.error(`Unknown flag: ${flag}`);
    Deno.exit(1);
  },
});

if (!args.config) {
  console.error(
    "Error: --config <path> is required.\n" +
      "Example: deno task capture-fixtures --config .github/scrum/config.yml\n" +
      "Modes: --mode wire | scenarios | all (default) | validate",
  );
  Deno.exit(1);
}

const configLocation = resolveLocation(args.config, resolve(Deno.cwd()));
const { scrumConfig, projectRoot } = await loadScrumConfig(configLocation);

const selected = args.platform ? CAPTURERS.filter((c) => c.platform === args.platform) : CAPTURERS;

if (selected.length === 0) {
  const known = CAPTURERS.map((c) => c.platform).join(", ");
  console.error(`No capturer for platform "${args.platform}". Known: ${known}`);
  Deno.exit(1);
}

const mode = args.mode ?? "all";
if (!["wire", "scenarios", "all", "validate"].includes(mode)) {
  console.error(`Unknown --mode "${mode}". Use wire | scenarios | all | validate`);
  Deno.exit(1);
}

let exitCode = 0;

for (const capturer of selected) {
  console.error(`\n[${capturer.platform}] capturing fixtures (mode=${mode})…`);
  try {
    const result = await capturer.capture(scrumConfig, args["output-dir"], {
      mode,
      projectRoot,
      scenario: args.scenario,
    });
    if (mode === "validate") {
      console.error(`[${capturer.platform}] fixture replay validation OK`);
      continue;
    }
    console.error(
      `[${capturer.platform}] wrote ${result.files.length} files → ${result.outputDir}`,
    );
    for (const f of result.files) {
      console.error(`  ${f.slice(result.outputDir.length + 1)}`);
    }
  } catch (err) {
    console.error(`[${capturer.platform}] FAILED: ${err instanceof Error ? err.message : err}`);
    exitCode = 1;
  }
}

Deno.exit(exitCode);
