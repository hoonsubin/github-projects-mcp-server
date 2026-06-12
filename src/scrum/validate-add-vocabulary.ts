// =============================================================================
// src/scrum/validate-add-vocabulary.ts - Config-authoritative vocabulary guard
//
// scrum_add_vocabulary for status_option / priority_option may only close gaps
// declared in .github/scrum/config.yml. Labels remain fully agent-driven.
// =============================================================================

import { ConfigError } from "../domain/errors.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { VocabularyKind } from "../domain/types.ts";

type GitHubDisplayMaps = {
  status_display?: Record<string, string>;
  priority_display?: Record<string, string>;
};

const githubDisplayMaps = (scrumConfig: ScrumConfig): GitHubDisplayMaps | null => {
  const raw = scrumConfig.backends?.github;
  if (!raw || typeof raw !== "object") return null;
  return raw as GitHubDisplayMaps;
};

const configDeclaredStatusDisplays = (scrumConfig: ScrumConfig): string[] => {
  const gh = githubDisplayMaps(scrumConfig);
  const display = gh?.status_display ?? scrumConfig.status_display ?? {};
  return Object.keys(scrumConfig.scrum.status)
    .map((key) => display[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
};

const configDeclaredPriorityDisplays = (scrumConfig: ScrumConfig): string[] => {
  const gh = githubDisplayMaps(scrumConfig);
  const display = gh?.priority_display ?? scrumConfig.priority_display ?? {};
  return scrumConfig.scrum.priority
    .map((tier) => display[tier.key])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
};

/**
 * Throws ConfigError when a status_option or priority_option add violates config
 * authority. Labels are not validated here.
 */
export const assertAddVocabularyAllowed = (
  scrumConfig: ScrumConfig,
  kind: VocabularyKind,
  value: string,
  missingStatusOptions: readonly string[],
  missingPriorityOptions: readonly string[],
): void => {
  if (kind === "label") return;

  if (kind === "status_option") {
    const allowed = configDeclaredStatusDisplays(scrumConfig);
    if (!allowed.includes(value)) {
      throw new ConfigError(
        `"${value}" is not declared in scrum config status_display. ` +
          `Declared status options: ${allowed.join(", ") || "(none)"}.`,
        "VOCABULARY_NOT_DECLARED",
        "Only add status options declared in .github/scrum/config.yml backends.github.status_display. " +
          "Update the config first if the team needs a new workflow state, then re-run scrum_orient.",
      );
    }
    if (!missingStatusOptions.includes(value)) {
      throw new ConfigError(
        `"${value}" is not listed in platform_state.fields.status.missing_options.`,
        "VOCABULARY_NOT_MISSING",
        "Call scrum_orient and use scrum_add_vocabulary only for values in missing_options. " +
          "If the option already exists on the board, no add is needed.",
      );
    }
    return;
  }

  const allowed = configDeclaredPriorityDisplays(scrumConfig);
  if (!allowed.includes(value)) {
    throw new ConfigError(
      `"${value}" is not declared in scrum config priority_display. ` +
        `Declared priority options: ${allowed.join(", ") || "(none)"}.`,
      "VOCABULARY_NOT_DECLARED",
      "Only add priority options declared in .github/scrum/config.yml backends.github.priority_display. " +
        "Update the config first if the team needs a new priority tier, then re-run scrum_orient.",
    );
  }
  if (!missingPriorityOptions.includes(value)) {
    throw new ConfigError(
      `"${value}" is not listed in platform_state.fields.priority.missing_options.`,
      "VOCABULARY_NOT_MISSING",
      "Call scrum_orient and use scrum_add_vocabulary only for values in missing_options. " +
        "If the option already exists on the board, no add is needed.",
    );
  }
};
