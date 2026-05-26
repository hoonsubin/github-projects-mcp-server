// =============================================================================
// src/adapters/github/factory.ts - GitHub adapter factory
//
// Single responsibility: construct and wire all GitHub adapter services,
// returning a platform-agnostic BackendResult to the composition root via
// the AdapterFactory interface.
//
// Keeping this logic inside the adapter package means index.ts only needs
// one import - it calls createBackend([new GitHubAdapterFactory()]) without
// knowing which internal services exist or how they depend on each other.
// =============================================================================

import { GITHUB_CAPABILITIES } from "../capabilities.ts";
import type { AdapterFactory, AdapterStartupOptions, BackendResult } from "../factory.ts";
import { loadConfig } from "./config-loader.ts";
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

// ── GitHubAdapterFactory ─────────────────────────────────────────────────────

/**
 * GitHub Projects adapter factory.
 * Implements AdapterFactory so the composition root can construct the
 * backend through the registry without importing adapter internals directly.
 */
export class GitHubAdapterFactory implements AdapterFactory {
  readonly platform = "github";

  async create(options?: AdapterStartupOptions): Promise<BackendResult> {
    const config = await loadConfig({
      github: { graphql },
      configPath: options?.configPath,
    });
    const gh = config.scrumConfig.backends.github as GitHubBackendConfig;
    const ghClient = { graphql, rest };
    const { owner } = gh;
    const primaryRepo = gh.tracked_repos[0]; // multi-repo support is future work

    // ── Resolve display config at construction time ──────────────────────

    const typeDisplay: Record<string, string> | null = gh.type_mapping
      ? Object.fromEntries(Object.entries(gh.type_mapping).map(([k, v]) => [k, v.display]))
      : null;

    const displayConfig: GitHubBackendDependencies["displayConfig"] = {
      statusDisplay: gh.status_display ?? {},
      priorityDisplay: gh.priority_display ?? {},
      typeDisplay,
    };

    // ── Service construction - each service receives only what it needs ──

    const labelResolver = new LabelResolver(config, ghClient, owner, primaryRepo);

    const userMilestoneResolver = new UserMilestoneResolver(
      ghClient,
      owner,
      primaryRepo,
      labelResolver,
    );

    const fieldValueMutator = new FieldValueMutator(
      config,
      ghClient,
      userMilestoneResolver,
    );

    const burndownCalculator = new BurndownCalculator(config, ghClient, owner, primaryRepo);

    const sprintHistoryService = new SprintHistoryService(config, ghClient, owner, primaryRepo);

    const vocabularyManager = new VocabularyManager(
      config,
      ghClient,
      labelResolver,
      owner,
      primaryRepo,
    );

    const storyQueryService = new StoryQueryService(config, ghClient, owner, primaryRepo);

    const epicService = new EpicService(ghClient, owner, gh.tracked_repos, storyQueryService);

    const storyMutationService = new StoryMutationService(
      config,
      ghClient,
      owner,
      primaryRepo,
      labelResolver,
      userMilestoneResolver,
      fieldValueMutator,
    );

    const impedimentService = new ImpedimentService(
      config,
      ghClient,
      owner,
      primaryRepo,
      labelResolver,
      storyMutationService,
    );

    const configReloader = new ConfigReloader(config, ghClient);

    // ── New unified services (P7) ───────────────────────────────────────

    const analyticsService = new AnalyticsService(
      config,
      sprintHistoryService,
      burndownCalculator,
    );

    const boardHealthService = new BoardHealthService(
      config,
      storyQueryService,
      impedimentService,
    );

    // ── File reader ──────────────────────────────────────────────────────

    // projectRoot is explicit when --root is given; falls back to Deno.cwd() otherwise.
    // This keeps template paths (e.g. ".github/ISSUE_TEMPLATE/story.yml") resolving
    // from the project root regardless of where the binary was invoked from.
    const localRoot = options?.projectRoot ?? Deno.cwd();
    const fileReader = new GitHubFileReader(owner, primaryRepo, localRoot);

    // ── Facade assembly - single parameter object, no positional args ────

    const deps: GitHubBackendDependencies = {
      labelResolver,
      fieldValueMutator,
      vocabularyManager,
      storyQueryService,
      storyMutationService,
      impedimentService,
      epicService,
      config,
      owner,
      repo: primaryRepo,
      configReloader,
      displayConfig,
      analyticsService,
      boardHealthService,
    };

    const backend = new GitHubProjectBackend(deps);

    return {
      backend,
      capabilities: GITHUB_CAPABILITIES,
      fileReader,
      scrumConfig: config.scrumConfig,
      typeTemplatePaths: config.typeTemplatePaths,
    };
  }
}
