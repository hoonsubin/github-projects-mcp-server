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
import type { GitHubClient } from "./infra/http-client.ts";
import { BoardScanCoordinator } from "./read-services/board-scan-coordinator.ts";
import { ConfigReloader } from "./infra/config-reloader.ts";
import { FieldValueMutator } from "./write-services/field-value-mutator.ts";
import { ImpedimentService } from "./read-services/impediment-service.ts";
import { LabelResolver } from "./write-services/label-resolver.ts";
import { SprintDataService } from "./read-services/sprint-data-service.ts";
import { EpicMutationService } from "./write-services/epic-mutation-service.ts";
import { StoryMutationService } from "./write-services/story-mutation-service.ts";
import { StoryQueryService } from "./read-services/story-query-service.ts";
import { UserMilestoneResolver } from "./write-services/user-milestone-resolver.ts";
import { EpicService } from "./read-services/epic-service.ts";
import { VocabularyManager } from "./write-services/vocabulary-manager.ts";
import { DirectLookupAssembler } from "./assemblers/direct-lookup-assembler.ts";
import { ProjectItemsAssembler } from "./assemblers/project-items-assembler.ts";
import { SearchApiAssembler } from "./assemblers/search-api-assembler.ts";
import { MixedAssembler } from "./assemblers/mixed-assembler.ts";
import { ExecutionEngine } from "./query-pipeline/execution-engine.ts";
import { ResultNormalizer } from "./query-strategies/result-normalizer.ts";
import { GitHubFileReader } from "./infra/file-reader.ts";
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

  const epicMutationService = new EpicMutationService(ctx);

  const fileReader = new GitHubFileReader(owner, primaryRepo, resolvedToken);

  const deps: GitHubBackendDependencies = {
    gh: ghClient,
    boardScan,
    labelResolver,
    fieldValueMutator,
    vocabularyManager,
    storyQueryService,
    storyMutationService,
    epicMutationService,
    impedimentService,
    epicService,
    config: bootState,
    ghConfig,
    owner,
    repo: primaryRepo,
    configReloader,
    sprintDataService,
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
