// =============================================================================
// src/adapters/github/internal/config-reloader.ts - Live config refresh
//
// Single responsibility: re-fetch GitHub project field metadata and patch the
// shared GitHubLiveMetadata object in-place so all services that hold a reference
// to it immediately see the updated iterations, field IDs, and option maps.
//
// After the config-loader refactor: reload() calls bootstrapGitHub() directly
// — no more YAML parsing or file I/O on every reload.
// =============================================================================

import type { GitHubClient } from "./http-client.ts";
import type { GitHubBackendConfig } from "../types.ts";
import { bootstrapGitHub, type GitHubBootState } from "../bootstrap.ts";

export class ConfigReloader {
  constructor(
    private readonly ghConfig: GitHubBackendConfig,
    private readonly bootState: GitHubBootState,
    private readonly github: GitHubClient,
    private readonly projectRoot: string,
    private readonly configDesc: string,
  ) {}

  async reload(): Promise<void> {
    const freshLive = await bootstrapGitHub({
      ghConfig: this.ghConfig,
      github: this.github,
      projectRoot: this.projectRoot,
      configDesc: this.configDesc,
      iterationAsOf: this.bootState.iterationAsOf,
    });

    // Patch everything in one atomic operation — replaces all live fields.
    Object.assign(this.bootState.live, freshLive);
  }
}
