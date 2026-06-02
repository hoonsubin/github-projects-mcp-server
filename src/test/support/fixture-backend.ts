// =============================================================================
// src/test/support/fixture-backend.ts
// Build ProjectBackend from captured wire fixtures (offline replay).
// =============================================================================

import { createGitHubBackend } from "../../adapters/github/create-backend.ts";
import type { GitHubBackendConfig, ResolvedToken } from "../../adapters/github/types.ts";
import { FixtureReplayClient } from "../../adapters/github/internal/fixture-replay/fixture-replay-client.ts";
import {
  DEFAULT_FIXTURES_DIR,
  loadFixtureManifest,
} from "../../adapters/github/internal/fixture-replay/load-manifest.ts";
import type { ProjectBackend } from "../../scrum/ports.ts";
import type { BootConfig } from "../../scrum/config-boot.ts";
import { deriveConfigProfile } from "./config-profile.ts";
import { assertFindItemsMatchesConfig, assertOrientMatchesConfig } from "./contract-assertions.ts";
import { handleFindItems, handleOrient } from "../../tools/scrum-read.ts";
import { formatZodError, parseToolText } from "../../tools/_mcp_result.ts";
import { ItemSearchResultSchema, OrientResultSchema } from "../../schemas/scrum-outputs.ts";
import type { ItemSearchResult, OrientResult } from "../../domain/types.ts";

const FIXTURE_TOKEN = "ghp_fixture_offline_replay" as ResolvedToken;

export interface BuildFixtureBackendOptions {
  readonly boot: BootConfig;
  readonly fixturesDir?: string;
  readonly configDesc?: string;
}

export const buildFixtureBackend = async (
  options: BuildFixtureBackendOptions,
): Promise<ProjectBackend> => {
  const { boot, fixturesDir = DEFAULT_FIXTURES_DIR, configDesc = "fixture-replay" } = options;
  const manifest = await loadFixtureManifest(fixturesDir);
  const ghConfig = boot.scrumConfig.backends.github as GitHubBackendConfig;

  const replay = new FixtureReplayClient(fixturesDir);
  await replay.loadResponses(manifest);

  const resolvedGhConfig: GitHubBackendConfig = {
    ...ghConfig,
    auth: { ...ghConfig.auth, token: FIXTURE_TOKEN },
  };

  const { backend, bootState } = createGitHubBackend({
    scrumConfig: boot.scrumConfig,
    projectRoot: boot.projectRoot,
    configDesc,
    ghConfig: resolvedGhConfig,
    ghClient: replay,
    resolvedToken: FIXTURE_TOKEN,
  });

  bootState.iterationAsOf = manifest.capturedAt;

  return backend;
};

/** Offline validation: replay fixtures through handlers + contract schemas. */
export const validateFixtureReplay = async (opts: {
  scrumConfig: BootConfig["scrumConfig"];
  projectRoot: string;
  configDesc: string;
  fixturesDir: string;
}): Promise<void> => {
  const boot: BootConfig = { scrumConfig: opts.scrumConfig, projectRoot: opts.projectRoot };
  const profile = deriveConfigProfile(boot);
  const backend = await buildFixtureBackend({
    boot,
    fixturesDir: opts.fixturesDir,
    configDesc: opts.configDesc,
  });

  await backend.reload();

  const orientPayload = parseToolText<OrientResult>(
    await handleOrient(backend, boot.scrumConfig),
  );
  const orientParsed = OrientResultSchema.safeParse(orientPayload);
  if (!orientParsed.success) {
    throw new Error(`Fixture replay orient schema failed:\n${formatZodError(orientParsed.error)}`);
  }
  assertOrientMatchesConfig(orientPayload, profile);

  const findPayload = parseToolText<ItemSearchResult>(
    await handleFindItems(backend, {
      scope: "all",
      include_dependencies: false,
      limit: 50,
    }),
  );
  const findParsed = ItemSearchResultSchema.safeParse(findPayload);
  if (!findParsed.success) {
    throw new Error(
      `Fixture replay find-items schema failed:\n${formatZodError(findParsed.error)}`,
    );
  }
  assertFindItemsMatchesConfig(findPayload, profile);
};
