// =============================================================================
// src/adapters/github/factory.ts — GitHub backend factory
//
// Single responsibility: construct and wire all GitHub adapter services,
// returning a platform-agnostic ProjectBackend to the composition root.
//
// Keeping this logic inside the adapter package means index.ts only needs
// one import — it calls createGitHubProjectBackend() without knowing which
// internal services exist or how they depend on each other.
// =============================================================================

import { loadConfig } from "./config-loader.ts";
import { GitHubProjectBackend } from "./backend.ts";
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
import { VocabularyManager } from "./internal/vocabulary-manager.ts";
import type { GitHubBackendConfig } from "./types.ts";
import type { ProjectBackend } from "../../scrum/ports.ts";
import type { ScrumConfig } from "../../domain/config.ts";

// ── Return type ───────────────────────────────────────────────────────────────

/** The two values the composition root needs after backend construction. */
export interface GitHubBackendResult {
  backend: ProjectBackend;
  scrumConfig: ScrumConfig;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Load config, construct all internal services in dependency order, assemble
 * the GitHubProjectBackend facade, and return the platform-agnostic result.
 *
 * Called once at startup from src/index.ts (the composition root). All wiring
 * knowledge stays here — callers receive only the ProjectBackend interface.
 */
export const createGitHubProjectBackend = async (): Promise<GitHubBackendResult> => {
  const config = await loadConfig({ github: { graphql } });
  const gh = config.scrumConfig.backends.github as GitHubBackendConfig;
  const ghClient = { graphql, rest };
  const { owner } = gh;
  const primaryRepo = gh.tracked_repos[0]; // multi-repo support is future work

  // ── Service construction — each service receives only what it needs ─────────

  const labelResolver = new LabelResolver(config, ghClient, owner, primaryRepo);

  const userMilestoneResolver = new UserMilestoneResolver(
    ghClient,
    owner,
    primaryRepo,
    labelResolver,
  );

  const fieldValueMutator = new FieldValueMutator(config, ghClient, userMilestoneResolver);

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
    fieldValueMutator,
  );

  const configReloader = new ConfigReloader(config, ghClient);

  // ── Facade assembly ────────────────────────────────────────────────────────

  const backend = new GitHubProjectBackend(
    labelResolver,
    userMilestoneResolver,
    fieldValueMutator,
    burndownCalculator,
    sprintHistoryService,
    vocabularyManager,
    storyQueryService,
    storyMutationService,
    impedimentService,
    config,
    owner,
    primaryRepo,
    configReloader,
  );

  return { backend, scrumConfig: config.scrumConfig };
};
