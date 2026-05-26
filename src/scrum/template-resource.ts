// =============================================================================
// src/scrum/template-resource.ts - Template resource use case
//
// Serves PBI item-type instructional content for scrum://template/{type} MCP resources.
// Template file paths are resolved by the backend from its type_mapping config and
// passed in at composition time - this use case has no knowledge of config structure.
//
// The resource is only reachable for types listed in vocabulary.template_uris; the
// agent does not call it for types absent from that map.
// =============================================================================

import type { FileReaderPort } from "./ports.ts";

interface TemplateData {
  content: string;
  mimeType: "text/markdown";
}

export const templateResourceUseCase = async (
  type: string,
  fileReader: FileReaderPort,
  typeTemplatePaths: Record<string, string>,
): Promise<TemplateData> => {
  const path = typeTemplatePaths[type];
  if (!path) {
    throw new Error(
      `No template declared for type "${type}". ` +
        `Add a template path to type_mapping.${type} in your backend config, ` +
        `or read vocabulary.template_uris from scrum_orient to see which types have templates.`,
    );
  }
  const content = await fileReader.fetchRepoFile(path);
  return { content, mimeType: "text/markdown" };
};
