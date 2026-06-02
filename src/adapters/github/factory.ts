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
//
//   - LIVE metadata is NOT fetched at construction time. The factory initializes
//     an empty skeleton for live; the first orientUseCase → reload() call is
//     the sole bootstrap query. Only typeTemplatePaths (a pure computation from
//     config, no API call) is resolved here for MCP template resource registration.
// =============================================================================

import { GITHUB_CAPABILITIES } from "../capabilities.ts";
import type { AdapterFactory, AdapterStartupOptions, BackendResult } from "../factory.ts";
import { computeTypeTemplatePaths, type GitHubBootState } from "./bootstrap.ts";
import { GitHubProjectBackend } from "./backend.ts";
import type { GitHubBackendDependencies } from "./backend.ts";
import { graphql, rest } from "./internal/http-client.ts";
import type { GitHubInfraContext } from "./internal/infra-context.ts";
import type { GitHubLiveMetadata } from "./bootstrap.ts";
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
import { DirectLookupAssembler } from "./internal/assemblers/direct-lookup-assembler.ts";
import { ProjectItemsAssembler } from "./internal/assemblers/project-items-assembler.ts";
import { SearchApiAssembler } from "./internal/assemblers/search-api-assembler.ts";
import { MixedAssembler } from "./internal/assemblers/mixed-assembler.ts";
import { ExecutionEngine } from "./internal/execution-engine.ts";
import { ResultNormalizer } from "./internal/result-normalizer.ts";
import { ProjectItemsQueryBuilder } from "./internal/project-items-query-builder.ts";
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
 *
 * NOTE: Live metadata (fields, iterations, options) is NOT fetched here.
 * bootState.live starts as an empty skeleton; the first orientUseCase →
 * backend.reload() → ConfigReloader.reload() fills it via bootstrapGitHub().
 * Only typeTemplatePaths (a pure config computation, no API call) is resolved
 * at construction time for MCP template resource registration.
 */
export class GitHubAdapterFactory implements AdapterFactory {
  readonly platform = "github";

  // deno-lint-ignore require-await
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

    // ── Pure: compute type template paths from config (no API call) ───────
    //    bootstrapGitHub() would also compute these, but we need them at
    //    construction time for MCP resource registration, BEFORE the first
    //    orient call triggers the real bootstrap. Since the computation is
    //    pure (resolveLocation does only string/URL manipulation), we compute
    //    it separately here.
    const typeTemplatePaths = computeTypeTemplatePaths(resolvedGhConfig.type_mapping, projectRoot);

    // ── Assemble boot state with EMPTY live metadata skeleton ─────────────
    //    bootState.live is a mutable object patched in-place by ConfigReloader
    //    on the first reload(). Every service that reads it (via ctx.config.live)
    //    only does so lazily, AFTER the first orient call populates the data.
    const emptyLive: GitHubLiveMetadata = {
      typeResolution: { source: "board_field", fieldId: "" },
      projectId: "",
      fields: {
        sprintFieldId: "",
        statusFieldId: "",
        storyPointsFieldId: null,
        priorityFieldId: null,
        epicFieldId: null,
        assigneeFieldId: null,
      },
      statusOptions: {},
      priorityOptions: {},
      typeOptions: {},
      typeTemplatePaths,
      iterations: {
        active: null,
        next: null,
        completed: [],
        all: [],
      },
    };

    const bootState: GitHubBootState = {
      scrumConfig,
      ghConfig: resolvedGhConfig,
      live: emptyLive,
    };

    // ── Tier 1: Infrastructure context ────────────────────────────────────
    const ctx: GitHubInfraContext = {
      config: bootState,
      gh: ghClient,
      owner,
      repo: primaryRepo,
      ghConfig: resolvedGhConfig,
    };

    // ── Tier 2: Domain services (ctx + named domain deps) ──────────────────

    const labelResolver = new LabelResolver(ctx);

    const userMilestoneResolver = new UserMilestoneResolver(ctx);

    const fieldValueMutator = new FieldValueMutator(ctx, userMilestoneResolver);

    const burndownCalculator = new BurndownCalculator(ctx);

    const sprintHistoryService = new SprintHistoryService(ctx);

    const vocabularyManager = new VocabularyManager(ctx, labelResolver);

    const storyQueryService = new StoryQueryService(ctx);

    const storyMutationService = new StoryMutationService(
      ctx,
      labelResolver,
      userMilestoneResolver,
      fieldValueMutator,
    );

    const impedimentService = new ImpedimentService(ctx, labelResolver, storyMutationService);

    // ── Assembler pipeline ────────────────────────────────────────────────
    const executionEngine = new ExecutionEngine(ghClient);
    const resultNormalizer = new ResultNormalizer(bootState);
    const projectItemsQueryBuilder = new ProjectItemsQueryBuilder(resolvedGhConfig.owner_type);

    const projectItemsAssembler = new ProjectItemsAssembler(
      executionEngine,
      resultNormalizer,
      projectItemsQueryBuilder,
      bootState,
    );
    const directLookupAssembler = new DirectLookupAssembler(
      ghClient,
      resultNormalizer,
      bootState,
    );
    const searchApiAssembler = new SearchApiAssembler(
      executionEngine,
      resultNormalizer,
      projectItemsAssembler,
      bootState,
    );
    const mixedAssembler = new MixedAssembler(projectItemsAssembler);

    // ── Excluded from ctx pattern (different dep shapes) ─────────────────────
    const epicService = new EpicService(
      ghClient,
      owner,
      resolvedGhConfig.tracked_repos,
      projectItemsAssembler,
    );

    const configReloader = new ConfigReloader(
      resolvedGhConfig,
      bootState,
      ghClient,
      projectRoot,
      configDesc,
    );

    // ── Tier 3: Composed services ─────────────────────────────────────────

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
      gh: ghClient,
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
      directLookupAssembler,
      projectItemsAssembler,
      searchApiAssembler,
      mixedAssembler,
    };

    const backend = new GitHubProjectBackend(deps);

    return {
      backend,
      capabilities: GITHUB_CAPABILITIES,
      fileReader,
      typeTemplatePaths,
    };
  }
}
