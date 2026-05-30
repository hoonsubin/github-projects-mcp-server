// =============================================================================
// src/scrum/config-boot.ts - Use-case YAML config loading
//
// Single responsibility: fetch + parse the scrum config YAML from a
// ContentLocation. Validates required top-level sections but does NOT resolve
// $ENV_VAR references or make any network calls — those are adapter concerns.
//
// Extracted from src/adapters/github/config-loader.ts per the config-loader
// refactoring plan (plans/config-loader-refactor.md Phase 1).
// =============================================================================

import { parse } from "@std/yaml";
import { dirname, resolve } from "@std/path";
import { fetchContent } from "./fetch-location.ts";
import { describeContentLocation } from "../domain/content-location.ts";
import type { ContentLocation } from "../domain/content-location.ts";
import type { ScrumConfig } from "../domain/config.ts";

export interface BootConfig {
  readonly scrumConfig: ScrumConfig;
  readonly projectRoot: string;
}

/**
 * Fetch and parse the scrum config YAML from wherever `configLocation` points.
 *
 * Validates required top-level sections. Does NOT resolve $ENV_VAR references
 * or make any network calls — that is the adapter's responsibility.
 */
export const loadScrumConfig = async (
  configLocation: ContentLocation,
): Promise<BootConfig> => {
  const configDesc = describeContentLocation(configLocation);

  let rawYml: string;
  try {
    rawYml = await fetchContent(configLocation);
  } catch (err) {
    throw new Error(
      `Cannot read config at '${configDesc}': ${
        err instanceof Error ? err.message : String(err)
      }. ` +
        `Ensure the server is started from the project root, or pass --config <path>.`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parse(rawYml) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to parse ${configDesc}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed.project) {
    throw new Error(`${configDesc} is missing required 'project' section.`);
  }
  if (!parsed.scrum) {
    throw new Error(`${configDesc} is missing required 'scrum' section.`);
  }
  if (!parsed.backends) {
    throw new Error(`${configDesc} is missing required 'backends' section.`);
  }

  const scrumConfig = parsed as unknown as ScrumConfig;

  // Compute baseDir: the directory portion of the config location.
  const baseDir: string = (() => {
    switch (configLocation.kind) {
      case "file":
        return dirname(configLocation.path);
      case "url":
        return dirname(configLocation.url.pathname);
      case "inline":
        return Deno.cwd();
    }
  })();

  const projectRoot = scrumConfig.project.projRoot
    ? resolve(baseDir, scrumConfig.project.projRoot)
    : baseDir;

  return { scrumConfig, projectRoot };
};
