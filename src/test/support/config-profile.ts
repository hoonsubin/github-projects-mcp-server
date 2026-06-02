// =============================================================================
// src/test/support/config-profile.ts
// Derives agent-facing expectations from the committed scrum config YAML.
// Used by ConfigShapedFakeBackend and contract invariant assertions.
// =============================================================================

import { computeTypeTemplatePaths } from "../../adapters/github/bootstrap.ts";
import type { GitHubBackendConfig } from "../../adapters/github/types.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import { ITEM_TYPES, type TemplateUriMap } from "../../domain/types.ts";
import type { ContentLocation } from "../../domain/content-location.ts";
import type { BootConfig } from "../../scrum/config-boot.ts";

export interface ConfigProfile {
  readonly scrumConfig: ScrumConfig;
  readonly projectRoot: string;

  readonly statusKeys: readonly string[];
  readonly priorityKeys: readonly string[];

  readonly statusDisplay: Record<string, string>;
  readonly priorityDisplay: Record<string, string>;
  readonly typeDisplay: Record<string, string>;

  readonly typeTemplatePaths: Record<string, ContentLocation>;
  readonly expectedTemplateUris: TemplateUriMap | null;

  readonly expectedStoryPointValues: readonly number[] | null;
  readonly expectedStoryPointScale: string | null;
  readonly expectedVelocityWindow: number;
  readonly expectedSprintLengthWeeks: number | null;
  readonly expectedDor: readonly string[] | null;
  readonly expectedDod: readonly string[] | null;
  readonly expectedTeam: ScrumConfig["project"]["team"] | null;
  readonly expectedAutonomy: { require_confirmation_above_n_items: number | null } | null;
  readonly expectedP0Display: string;
  readonly expectedDeadlineField: string | null;
}

const buildTemplateUriMap = (
  typeTemplatePaths: Record<string, ContentLocation>,
): TemplateUriMap | null => {
  const map: TemplateUriMap = {};
  for (const type of ITEM_TYPES) {
    if (typeTemplatePaths[type]) {
      map[type] = `scrum://template/${type}`;
    }
  }
  return Object.keys(map).length > 0 ? map : null;
};

/** Read GitHub backend section from scrum config (platform-specific; test-only cast). */
export const readGitHubBackendConfig = (
  scrumConfig: ScrumConfig,
): GitHubBackendConfig | null => {
  const raw = scrumConfig.backends?.github;
  if (!raw || typeof raw !== "object") return null;
  return raw as GitHubBackendConfig;
};

export const deriveConfigProfile = (boot: BootConfig): ConfigProfile => {
  const { scrumConfig, projectRoot } = boot;
  const ghConfig = readGitHubBackendConfig(scrumConfig);

  const statusKeys = Object.keys(scrumConfig.scrum.status);
  const priorityKeys = scrumConfig.scrum.priority.map((p) => p.key);

  const statusDisplay = ghConfig?.status_display ?? scrumConfig.status_display ?? {};
  const priorityDisplay = ghConfig?.priority_display ?? scrumConfig.priority_display ?? {};

  const typeDisplay: Record<string, string> = {};
  if (ghConfig?.type_mapping) {
    for (const [key, entry] of Object.entries(ghConfig.type_mapping)) {
      typeDisplay[key] = entry.display;
    }
  }

  const typeTemplatePaths = ghConfig?.type_mapping
    ? computeTypeTemplatePaths(ghConfig.type_mapping, projectRoot)
    : {};

  const p0Key = scrumConfig.scrum.priority[0]?.key ?? "p0";
  const expectedP0Display = priorityDisplay[p0Key] ?? "Must";

  return {
    scrumConfig,
    projectRoot,
    statusKeys,
    priorityKeys,
    statusDisplay,
    priorityDisplay,
    typeDisplay,
    typeTemplatePaths,
    expectedTemplateUris: buildTemplateUriMap(typeTemplatePaths),
    expectedStoryPointValues: scrumConfig.scrum.sprint?.story_point_values ?? null,
    expectedStoryPointScale: scrumConfig.scrum.sprint?.story_point_scale ?? null,
    expectedVelocityWindow: scrumConfig.scrum.sprint?.velocity_window ?? 5,
    expectedSprintLengthWeeks: scrumConfig.scrum.sprint?.length_weeks ?? null,
    expectedDor: scrumConfig.definition_of_ready ?? null,
    expectedDod: scrumConfig.definition_of_done ?? null,
    expectedTeam: scrumConfig.project.team ?? null,
    expectedAutonomy: scrumConfig.project.agent?.autonomy
      ? {
        require_confirmation_above_n_items:
          scrumConfig.project.agent.autonomy.require_confirmation_above_n_items ?? null,
      }
      : null,
    expectedP0Display,
    expectedDeadlineField: scrumConfig.deadline_field ?? null,
  };
};
