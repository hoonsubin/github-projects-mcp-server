// =============================================================================
// src/scrum/get-template.ts — getTemplateUseCase
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// Receives backend: ProjectBackend and yml: ScrumConfigYml.
// =============================================================================

import type { ProjectBackend } from "./ports.ts";
import type { ArtifactType, ScrumConfigYml, TemplateResponse } from "../types.ts";

/**
 * Fetch a ceremony artifact template by type.
 * Returns { content: null, source: "default" } when no custom template is declared.
 */
export const getTemplateUseCase = async (
  backend: ProjectBackend,
  yml: ScrumConfigYml,
  artifactType: ArtifactType,
): Promise<TemplateResponse> => {
  const path = yml.templates?.[artifactType] ?? null;
  if (path === null) {
    return { content: null, source: "default" };
  }
  const fileContent = await backend.fetchRepoFile(path);
  return { content: fileContent, source: "custom" };
};
