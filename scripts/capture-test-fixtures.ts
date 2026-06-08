// =============================================================================
// scripts/capture-test-fixtures.ts
//
// Calls the production AdapterFactory → BackendResult pipeline (same path as
// the MCP server at startup), then dumps port-level responses into a single
// captured.json file for direct import by tests. No raw GraphQL, no config-internal reach.
//
// Usage:
//   deno task capture-fixtures -- .github/scrum/config.yml
//   deno task capture-fixtures -- .github/scrum/config.yml .github/scrum/org-config.yml
//
// Requires GITHUB_TOKEN in the environment.
// =============================================================================

import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path/resolve";
import { resolveLocation } from "../src/scrum/resolve-location.ts";
import { loadScrumConfig } from "../src/scrum/config-boot.ts";
import { createBackend } from "../src/adapters/factory.ts";
import { GitHubAdapterFactory } from "../src/adapters/github/factory.ts";
import { deriveConfigSlug } from "./capture/slug.ts";

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args);
const configPaths: string[] = args._.map(String);

if (configPaths.length === 0) {
  console.error("Error: At least one config path is required as a positional argument.");
  console.error("Usage: deno run scripts/capture-test-fixtures.ts -- <config-path> [...]");
  Deno.exit(1);
}

// ── Profile builder ───────────────────────────────────────────────────────────

interface CaptureProfile {
  configPath: string;
  platformState: unknown;
  findItems: unknown;
  itemDetails: Record<string, unknown>;
}

const captureConfig = async (configPath: string): Promise<CaptureProfile> => {
  const slug = deriveConfigSlug(configPath);
  console.log(`=== Capturing: ${configPath} → ${slug} ===`);

  // Load config and build backend via production pipeline.
  const configLocation = resolveLocation(configPath, resolve(Deno.cwd()));
  const { scrumConfig, projectRoot } = await loadScrumConfig(configLocation);

  const startupOptions = {
    configLocation,
    scrumConfig,
    projectRoot,
    env: (name: string) => Deno.env.get(name),
  };

  const { backend } = await createBackend([new GitHubAdapterFactory()], startupOptions);

  // Reload to pick up live field metadata.
  await backend.reload();

  // Canonical vocabulary keys from config — passed to getPlatformState().
  const canonicalStatusKeys = Object.keys(scrumConfig.scrum.status);
  const canonicalPriorityKeys = scrumConfig.scrum.priority.map((p) => p.key);

  // ── platformState ────────────────────────────────────────────────────────
  console.log("  platformState:");
  const platformResult = await backend.getPlatformState({
    canonicalStatusKeys,
    canonicalPriorityKeys,
  });
  if (!platformResult.value) {
    throw new Error(
      `getPlatformState failed for ${configPath}: ${JSON.stringify(platformResult.warnings)}`,
    );
  }

  // ── findItems (all items) ────────────────────────────────────────────────
  console.log("  findItems:");
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
  if (!findResult.value) {
    throw new Error(`findItems failed for ${configPath}: ${JSON.stringify(findResult.warnings)}`);
  }

  // ── itemDetails (one per item, skip on failure) ──────────────────────────
  console.log("  itemDetails:");
  const itemDetails: Record<string, unknown> = {};
  for (const item of findResult.value.items) {
    try {
      const detailResult = await backend.getStoryDetail({ id: item.ref.id });
      if (!detailResult.value) continue;
      // Use the human-readable key when available.
      const key = item.ref.key ?? item.ref.id;
      itemDetails[key] = detailResult.value;
      console.log(`    ${key}: OK`);
    } catch (err) {
      const key = item.ref.key ?? item.ref.id;
      console.log(`    ${key}: SKIPPED (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  return {
    configPath,
    platformState: platformResult.value,
    findItems: findResult.value,
    itemDetails,
  };
};

// ── Main ──────────────────────────────────────────────────────────────────────

const profiles: Record<string, CaptureProfile> = {};
let totalItems = 0;

for (const configPath of configPaths) {
  try {
    const profile = await captureConfig(configPath);
    const slug = deriveConfigSlug(configPath);
    profiles[slug] = profile;
    totalItems += Object.keys(profile.findItems as Record<string, unknown>).length;
  } catch (err) {
    console.error(`FATAL for ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const output = {
  capturedAt: new Date().toISOString(),
  schemaVersion: 1,
  profiles,
};

const OUT = resolve(Deno.cwd(), "src/test/__fixtures__/captured.json");
await Deno.writeTextFile(OUT, JSON.stringify(output, null, 2));

console.log(
  `\nWrote ${OUT} (${Object.keys(profiles).length} profiles, ~${totalItems} total items)`,
);
