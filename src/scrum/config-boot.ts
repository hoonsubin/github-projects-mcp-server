// =============================================================================
// src/scrum/config-boot.ts - Use-case YAML config loading
//
// Single responsibility: fetch + parse the scrum config YAML from a
// ContentLocation. Validates required top-level sections but does NOT resolve
// $ENV_VAR references or make any network calls - those are adapter concerns.
//
// Extracted from src/adapters/github/config-loader.ts per the config-loader
// refactoring plan (plans/config-loader-refactor.md Phase 1).
// =============================================================================

import { parse } from "@std/yaml";
import { dirname, resolve } from "@std/path";
import { fetchContent } from "./utils/fetch-location.ts";
import { describeContentLocation } from "../domain/content-location.ts";
import type { ContentLocation } from "../domain/content-location.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { EnvGetter } from "../domain/env.ts";
import { ConfigError } from "../domain/errors.ts";
import { findRewriter } from "./utils/url-rewriters.ts";

export interface BootConfig {
  readonly scrumConfig: ScrumConfig;
  readonly projectRoot: string;
}

/**
 * Fetch and parse the scrum config YAML from wherever `configLocation` points.
 *
 * Validates required top-level sections. Does NOT resolve $ENV_VAR references
 * or make any network calls - that is the adapter's responsibility.
 *
 * @param configLocation - where to load the config from
 * @param env - optional environment getter for auth-requiring config URLs
 */
export const loadScrumConfig = async (
  configLocation: ContentLocation,
  env?: EnvGetter,
): Promise<BootConfig> => {
  const configDesc = describeContentLocation(configLocation);

  let rawYml: string;
  try {
    rawYml = await fetchContent(configLocation, env);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const recovery = configLocation.kind === "file"
      ? `Verify the file exists at: ${configLocation.path}`
      : configLocation.kind === "url"
      ? `Verify the URL is accessible: ${configLocation.url.toString()}`
      : `Ensure the server is started from the project root, or pass --config <path>.`;

    throw new ConfigError(
      `Cannot read config at '${configDesc}': ${errMessage}.`,
      "FETCH_FAILED",
      recovery,
    );
  }

  // Detect HTML content before YAML parsing. GitHub blob URLs and other
  // UI pages return HTML instead of raw YAML. Each registered UrlRewriter
  // contributes a platform-specific recovery hint.
  if (rawYml.trimStart().startsWith("<")) {
    const recoveryActions: string[] = [];
    if (configLocation.kind === "url") {
      const rewriter = findRewriter(configLocation.url);
      if (rewriter) {
        recoveryActions.push(rewriter.recoveryHint(configLocation.url));
      }
    }
    throw new ConfigError(
      `The URL at ${configDesc} returned HTML instead of expected YAML content.`,
      "HTML_CONTENT",
      recoveryActions.length > 0
        ? recoveryActions.join(" ")
        : "Use a raw content URL instead of a UI page URL.",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parse(rawYml) as Record<string, unknown>;
  } catch (err) {
    const parseError = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Failed to parse ${configDesc}: ${parseError}`,
      "YAML_PARSE_ERROR",
      "Check that the file contains valid YAML syntax.",
    );
  }

  if (!parsed.project) {
    throw new ConfigError(
      `${configDesc} is missing required 'project' section.`,
      "MISSING_SECTION",
      "Add a 'project' section to the config file. See the documentation for the required fields.",
    );
  }
  if (!parsed.scrum) {
    throw new ConfigError(
      `${configDesc} is missing required 'scrum' section.`,
      "MISSING_SECTION",
      "Add a 'scrum' section to the config file. See the documentation for the required fields.",
    );
  }
  if (!parsed.backends) {
    throw new ConfigError(
      `${configDesc} is missing required 'backends' section.`,
      "MISSING_SECTION",
      "Add a 'backends' section to the config file. See the documentation for the required fields.",
    );
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
