// =============================================================================
// src/adapters/github/internal/infra-context.ts - GitHubInfraContext
//
// Infrastructure context carrying only platform config and the API client.
// Domain collaborators (LabelResolver, etc.) are constructed FROM the context
// and injected explicitly as named constructor parameters.
//
// Two-tier split (per implementation-strategy.md Pattern A):
//   Tier 1 - GitHubInfraContext (this file): config, gh, owner, repo, ghConfig
//   Tier 2 - Domain services receive ctx + named domain deps
//
// EpicService and ConfigReloader are intentionally excluded - they have
// different dependency shapes (tracked_repos, projectRoot, configDesc)
// and are not candidates for this pattern.
// =============================================================================

import type { GitHubBootState } from "../bootstrap.ts";
import type { GitHubClient } from "./http-client.ts";
import type { GitHubBackendConfig } from "../types.ts";

/**
 * Infrastructure context - carries only the four values every service needs
 * to talk to the GitHub API. Domain services are constructed from this and
 * injected explicitly.
 */
export interface GitHubInfraContext {
  readonly config: GitHubBootState;
  readonly gh: GitHubClient;
  readonly owner: string;
  readonly repo: string; // primaryRepo
  readonly ghConfig: GitHubBackendConfig;
}
