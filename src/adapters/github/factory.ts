// =============================================================================
// src/adapters/github/factory.ts - GitHub adapter factory
//
// Single responsibility: construct and wire all GitHub adapter services,
// returning a platform-agnostic BackendResult to the composition root via
// the AdapterFactory interface.
//
// Keeping this logic inside the adapter package means server.ts only needs
// one import - it calls createBackend([new GitHubAdapterFactory()]) without
// knowing which internal services exist or how they depend on each other.
//
// Key architectural boundaries (per config-loader refactor):
//   - YAML I/O lives in src/scrum/config-boot.ts (use-case layer).
//   - Token resolution + validation happens HERE, once, from the config file's
//     declared env var name — never from a hardcoded GITHUB_TOKEN.
//   - GitHubBackendConfig is cast ONCE here (from unknown). All services
//     receive typed ghConfig via constructor injection.
//   - Immutable boot constants (scrumConfig, ghConfig) vs mutable live metadata
//     (GitHubLiveMetadata) are separated at the type level.
// =============================================================================

import { GITHUB_CAPABILITIES } from "../capabilities.ts";
import type { AdapterFactory, AdapterStartupOptions, BackendResult } from "../factory.ts";
import { bootstrapGitHub, type GitHubBootState } from "./bootstrap.ts";
import { GitHubProjectBackend } from "./backend.ts";
import type { GitHubBackendDependencies } from "./backend.ts";
import { graphql, rest } from "./internal/http-client.ts";
import { BurndownCalculator } from "./internal/burndown-calculator.ts";
import { ConfigReloader } from "./internal/config-reloader.ts";
import { FieldValueMutator } from "./internal/field-value-mutator.ts";
import { ImpedimentService } from "./internal/impediment-service.ts";
import { LabelResolver } from "./internal/label-resolver.ts";
import { SprintHistoryService } from "./internal/sprint-history-service.ts";
import { StoryMutationService } from "./internal/story-mutation-service.ts";
import { StoryQueryService } from "./internal/story-query-service.ts";
import { UserMilestoneResolver } from "./internal/user-milestone-resolver.ts";
import { EpicService } from "./internal/epic-service.ts";
import { VocabularyManager } from "./internal/vocabulary-manager.ts";
import { AnalyticsService } from "./internal/analytics-service.ts";
import { BoardHealthService } from "./internal/board-health-service.ts";
import { GitHubFileReader } from "./internal/file-reader.ts";
import type { GitHubBackendConfig } from "./types.ts";
import type { ResolvedToken } from "./types.ts";
import { resolveToken, validateToken } from "./types.ts";
import { describeContentLocation } from "../../domain/content-location.ts";

// ── GitHubAdapterFactory ─────────────────────────────────────────────────────

/**
 * GitHub Projects adapter factory.
 * Implements AdapterFactory so the composition root can construct the
 * backend through the registry without importing adapter internals directly.
 */
export class GitHubAdapterFactory implements AdapterFactory {
  readonly platform = "github";

  async create(options?: AdapterStartupOptions): Promise<BackendResult> {
    const { configLocation, scrumConfig, projectRoot } = options!;
    const configDesc = describeContentLocation(configLocation);

    // ── Single-point-of-cast: backends.github → typed GitHubBackendConfig ──
    // This is the ONLY place in the codebase that casts backends.github from
    // unknown. Every internal service receives ghConfig via constructor injection.
    const ghConfig = scrumConfig.backends.github as GitHubBackendConfig;

    // ── Token resolution — one Deno.env.get() call, from the env var declared
    //    in the config file (not hardcoded GITHUB_TOKEN). ──────────────────
    const resolvedToken: ResolvedToken = resolveToken(ghConfig.auth.token, configDesc);
    validateToken(resolvedToken, configDesc);

    // Patch the token into ghConfig so services can read the literal value.
    const resolvedGhConfig: GitHubBackendConfig = {
      ...ghConfig,
      auth: { ...ghConfig.auth, token: resolvedToken },
    };

    // ── Curry the resolved token into graphql/rest so internal services
    //    never handle the token directly. ─────────────────────────────────
    const ghClient = {
      graphql: <T>(query: string, variables?: Record<string, unknown>) =>
        graphql<T>(resolvedToken, query, variables),
      rest: <T>(
        path: string,
        options?: {
          method?: "GET" | "POST" | "PATCH" | "DELETE";
          params?: Record<string, string>;
          body?: unknown;
          accept?: string;
        },
      ) => rest<T>(resolvedToken, path, options),
    };

    const { owner } = resolvedGhConfig;
    const primaryRepo = resolvedGhConfig.tracked_repos[0];

    // ── Bootstrap live GitHub project field metadata ──────────────────────
    //    Uses the same ghClient (with resolved token) to fetch field IDs,
    //    option maps, iterations, and template paths from the GitHub API.
    const live = await bootstrapGitHub({
      ghConfig: resolvedGhConfig,
      github: ghClient,
      projectRoot,
      configDesc,
    });

    // ── Assemble boot state ───────────────────────────────────────────────
    const bootState: GitHubBootState = {
      scrumConfig,
      ghConfig: resolvedGhConfig,
      live,
    };

    // ── Service construction - each service receives only what it needs ──

    const labelResolver = new LabelResolver(bootState, ghClient, owner, primaryRepo);

    const userMilestoneResolver = new UserMilestoneResolver(
      ghClient,
      owner,
      primaryRepo,
      labelResolver,
    );

    const fieldValueMutator = new FieldValueMutator(
      bootState,
      ghClient,
      userMilestoneResolver,
    );

    const burndownCalculator = new BurndownCalculator(bootState, ghClient, owner, primaryRepo);

    const sprintHistoryService = new SprintHistoryService(bootState, ghClient, owner, primaryRepo);

    const vocabularyManager = new VocabularyManager(
      bootState,
      ghClient,
      labelResolver,
      owner,
      primaryRepo,
    );

    const storyQueryService = new StoryQueryService(
      bootState,
      ghClient,
      owner,
      primaryRepo,
    );

    const epicService = new EpicService(
      ghClient,
      owner,
      resolvedGhConfig.tracked_repos,
      storyQueryService,
    );

    const storyMutationService = new StoryMutationService(
      bootState,
      ghClient,
      owner,
      primaryRepo,
      labelResolver,
      userMilestoneResolver,
      fieldValueMutator,
    );

    const impedimentService = new ImpedimentService(
      bootState,
      ghClient,
      owner,
      primaryRepo,
      labelResolver,
      storyMutationService,
    );

    const configReloader = new ConfigReloader(
      resolvedGhConfig,
      bootState,
      ghClient,
      projectRoot,
      configDesc,
    );

    // ── New unified services (P7) ───────────────────────────────────────

    const analyticsService = new AnalyticsService(
      bootState,
      sprintHistoryService,
      burndownCalculator,
    );

    const boardHealthService = new BoardHealthService(
      bootState,
      resolvedGhConfig,
      storyQueryService,
      impedimentService,
    );

    // ── File reader ──────────────────────────────────────────────────────

    const fileReader = new GitHubFileReader(owner, primaryRepo, resolvedToken);

    // ── Facade assembly - single parameter object, no positional args ────

    const deps: GitHubBackendDependencies = {
      labelResolver,
      fieldValueMutator,
      vocabularyManager,
      storyQueryService,
      storyMutationService,
      impedimentService,
      epicService,
      config: bootState,
      ghConfig: resolvedGhConfig,
      owner,
      repo: primaryRepo,
      configReloader,
      analyticsService,
      boardHealthService,
    };

    const backend = new GitHubProjectBackend(deps);

    return {
      backend,
      capabilities: GITHUB_CAPABILITIES,
      fileReader,
      typeTemplatePaths: live.typeTemplatePaths,
    };
  }
}
