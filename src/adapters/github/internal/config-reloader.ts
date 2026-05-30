// =============================================================================
// src/adapters/github/internal/config-reloader.ts - Live config refresh
//
// Single responsibility: re-fetch GitHub project field metadata and patch the
// shared RuntimeConfig object in-place so all services that hold a reference
// to it immediately see the updated iterations, field IDs, and option maps.
// =============================================================================

import { loadConfig, type RuntimeConfig } from "../config-loader.ts";
import type { ContentLocation } from "../../../domain/content-location.ts";
import type { GitHubClient } from "./http-client.ts";

export class ConfigReloader {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly github: GitHubClient,
    private readonly configLocation: ContentLocation,
  ) {}

  async reload(): Promise<void> {
    const fresh = await loadConfig({ github: this.github, configLocation: this.configLocation });

    // Patch iterations in-place - every service reads these via the shared reference
    this.config.iterations.active = fresh.iterations.active;
    this.config.iterations.next = fresh.iterations.next;
    this.config.iterations.completed = fresh.iterations.completed;
    this.config.iterations.all = fresh.iterations.all;

    // Patch field IDs (renamed fields on the board would change these)
    Object.assign(this.config.fields, fresh.fields);

    // Replace option maps (added/removed/renamed options change these)
    this.replaceMap(this.config.statusOptions, fresh.statusOptions);
    this.replaceMap(this.config.priorityOptions, fresh.priorityOptions);
    this.replaceMap(this.config.typeOptions, fresh.typeOptions);
  }

  private replaceMap(target: Record<string, string>, source: Record<string, string>): void {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, source);
  }
}
