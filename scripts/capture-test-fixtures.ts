// =============================================================================
// scripts/capture-test-fixtures.ts - Offline test fixture capture CLI
//
// Records live API responses from each registered backend and writes them as
// JSON fixtures under each adapter's __fixtures__ directory. Tests replay
// those responses via a queue-based stub client (no network required).
//
// Usage:
//   deno task capture-fixtures --config <path-to-scrum-config.yml>
//   deno task capture-fixtures --config <path> --platform github
//   deno task capture-fixtures --config <path> --output-dir /tmp/fixtures
//
// Adding a new backend:
//   1. Implement FixtureCapturer in scripts/api-capture/<platform>-capturer.ts
//   2. Import it here and append `new <Platform>FixtureCapturer()` to CAPTURERS.
//   No other changes needed.
// =============================================================================

import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import { loadScrumConfig } from "../src/scrum/config-boot.ts";
import { resolveLocation } from "../src/scrum/resolve-location.ts";
import type { ScrumConfig } from "../src/domain/config.ts";

// ── FixtureCapturer interface ─────────────────────────────────────────────────
//
// Each backend implements this contract. Structural typing means capturer
// files don't import this interface — they just export a class with matching
// shape, and TypeScript validates the fit when it's placed in CAPTURERS[].

export interface CaptureResult {
  readonly platform: string;
  readonly outputDir: string;
  /** Absolute paths of every file written (fixtures + manifest). */
  readonly files: string[];
  readonly capturedAt: string;
}

export interface FixtureCapturer {
  readonly platform: string;
  /**
   * Record live API responses and write them as JSON fixtures.
   * outputDir defaults to the adapter's co-located __fixtures__ directory.
   */
  capture(scrumConfig: ScrumConfig, outputDir?: string): Promise<CaptureResult>;
}

// ── Capturer registry ─────────────────────────────────────────────────────────
// One import + one entry per backend. Nothing else needs to change here.

import { GitHubFixtureCapturer } from "./api-capture/github-capturer.ts";

const CAPTURERS: FixtureCapturer[] = [
  new GitHubFixtureCapturer(),
  // new LinearFixtureCapturer(),
];

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args, {
  string: ["config", "platform", "output-dir"],
  alias: { c: "config", p: "platform", o: "output-dir" },
  unknown: (flag) => {
    console.error(`Unknown flag: ${flag}`);
    Deno.exit(1);
  },
});

if (!args.config) {
  console.error(
    "Error: --config <path> is required.\n" +
      "Example: deno task capture-fixtures --config .github/scrum/config.yml",
  );
  Deno.exit(1);
}

const configLocation = resolveLocation(args.config, resolve(Deno.cwd()));
const { scrumConfig } = await loadScrumConfig(configLocation);

const selected = args.platform ? CAPTURERS.filter((c) => c.platform === args.platform) : CAPTURERS;

if (selected.length === 0) {
  const known = CAPTURERS.map((c) => c.platform).join(", ");
  console.error(`No capturer for platform "${args.platform}". Known: ${known}`);
  Deno.exit(1);
}

// ── Run ───────────────────────────────────────────────────────────────────────

let exitCode = 0;

for (const capturer of selected) {
  console.error(`\n[${capturer.platform}] capturing fixtures…`);
  try {
    const result = await capturer.capture(scrumConfig, args["output-dir"]);
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
