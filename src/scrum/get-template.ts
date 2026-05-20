// =============================================================================
// src/scrum/get-template.ts — getTemplateUseCase
//
// Receives backend: ProjectBackend and scrumConfig: ScrumConfig.
// =============================================================================

import type { TemplatePort } from "./ports.ts";
import type { ArtifactType, TemplateResponse } from "../domain/types.ts";
import type { ScrumConfig } from "../domain/config.ts";

/**
 * Fetch a ceremony artifact template by type.
 * Returns { content: null, source: "default" } when no custom template is declared.
 */
export const getTemplateUseCase = async (
  backend: TemplatePort,
  scrumConfig: ScrumConfig,
  artifactType: ArtifactType,
): Promise<TemplateResponse> => {
  const path = scrumConfig.templates?.[artifactType] ?? null;
  if (path === null) {
    return { content: null, source: "default" };
  }
  const fileContent = await backend.fetchRepoFile(path);
  return { content: fileContent, source: "custom" };
};
