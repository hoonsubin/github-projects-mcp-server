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

interface CaptureResult {
  slug: string;
  profile: CaptureProfile;
}

const captureConfig = async (configPath: string): Promise<CaptureResult> => {
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
  const platformResult = await backend.getPlatformState({ canonicalStatusKeys, canonicalPriorityKeys });
  if (!platformResult.value) {
    throw new Error(`getPlatformState failed: ${JSON.stringify(platformResult.warnings)}`);
  }
  console.log("  platformState: OK");

  // ── findItems (all items, up to 50) ─────────────────────────────────────
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
    throw new Error(`findItems failed: ${JSON.stringify(findResult.warnings)}`);
  }
  console.log(`  findItems: ${findResult.value.items.length} items`);

  // ── itemDetails (one per item, skip on error) ────────────────────────────
  // Key by stable internal ID so CapturedDataBackend.getStoryDetail({ id }) resolves correctly.
  const itemDetails: Record<string, unknown> = {};
  for (const item of findResult.value.items) {
    const label = item.ref.key || item.ref.id;
    try {
      const detailResult = await backend.getStoryDetail({ id: item.ref.id });
      if (!detailResult.value) continue;
      itemDetails[item.ref.id] = detailResult.value;
      console.log(`    ${label}: OK`);
    } catch (err) {
      console.log(`    ${label}: SKIPPED (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  return {
    slug,
    profile: { configPath, platformState: platformResult.value, findItems: findResult.value, itemDetails },
  };
};

// ── Main ──────────────────────────────────────────────────────────────────────

const profiles: Record<string, CaptureProfile> = {};
let totalItems = 0;

for (const configPath of configPaths) {
  try {
    const { slug, profile } = await captureConfig(configPath);
    profiles[slug] = profile;
    totalItems += Object.keys(profile.itemDetails).length;
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
