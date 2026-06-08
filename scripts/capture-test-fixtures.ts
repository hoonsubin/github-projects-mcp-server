// =============================================================================
// scripts/capture-test-fixtures.ts
//
// Calls the production AdapterFactory → BackendResult pipeline (same path as
// the MCP server at startup), then dumps the port-level responses as JSON files
// for manual review. No knowledge of _test_fixtures.ts internal structure,
// no raw GraphQL queries, no config-internal reach.
//
// Usage:
//   deno task capture-fixtures -- .github/scrum/config.yml
//   deno task capture-fixtures -- .github/scrum/config.yml --user-logins hoonsubin --search-query "is:issue"
//
// Requires GITHUB_TOKEN in the environment.
// =============================================================================

import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { parse as parseYaml } from "@std/yaml";
import { resolveLocation } from "../src/scrum/resolve-location.ts";
import { loadScrumConfig } from "../src/scrum/config-boot.ts";
import { createBackend } from "../src/adapters/factory.ts";
import { GitHubAdapterFactory } from "../src/adapters/github/factory.ts";
import { graphql } from "../src/adapters/github/internal/http-client.ts";
import type { AdapterStartupOptions } from "../src/adapters/factory.ts";
import type { GitHubClient } from "../src/adapters/github/internal/http-client.ts";
import type { ResolvedToken } from "../src/adapters/github/types.ts";
import type {
  AugmentationConfig,
  CapturedItemDetail,
  ResolveActorNodeIdResponse,
} from "./capture/types.ts";

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args, {
  string: ["output-dir", "user-logins", "search-query", "project-name"],
  alias: { o: "output-dir", u: "user-logins", q: "search-query", n: "project-name" },
  collect: ["project-name"],
  unknown: (flag: string) => {
    if (flag.startsWith("-")) {
      console.error(`Unknown flag: ${flag}`);
      Deno.exit(1);
    }
    return true;
  },
});

const configPaths: string[] = args._.map(String);

if (configPaths.length === 0) {
  console.error("Error: At least one config path is required as a positional argument.");
  console.error("Usage: deno run scripts/capture-test-fixtures.ts -- <config-path> [...]");
  Deno.exit(1);
}

const outputBase = args["output-dir"] ?? resolve(Deno.cwd(), "scripts/capture-output");
const userLoginsRaw: string | undefined = args["user-logins"];
const searchQuery: string | undefined = args["search-query"];
const projectNames: string[] = args["project-name"] ?? [];

// ── GraphQL queries ───────────────────────────────────────────────────────────

const RESOLVE_ACTOR_NODE_ID = `
query ResolveActorNodeId($login: String!) {
  user(login: $login) { id }
}
`;

const SEARCH_ISSUES = `
query SearchIssues($query: String!, $first: Int) {
  search(query: $query, first: $first, type: ISSUE) {
    nodes {
      ... on Issue {
        id number title state url
        repository { name owner { login } }
        labels(first: 10) { nodes { name } }
        milestone { title number }
        assignees(first: 5) { nodes { login } }
      }
    }
    issueCount
  }
}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a filesystem-safe slug from a config path. */
const deriveConfigSlug = (
  configPath: string,
  index: number,
  overrides: string[],
): string => {
  if (overrides.length > index && overrides[index]) {
    return overrides[index].replace(/[^a-zA-Z0-9_-]/g, "_");
  }
  if (configPath.startsWith("http://") || configPath.startsWith("https://")) {
    const url = new URL(configPath);
    const last = url.pathname.split("/").filter(Boolean).pop() ?? `remote-${index}`;
    return last.replace(/\.(yml|yaml)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }
  const filename = configPath.replace(/\\/g, "/").split("/").pop() ?? `config-${index}`;
  return filename.replace(/\.(yml|yaml)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
};

const buildGitHubClient = (token: string): GitHubClient => {
  const resolved = token as ResolvedToken;
  return {
    graphql: <T>(query: string, variables?: Record<string, unknown>) =>
      graphql<T>(resolved, query, variables),
    rest: () => {
      throw new Error("REST not supported in capture script");
    },
  };
};

const getToken = (): string => {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    console.error("Error: GITHUB_TOKEN environment variable is required.");
    Deno.exit(1);
  }
  return token;
};

const loadAugmentConfig = async (): Promise<AugmentationConfig | null> => {
  const augmentPath = resolve(Deno.cwd(), "scripts/capture/augment-config.yml");
  try {
    const raw = await Deno.readTextFile(augmentPath);
    return parseYaml(raw) as AugmentationConfig;
  } catch {
    console.error("  augment-config.yml not found, skipping augmentation.");
    return null;
  }
};

// ── Capture pipeline per config ───────────────────────────────────────────────

const captureConfig = async (
  configPath: string,
  configIndex: number,
  token: string,
  augmentConfig: AugmentationConfig | null,
): Promise<void> => {
  const slug = deriveConfigSlug(configPath, configIndex, projectNames);
  const outputDir = resolve(outputBase, slug);
  await ensureDir(outputDir);
  const files: string[] = [];

  console.error(`\n=== Capturing config: ${configPath} → ${slug} ===`);

  // 1. Load config and build backend
  const configLocation = resolveLocation(configPath, resolve(Deno.cwd()));
  const { scrumConfig, projectRoot } = await loadScrumConfig(configLocation);

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

  // 2. Templates: read template files through the FileReaderPort
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

  const templatesPath = resolve(outputDir, "templates.json");
  await Deno.writeTextFile(templatesPath, JSON.stringify(templateSnapshots, null, 2));
  files.push(templatesPath);
  console.error(`wrote templates → ${templatesPath}`);

  // 3. Base capture: reload → platform state → findItems → item details
  console.error("reloading backend…");
  await backend.reload();

  const canonicalStatusKeys = Object.keys(scrumConfig.scrum.status);
  const canonicalPriorityKeys = scrumConfig.scrum.priority.map((p) => p.key);

  console.error("fetching platform state…");
  const platformResult = await backend.getPlatformState({
    canonicalStatusKeys,
    canonicalPriorityKeys,
  });
  const platformState = platformResult.value!;

  const platformStatePath = resolve(outputDir, "platform-state.json");
  await Deno.writeTextFile(platformStatePath, JSON.stringify(platformState, null, 2));
  files.push(platformStatePath);
  console.error(`wrote platform state → ${platformStatePath}`);

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

  const itemsPath = resolve(outputDir, "items.json");
  await Deno.writeTextFile(itemsPath, JSON.stringify(itemSearchResult, null, 2));
  files.push(itemsPath);
  console.error(`wrote items → ${itemsPath}`);

  // 4. Individual item details
  console.error("fetching item details…");
  const detailsDir = resolve(outputDir, "item-details");
  await ensureDir(detailsDir);
  const capturedDetails: Record<string, CapturedItemDetail> = {};

  for (const item of itemSearchResult.items) {
    const key = item.ref.key || item.ref.id;
    try {
      const detailResult = await backend.getStoryDetail({ id: item.ref.id });
      const detail = detailResult.value;
      capturedDetails[key] = {
        normalized: detail,
        raw: detail,
        captured_at: new Date().toISOString(),
      };
      console.error(`  ${key}: captured`);
    } catch (err) {
      console.error(`  ${key}: SKIPPED — ${err instanceof Error ? err.message : err}`);
    }
  }

  const detailsPath = resolve(outputDir, "item-details.json");
  await Deno.writeTextFile(detailsPath, JSON.stringify(capturedDetails, null, 2));
  files.push(detailsPath);
  console.error(`wrote item details → ${detailsPath}`);

  // 5. User node IDs via GraphQL
  if (userLoginsRaw) {
    console.error("resolving user node IDs…");
    const logins = userLoginsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const ghClient = buildGitHubClient(token);
    const userNodes: Record<string, string | null> = {};

    for (const login of logins) {
      try {
        const data = await ghClient.graphql<ResolveActorNodeIdResponse>(
          RESOLVE_ACTOR_NODE_ID,
          { login },
        );
        userNodes[login] = data.user?.id ?? null;
        console.error(`  ${login}: ${data.user?.id ?? "not found"}`);
      } catch (err) {
        console.error(`  ${login}: SKIPPED — ${err instanceof Error ? err.message : err}`);
        userNodes[login] = null;
      }
    }

    const userNodesPath = resolve(outputDir, "user-nodes.json");
    await Deno.writeTextFile(userNodesPath, JSON.stringify(userNodes, null, 2));
    files.push(userNodesPath);
    console.error(`wrote user nodes → ${userNodesPath}`);
  }

  // 6. Search results via GraphQL
  if (searchQuery) {
    console.error(`searching issues: "${searchQuery}"…`);
    const ghClient = buildGitHubClient(token);
    try {
      const searchResult = await ghClient.graphql<{ search: unknown }>(
        SEARCH_ISSUES,
        { query: searchQuery, first: 50 },
      );
      const searchPath = resolve(outputDir, "search-results.json");
      await Deno.writeTextFile(searchPath, JSON.stringify(searchResult.search, null, 2));
      files.push(searchPath);
      console.error(`wrote search results → ${searchPath}`);
    } catch (err) {
      console.error(`  search SKIPPED — ${err instanceof Error ? err.message : err}`);
    }
  }

  // 7. Field augmentation
  if (augmentConfig) {
    console.error("applying field augmentations…");
    const augmentedDir = resolve(outputDir, "augmented-items");
    await ensureDir(augmentedDir);

    for (const aug of augmentConfig.augmentations) {
      const detail = capturedDetails[aug.item_key];
      if (!detail) {
        console.error(`  ${aug.item_key}: not found in captured details, skipping`);
        continue;
      }
      const augmentedRaw = { ...detail.raw as Record<string, unknown> };
      // Merge append_fields into the raw shape under a synthetic key
      augmentedRaw["_augmented_fields"] = aug.append_fields;
      const augmentedEntry: CapturedItemDetail = {
        normalized: detail.normalized,
        raw: augmentedRaw,
        captured_at: new Date().toISOString(),
      };
      const augPath = resolve(augmentedDir, `${aug.item_key}.json`);
      await Deno.writeTextFile(augPath, JSON.stringify(augmentedEntry, null, 2));
      files.push(augPath);
      console.error(`  ${aug.item_key}: augmented → ${augPath}`);
    }
  }

  console.error(`\ndone. ${files.length} files written to ${outputDir}/`);
};

// ── Main ──────────────────────────────────────────────────────────────────────

const token = getToken();
const augmentConfig = await loadAugmentConfig();

for (let i = 0; i < configPaths.length; i++) {
  try {
    await captureConfig(configPaths[i], i, token, augmentConfig);
  } catch (err) {
    console.error(`FATAL for ${configPaths[i]}: ${err instanceof Error ? err.message : err}`);
    // Continue to next config
  }
}

console.error(
  "\nCapture complete. Review the JSON files and update _test_fixtures.ts constants as needed.",
);
