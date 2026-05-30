// =============================================================================
// src/scrum/resolve-location.ts - resolveLocation() use-case utility
//
// Converts a raw string (from config YAML or a CLI arg) to a self-describing
// ContentLocation. This is the single source of truth for resolution rules
// and extension validation — callers never re-implement this logic.
// =============================================================================

import { extname, isAbsolute, resolve } from "@std/path";
import type { ContentLocation } from "../domain/content-location.ts";

export const SUPPORTED_TEMPLATE_EXTENSIONS = [".md", ".json", ".yml", ".yaml"] as const;
export type SupportedTemplateExtension = (typeof SUPPORTED_TEMPLATE_EXTENSIONS)[number];

/**
 * Resolve a raw string (from config YAML or a CLI arg) to a ContentLocation.
 *
 * Resolution rules:
 *   - Starts with "http://" or "https://"  → { kind: "url", url: new URL(input) }
 *   - isAbsolute(input)                    → { kind: "file", path: input }
 *   - otherwise                            → { kind: "file", path: resolve(baseDir, input) }
 *
 * @param input   Raw string from config or CLI.
 * @param baseDir Absolute directory to anchor relative paths against.
 * @throws {Error} if the resolved path or URL has an unsupported file extension.
 */
export const resolveLocation = (
  input: string,
  baseDir: string,
): ContentLocation => {
  if (input.startsWith("https://") || input.startsWith("http://")) {
    const url = new URL(input);
    const ext = extname(url.pathname);
    if (!SUPPORTED_TEMPLATE_EXTENSIONS.includes(ext as SupportedTemplateExtension)) {
      throw new Error(
        `Unsupported file extension "${ext}" in URL: ${input}. ` +
          `Supported extensions: ${SUPPORTED_TEMPLATE_EXTENSIONS.join(", ")}`,
      );
    }
    return { kind: "url", url };
  }

  const resolved = isAbsolute(input) ? input : resolve(baseDir, input);
  const ext = extname(resolved);
  if (!SUPPORTED_TEMPLATE_EXTENSIONS.includes(ext as SupportedTemplateExtension)) {
    throw new Error(
      `Unsupported file extension "${ext}" in path: ${resolved}. ` +
        `Supported extensions: ${SUPPORTED_TEMPLATE_EXTENSIONS.join(", ")}`,
    );
  }
  return { kind: "file", path: resolved };
};
