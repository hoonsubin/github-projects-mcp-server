// =============================================================================
// src/scrum/template-resource.ts - Template resource use case
//
// Serves PBI item-type instructional content for scrum://template/{type} MCP resources.
// Template locations are resolved by the backend from its type_mapping config and
// passed in at composition time - this use case has no knowledge of config structure.
//
// The resource is only reachable for types listed in vocabulary.template_uris; the
// agent does not call it for types absent from that map.
// =============================================================================

import type { FileReaderPort } from "./ports.ts";
import type { ContentLocation, SupportedMimeType } from "../domain/content-location.ts";
import { mimeTypeForPath } from "../domain/content-location.ts";

interface TemplateData {
  content: string;
  /** MIME type for the template resource. Narrow union — not unconstrained string. */
  mimeType: SupportedMimeType;
}

export const templateResourceUseCase = async (
  type: string,
  fileReader: FileReaderPort,
  typeTemplatePaths: Record<string, ContentLocation>,
): Promise<TemplateData> => {
  const location = typeTemplatePaths[type];
  if (!location) {
    throw new Error(
      `No template declared for type "${type}". ` +
        `Add a template path to type_mapping.${type} in your backend config, ` +
        `or read vocabulary.template_uris from scrum_orient to see which types have templates.`,
    );
  }
  const content = await fileReader.fetchContent(location);
  const mimeType: SupportedMimeType = location.kind === "inline"
    ? "text/markdown"
    : location.kind === "file"
    ? mimeTypeForPath(location.path)
    : mimeTypeForPath(location.url.pathname);
  return { content, mimeType };
};
