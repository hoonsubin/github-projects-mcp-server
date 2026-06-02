// =============================================================================
// Wire-level fixture capture — raw GraphQL via production code paths.
// =============================================================================

import { resolve } from "@std/path";
import {
  type GitHubClient,
  graphql as rawGraphql,
} from "../../../src/adapters/github/internal/http-client.ts";
import { bootstrapGitHub, type GitHubBootState } from "../../../src/adapters/github/bootstrap.ts";
import { PaginatedProjectItemFetcher } from "../../../src/adapters/github/internal/pagination.ts";
import { ProjectItemsQueryBuilder } from "../../../src/adapters/github/internal/project-items-query-builder.ts";
import type { GitHubInfraContext } from "../../../src/adapters/github/internal/infra-context.ts";
import { createGitHubBackend } from "../../../src/adapters/github/create-backend.ts";
import {
  GET_REPO_LABELS_QUERY,
  GET_USER_NODE_ID,
  LIST_MILESTONES_QUERY,
} from "../../../src/adapters/github/queries.ts";
import type { GitHubBackendConfig, ResolvedToken } from "../../../src/adapters/github/types.ts";
import type { ScrumConfig } from "../../../src/domain/config.ts";
import type { ProjectItem } from "../../../src/adapters/github/types.ts";
import {
  mergeWireEntries,
  RecordingGitHubClient,
} from "../../../src/adapters/github/internal/fixture-replay/recording-client.ts";
import type { WireResponseEntry } from "../../../src/adapters/github/internal/fixture-replay/types.ts";
import { buildFixtureCatalog } from "./catalog.ts";
import type { FixtureCatalog } from "../../../src/adapters/github/internal/fixture-replay/types.ts";

export interface WireCaptureResult {
  readonly wireEntries: WireResponseEntry[];
  readonly legacyFiles: string[];
  readonly catalog: FixtureCatalog;
  readonly bootState: GitHubBootState;
  readonly fullBoardItems: ProjectItem[];
}

const writeLegacyPaginatedFiles = async (
  fixturesDir: string,
  prefix: string,
  responses: unknown[],
): Promise<string[]> => {
  const written: string[] = [];
  if (responses.length === 0) return written;

  if (responses.length === 1) {
    const path = resolve(fixturesDir, `${prefix}.json`);
    await Deno.writeTextFile(path, JSON.stringify(responses[0], null, 2));
    written.push(`${prefix}.json`);
    return written;
  }

  for (let i = 0; i < responses.length; i++) {
    const name = `${prefix}-p${i + 1}.json`;
    await Deno.writeTextFile(
      resolve(fixturesDir, name),
      JSON.stringify(responses[i], null, 2),
    );
    written.push(name);
  }
  return written;
};

export const captureWireFixtures = async (opts: {
  scrumConfig: ScrumConfig;
  projectRoot: string;
  configDesc: string;
  resolvedGhConfig: GitHubBackendConfig;
  resolvedToken: ResolvedToken;
  fixturesDir: string;
}): Promise<WireCaptureResult> => {
  const { scrumConfig, projectRoot, configDesc, resolvedGhConfig, resolvedToken, fixturesDir } =
    opts;

  const realGraphql = <T>(query: string, variables?: Record<string, unknown>) =>
    rawGraphql<T>(resolvedToken, query, variables ?? {});

  const liveClient: GitHubClient = {
    graphql: realGraphql,
    rest: () => Promise.reject(new Error("REST not captured in wire phase")),
  };

  const recorder = new RecordingGitHubClient(liveClient);
  const wireEntryGroups: WireResponseEntry[] = [];
  const legacyFiles: string[] = [];

  // ── Phase 1: bootstrap ────────────────────────────────────────────────────
  const live = await bootstrapGitHub({
    ghConfig: resolvedGhConfig,
    github: recorder,
    projectRoot,
    configDesc,
  });

  const bootstrapCalls = [...recorder.calls];
  if (bootstrapCalls.length > 0) {
    const bootstrapPath = resolve(fixturesDir, "bootstrap-fields.json");
    await Deno.writeTextFile(
      bootstrapPath,
      JSON.stringify(bootstrapCalls[0].response, null, 2),
    );
    legacyFiles.push("bootstrap-fields.json");
  }

  wireEntryGroups.push(...await recorder.persistWireResponses(fixturesDir));
  recorder.resetCallLog();

  const bootState: GitHubBootState = { scrumConfig, ghConfig: resolvedGhConfig, live };

  const ctx: GitHubInfraContext = {
    config: bootState,
    gh: recorder,
    owner: resolvedGhConfig.owner,
    repo: resolvedGhConfig.tracked_repos[0],
    ghConfig: resolvedGhConfig,
  };

  const queryBuilder = new ProjectItemsQueryBuilder(resolvedGhConfig.owner_type);
  const fullQuery = queryBuilder.buildQuery();
  const aggregateQuery = queryBuilder.buildAggregateQuery();

  // ── Phase 2: full board pages (legacy project-items-pN.json) ───────────────
  const fullCallsStart = recorder.calls.length;
  const fullFetcher = new PaginatedProjectItemFetcher(ctx, fullQuery);
  const fullBoardItems = await fullFetcher.collect(() => true);
  const fullPageResponses = recorder.calls.slice(fullCallsStart).map((c) => c.response);
  legacyFiles.push(
    ...await writeLegacyPaginatedFiles(fixturesDir, "project-items", fullPageResponses),
  );
  wireEntryGroups.push(...await recorder.persistWireResponses(fixturesDir));
  recorder.resetCallLog();

  // ── Phase 3: aggregate board scan ───────────────────────────────────────
  const aggregateCallsStart = recorder.calls.length;
  const aggregateFetcher = new PaginatedProjectItemFetcher(ctx, aggregateQuery);
  await aggregateFetcher.collect(() => true);
  const aggregateResponses = recorder.calls.slice(aggregateCallsStart).map((c) => c.response);
  legacyFiles.push(
    ...await writeLegacyPaginatedFiles(
      fixturesDir,
      "project-items-aggregate",
      aggregateResponses,
    ),
  );
  wireEntryGroups.push(...await recorder.persistWireResponses(fixturesDir));
  recorder.resetCallLog();

  // ── Phase 4: milestones per tracked repo ──────────────────────────────────
  for (const repo of resolvedGhConfig.tracked_repos) {
    await recorder.graphql(LIST_MILESTONES_QUERY, {
      owner: resolvedGhConfig.owner,
      repo,
      first: 50,
    });
  }
  wireEntryGroups.push(...await recorder.persistWireResponses(fixturesDir));
  recorder.resetCallLog();

  // ── Phase 5: repo labels (LabelResolver path) ─────────────────────────────
  await recorder.graphql(GET_REPO_LABELS_QUERY, {
    owner: resolvedGhConfig.owner,
    repo: resolvedGhConfig.tracked_repos[0],
    first: 100,
  });
  wireEntryGroups.push(...await recorder.persistWireResponses(fixturesDir));
  recorder.resetCallLog();

  // ── Phase 6: user node IDs ────────────────────────────────────────────────
  const loginToResolve = resolvedGhConfig.owner_type === "user"
    ? resolvedGhConfig.owner
    : (resolvedGhConfig.team?.[0]?.login ?? resolvedGhConfig.owner);

  const userNodeIds: Record<string, unknown> = {
    [loginToResolve]: await recorder.graphql(GET_USER_NODE_ID, { login: loginToResolve }),
    "_not_found_": { user: null },
  };
  const userNodeIdsPath = resolve(fixturesDir, "user-node-ids.json");
  await Deno.writeTextFile(userNodeIdsPath, JSON.stringify(userNodeIds, null, 2));
  legacyFiles.push("user-node-ids.json");
  wireEntryGroups.push(...await recorder.persistWireResponses(fixturesDir));

  const catalog = buildFixtureCatalog(resolvedGhConfig, bootState, fullBoardItems);

  // Warm createGitHubBackend path (validates wiring; no extra persist)
  createGitHubBackend({
    scrumConfig,
    projectRoot,
    configDesc,
    ghConfig: resolvedGhConfig,
    ghClient: recorder,
    resolvedToken,
  });

  return {
    wireEntries: mergeWireEntries(wireEntryGroups),
    legacyFiles,
    catalog,
    bootState,
    fullBoardItems,
  };
};
