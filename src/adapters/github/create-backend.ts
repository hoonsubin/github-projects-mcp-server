// =============================================================================
// src/adapters/github/create-backend.ts
//
// GitHub backend wiring extracted from GitHubAdapterFactory for injection
// of alternate GitHubClient implementations (live API, fixture replay, recording).
// =============================================================================

import { GITHUB_CAPABILITIES } from "../capabilities.ts";
import type { BackendResult } from "../factory.ts";
import {
  computeTypeTemplatePaths,
  type GitHubBootState,
  type GitHubLiveMetadata,
} from "./bootstrap.ts";
import { GitHubProjectBackend } from "./backend.ts";
import type { GitHubBackendDependencies } from "./backend.ts";
import type { GitHubClient } from "./internal/http-client.ts";
import { BoardScanCoordinator } from "./internal/board-scan-coordinator.ts";
import { BurndownCalculator } from "./internal/burndown-calculator.ts";
import { ConfigReloader } from "./internal/config-reloader.ts";
import { FieldValueMutator } from "./internal/field-value-mutator.ts";
import { ImpedimentService } from "./internal/impediment-service.ts";
import { LabelResolver } from "./internal/label-resolver.ts";
import { SprintDataService } from "./internal/read-services/sprint-data-service.ts";
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
import { GitHubFileReader } from "./internal/file-reader.ts";
import type { GitHubBackendConfig, ResolvedToken } from "./types.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import type { ProjectBackend } from "../../scrum/ports.ts";

export interface CreateGitHubBackendParams {
  readonly scrumConfig: ScrumConfig;
  readonly projectRoot: string;
  readonly configDesc: string;
  readonly ghConfig: GitHubBackendConfig;
  readonly ghClient: GitHubClient;
  /** Required for GitHubFileReader; use a dummy resolved token for offline replay. */
  readonly resolvedToken: ResolvedToken;
}

export interface CreateGitHubBackendResult {
  readonly backend: ProjectBackend;
  readonly fileReader: GitHubFileReader;
  readonly typeTemplatePaths: Record<
    string,
    import("../../domain/content-location.ts").ContentLocation
  >;
  readonly bootState: GitHubBootState;
}

export const createGitHubBackend = (
  params: CreateGitHubBackendParams,
): CreateGitHubBackendResult => {
  const { scrumConfig, projectRoot, configDesc, ghConfig, ghClient, resolvedToken } = params;
  const { owner } = ghConfig;
  const primaryRepo = ghConfig.tracked_repos[0];

  const typeTemplatePaths = computeTypeTemplatePaths(ghConfig.type_mapping, projectRoot);

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
    issueBackedFields: {},
  };

  const bootState: GitHubBootState = {
    scrumConfig,
    ghConfig,
    live: emptyLive,
  };

  const ctx = {
    config: bootState,
    gh: ghClient,
    owner,
    repo: primaryRepo,
    ghConfig,
  };

  const labelResolver = new LabelResolver(ctx);
  const userMilestoneResolver = new UserMilestoneResolver(ctx);
  const fieldValueMutator = new FieldValueMutator(ctx, userMilestoneResolver);
  const boardScan = new BoardScanCoordinator(ctx);
  const burndownCalculator = new BurndownCalculator(ctx, boardScan);
  const sprintHistoryService = new SprintHistoryService(ctx, boardScan);
  const vocabularyManager = new VocabularyManager(ctx, labelResolver);
  const storyQueryService = new StoryQueryService(ctx, boardScan);
  const storyMutationService = new StoryMutationService(
    ctx,
    labelResolver,
    userMilestoneResolver,
    fieldValueMutator,
  );
  const impedimentService = new ImpedimentService(
    ctx,
    labelResolver,
    storyMutationService,
    boardScan,
  );

  const executionEngine = new ExecutionEngine(ghClient);
  const resultNormalizer = new ResultNormalizer(bootState);
  const projectItemsAssembler = new ProjectItemsAssembler(
    boardScan,
    resultNormalizer,
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

  const epicService = new EpicService(
    ghClient,
    owner,
    ghConfig.tracked_repos,
    projectItemsAssembler,
  );

  const configReloader = new ConfigReloader(
    ghConfig,
    bootState,
    ghClient,
    projectRoot,
    configDesc,
  );

  const sprintDataService = new SprintDataService(ctx, boardScan);

  const analyticsService = new AnalyticsService(
    bootState,
    boardScan,
    sprintHistoryService,
    burndownCalculator,
  );

  const boardHealthService = new BoardHealthService(
    bootState,
    ghConfig,
    storyQueryService,
    impedimentService,
  );

  const fileReader = new GitHubFileReader(owner, primaryRepo, resolvedToken);

  const deps: GitHubBackendDependencies = {
    gh: ghClient,
    boardScan,
    labelResolver,
    fieldValueMutator,
    vocabularyManager,
    storyQueryService,
    storyMutationService,
    impedimentService,
    epicService,
    config: bootState,
    ghConfig,
    owner,
    repo: primaryRepo,
    configReloader,
    sprintDataService,
    analyticsService,
    boardHealthService,
    directLookupAssembler,
    projectItemsAssembler,
    searchApiAssembler,
    mixedAssembler,
  };

  return {
    backend: new GitHubProjectBackend(deps),
    fileReader,
    typeTemplatePaths,
    bootState,
  };
};

/** Wrap createGitHubBackend result in AdapterFactory BackendResult shape. */
export const toBackendResult = (result: CreateGitHubBackendResult): BackendResult => ({
  backend: result.backend,
  capabilities: GITHUB_CAPABILITIES,
  fileReader: result.fileReader,
  typeTemplatePaths: result.typeTemplatePaths,
});
