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
  string: ["output-dir", "user-logins", "search-query", "project-name", "item-keys"],
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
const itemKeysRaw: string = args["item-keys"] ?? "222,192,187";
const itemKeys: number[] = itemKeysRaw
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

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

const GET_ISSUE_PROJECT_ITEM = `
fragment ItemContent on ProjectV2Item {
  content {
    __typename
    ... on Issue {
      id number title url state body
      issueType { id name }
      assignees(first: 5) { nodes { login } }
      labels(first: 10)   { nodes { name color } }
      milestone { id title dueOn }
      repository { name nameWithOwner }
      blockedBy(first: 10) { nodes { id number title } }
      issueFieldValues(first: 25) {
        nodes {
          ... on IssueFieldNumberValue {
            value
            field { ... on IssueFieldNumber { name } }
          }
          ... on IssueFieldSingleSelectValue {
            name optionId
            field { ... on IssueFieldSingleSelect { name } }
          }
        }
      }
    }
    ... on PullRequest {
      id number title url state body isDraft
      assignees(first: 5) { nodes { login } }
      labels(first: 10)   { nodes { name color } }
      repository { name nameWithOwner }
    }
    ... on DraftIssue {
      id title body
      assignees(first: 5) { nodes { login } }
    }
  }
}

fragment ItemFieldValues on ProjectV2Item {
  fieldValues(first: 20) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldTextValue {
        text
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldNumberValue {
        number
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldDateValue {
        date
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldSingleSelectValue {
        name color optionId
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldIterationValue {
        title startDate duration iterationId
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldUserValue {
        users(first: 5) { nodes { login } }
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldLabelValue {
        labels(first: 10) { nodes { name color } }
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldMilestoneValue {
        milestone { title dueOn }
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldRepositoryValue {
        repository { name nameWithOwner }
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemIssueFieldValue {
        field {
          ... on ProjectV2Field { id name }
          ... on ProjectV2SingleSelectField { id name }
        }
        issueFieldValue {
          ... on IssueFieldSingleSelectValue {
            name optionId color
          }
          ... on IssueFieldTextValue {
            value
          }
          ... on IssueFieldNumberValue {
            value
          }
          ... on IssueFieldDateValue {
            value
          }
        }
      }
    }
  }
}

query GetIssueProjectItem($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      projectItems(first: 10) {
        nodes {
          project { number }
          id
          type
          createdAt
          updatedAt
          isArchived
          ...ItemContent
          ...ItemFieldValues
        }
      }
    }
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

/**
 * Extract owner and primary repo name from the GitHub backend config.
 * The config shape is type-erased as `unknown` at the domain boundary,
 * so we cast to the known GitHub backend shape.
 */
const extractGitHubOwnerRepo = (
  scrumConfig: Record<string, unknown>,
): { owner: string; repo: string; projectNumber: number } | null => {
  const backends = scrumConfig["backends"] as Record<string, Record<string, unknown>> | undefined;
  if (!backends) return null;
  const gh = backends["github"];
  if (!gh) return null;
  const owner = gh["owner"] as string | undefined;
  const trackedRepos = gh["tracked_repos"] as string[] | undefined;
  const projectNumber = gh["project_number"] as number | undefined;
  if (!owner || !trackedRepos || trackedRepos.length === 0 || typeof projectNumber !== "number") {
    return null;
  }
  return { owner, repo: trackedRepos[0], projectNumber };
};

// ── Raw ProjectItem capture ────────────────────────────────────────────────────

/** Shape of a raw ProjectItem node returned by GetIssueProjectItem. */
interface RawProjectItemNode {
  project: { number: number } | null;
  id: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  content: Record<string, unknown> | null;
  fieldValues: { nodes: Record<string, unknown>[] };
}

interface GetIssueProjectItemResponse {
  repository: {
    issue: {
      id: string;
      projectItems: {
        nodes: RawProjectItemNode[];
      };
    } | null;
  } | null;
}

/**
 * Capture raw ProjectItem GraphQL responses for the given issue keys.
 * Writes each item as captured/items/<key>.json in the output directory.
 * Filters by project number when an issue belongs to multiple projects.
 */
const captureRawProjectItems = async (
  githubClient: GitHubClient,
  owner: string,
  repo: string,
  itemKeys: number[],
  projectNumber: number,
  outputDir: string,
): Promise<Record<string, RawProjectItemNode>> => {
  const itemsDir = resolve(outputDir, "captured", "items");
  await ensureDir(itemsDir);
  const captured: Record<string, RawProjectItemNode> = {};

  console.error(`capturing raw ProjectItems for keys: ${itemKeys.join(", ")}…`);

  for (const key of itemKeys) {
    try {
      const data = await githubClient.graphql<GetIssueProjectItemResponse>(
        GET_ISSUE_PROJECT_ITEM,
        { owner, repo, number: key },
      );

      const issue = data.repository?.issue;
      if (!issue) {
        console.error(`  ${key}: issue not found, skipping`);
        continue;
      }

      const nodes = issue.projectItems?.nodes ?? [];
      if (nodes.length === 0) {
        console.error(`  ${key}: no project items found, skipping`);
        continue;
      }

      // Filter to the matching project number when multiple project items exist
      let node: RawProjectItemNode;
      if (nodes.length === 1) {
        node = nodes[0];
      } else {
        const filtered = nodes.filter((n) => n.project?.number === projectNumber);
        if (filtered.length === 0) {
          console.error(
            `  ${key}: no project item for project #${projectNumber} among ${nodes.length} nodes, using first`,
          );
          node = nodes[0];
        } else {
          node = filtered[0];
        }
      }

      // Write the raw node - strip only the `project` wrapper field
      const { project: _project, ...itemNode } = node;
      const itemPath = resolve(itemsDir, `${key}.json`);
      await Deno.writeTextFile(itemPath, JSON.stringify(itemNode, null, 2));
      captured[String(key)] = node;
      console.error(`  ${key}: captured raw ProjectItem → ${itemPath}`);
    } catch (err) {
      console.error(`  ${key}: SKIPPED - ${err instanceof Error ? err.message : err}`);
    }
  }

  return captured;
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
      console.error(`  ${type}: SKIPPED - ${err instanceof Error ? err.message : err}`);
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
      console.error(`  ${key}: SKIPPED - ${err instanceof Error ? err.message : err}`);
    }
  }

  const detailsPath = resolve(outputDir, "item-details.json");
  await Deno.writeTextFile(detailsPath, JSON.stringify(capturedDetails, null, 2));
  files.push(detailsPath);
  console.error(`wrote item details → ${detailsPath}`);

  // 4.5 Raw ProjectItem capture (for adapter-layer fixture generation)
  const ghOwnerRepo = extractGitHubOwnerRepo(
    scrumConfig as unknown as Record<string, unknown>,
  );
  if (ghOwnerRepo && itemKeys.length > 0) {
    const ghClient = buildGitHubClient(token);
    await captureRawProjectItems(
      ghClient,
      ghOwnerRepo.owner,
      ghOwnerRepo.repo,
      itemKeys,
      ghOwnerRepo.projectNumber,
      outputDir,
    );
  } else {
    console.error("skipping raw ProjectItem capture - no owner/repo from config or no item keys");
  }

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
        console.error(`  ${login}: SKIPPED - ${err instanceof Error ? err.message : err}`);
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
      console.error(`  search SKIPPED - ${err instanceof Error ? err.message : err}`);
    }
  }

  // 7. Field augmentation
  if (augmentConfig) {
    console.error("applying field augmentations…");
    const augmentedDir = resolve(outputDir, "augmented-items");
    await ensureDir(augmentedDir);

    // Raw items directory for augmented raw ProjectItem JSON
    const rawItemsDir = resolve(outputDir, "captured", "items");

    for (const aug of augmentConfig.augmentations) {
      // 7a. Augment normalized item detail (unchanged from before)
      const detail = capturedDetails[aug.item_key];
      if (!detail) {
        console.error(`  ${aug.item_key}: not found in captured details, skipping`);
      } else {
        const augmentedRaw = { ...detail.raw as Record<string, unknown> };
        augmentedRaw["_augmented_fields"] = aug.append_fields;
        const augmentedEntry: CapturedItemDetail = {
          normalized: detail.normalized,
          raw: augmentedRaw,
          captured_at: new Date().toISOString(),
        };
        const augPath = resolve(augmentedDir, `${aug.item_key}.json`);
        await Deno.writeTextFile(augPath, JSON.stringify(augmentedEntry, null, 2));
        files.push(augPath);
        console.error(`  ${aug.item_key}: augmented (normalized) → ${augPath}`);
      }

      // 7b. Augment raw ProjectItem - merge append_fields into fieldValues.nodes
      const rawItemPath = resolve(rawItemsDir, `${aug.item_key}.json`);
      try {
        const rawJson = await Deno.readTextFile(rawItemPath);
        const rawItem = JSON.parse(rawJson) as Record<string, unknown>;
        const fieldValues = rawItem["fieldValues"] as { nodes: unknown[] } | undefined;
        if (fieldValues && Array.isArray(fieldValues.nodes)) {
          const augmentedRawItem = JSON.parse(JSON.stringify(rawItem)); // deep clone
          const augmentedFv = augmentedRawItem["fieldValues"] as { nodes: unknown[] };
          augmentedFv.nodes = [...augmentedFv.nodes, ...aug.append_fields];
          const augRawPath = resolve(rawItemsDir, `${aug.item_key}-augmented.json`);
          await Deno.writeTextFile(augRawPath, JSON.stringify(augmentedRawItem, null, 2));
          files.push(augRawPath);
          console.error(`  ${aug.item_key}: augmented (raw) → ${augRawPath}`);
        } else {
          console.error(
            `  ${aug.item_key}: raw item has no fieldValues.nodes, skipping raw augmentation`,
          );
        }
      } catch (_err) {
        console.error(
          `  ${aug.item_key}: raw item not found at ${rawItemPath}, skipping raw augmentation`,
        );
      }
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
