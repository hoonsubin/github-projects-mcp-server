// =============================================================================
// scripts/capture-test-fixtures.ts
//
// Calls the production AdapterFactory → BackendResult pipeline (same path as
// the MCP server at startup), then dumps the port-level responses as JSON files
// for manual review. No knowledge of _test_fixtures.ts internal structure,
// no raw GraphQL queries, no config-internal reach.
//
// Usage:
//   deno task capture-fixtures
//
// Requires GITHUB_TOKEN in the environment.
// =============================================================================

import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import { loadScrumConfig } from "../src/scrum/config-boot.ts";
import { resolveLocation } from "../src/scrum/resolve-location.ts";
import { createBackend } from "../src/adapters/factory.ts";
import { GitHubAdapterFactory } from "../src/adapters/github/factory.ts";
import type { AdapterStartupOptions } from "../src/adapters/factory.ts";

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args, {
  string: ["config", "output-dir"],
  alias: { c: "config", o: "output-dir" },
  unknown: (flag) => {
    console.error(`Unknown flag: ${flag}`);
    Deno.exit(1);
  },
});

if (!args.config) {
  console.error("Error: --config <path> is required.");
  Deno.exit(1);
}

const configLocation = resolveLocation(args.config, resolve(Deno.cwd()));
const { scrumConfig, projectRoot } = await loadScrumConfig(configLocation);

// ── Build backend via production factory (platform-agnostic) ──────────────────

const startupOptions: AdapterStartupOptions = {
  configLocation,
  scrumConfig,
  projectRoot,
  env: (name: string) => Deno.env.get(name),
};

const { backend, fileReader, typeTemplatePaths } = await createBackend(
  [new GitHubAdapterFactory()],
  startupOptions,
);

// ── Collect port-level data ──────────────────────────────────────────────────

console.error("reloading backend…");
await backend.reload();

console.error("fetching platform state…");
const platformResult = await backend.getPlatformState({
  canonicalStatusKeys: Object.keys(scrumConfig.scrum.status),
  canonicalPriorityKeys: scrumConfig.scrum.priority.map((p) => p.key),
});
const platformState = platformResult.value!;

console.error("fetching all items…");
const findResult = await backend.findItems({
  scope: "all",
  keys: [],
  search: "",
  types: [],
  statuses: [],
  priority: "",
  epic_id: "",
  labels: [],
  assignee: "",
  estimated: undefined,
  sprint_ref: null,
  include_dependencies: false,
  limit: 50,
});
const itemSearchResult = findResult.value!;

// Read template files through the FileReaderPort (same path as template-resource use-case)
console.error("reading template files…");
const templateSnapshots: Record<string, { content: string; location: string }> = {};
for (const [type, loc] of Object.entries(typeTemplatePaths)) {
  try {
    const locPath =
      typeof loc === "object" && "kind" in loc && (loc as { kind: string }).kind === "file"
        ? (loc as { path: string }).path
        : "inline";
    const content = fileReader ? await fileReader.fetchContent(loc) : "";
    templateSnapshots[type] = { content, location: locPath };
    console.error(`  ${type}: ${locPath} (${content.length} bytes)`);
  } catch (err) {
    console.error(`  ${type}: SKIPPED — ${err instanceof Error ? err.message : err}`);
  }
}

// ── Write output as raw JSON (not TypeScript) ────────────────────────────────

const outputDir = args["output-dir"] ?? resolve(Deno.cwd(), "scripts/capture-output");

await Deno.mkdir(outputDir, { recursive: true });

const platformStatePath = resolve(outputDir, "platform-state.json");
await Deno.writeTextFile(platformStatePath, JSON.stringify(platformState, null, 2));
console.error(`wrote platform state → ${platformStatePath}`);

const itemsPath = resolve(outputDir, "items.json");
await Deno.writeTextFile(itemsPath, JSON.stringify(itemSearchResult, null, 2));
console.error(`wrote items → ${itemsPath}`);

const templatesPath = resolve(outputDir, "templates.json");
await Deno.writeTextFile(templatesPath, JSON.stringify(templateSnapshots, null, 2));
console.error(`wrote templates → ${templatesPath}`);

console.error(`\ndone. Output written to ${outputDir}/`);
console.error("Review the JSON files and update _test_fixtures.ts constants as needed.");
