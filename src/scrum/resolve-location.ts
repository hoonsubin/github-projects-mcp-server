// =============================================================================
// src/scrum/resolve-location.ts - resolveLocation() use-case utility
//
// Converts a raw string (from config YAML or a CLI arg) to a self-describing
// ContentLocation. This is the single source of truth for resolution rules
// and extension validation — callers never re-implement this logic.
//
// URL rewriting: when a URL matches a registered UrlRewriter (e.g. GitHub
// blob URLs → raw.githubusercontent.com), it is transparently converted
// before extension validation. The rewriter registry lives in url-rewriters.ts
// — each backend contributes its own entry; no platform-specific patterns
// are hard-coded here.
// =============================================================================

import { extname, isAbsolute, resolve } from "@std/path";
import type { ContentLocation } from "../domain/content-location.ts";
import { ConfigError } from "../domain/errors.ts";
import { findRewriter } from "./url-rewriters.ts";

/** Extensions accepted for config file paths passed via --config or SCRUM_CONFIG_PATH. */
export const SUPPORTED_CONFIG_EXTENSIONS = [".yml", ".yaml"] as const;
export type SupportedConfigExtension = (typeof SUPPORTED_CONFIG_EXTENSIONS)[number];

/** Extensions accepted for PBI type template paths (wider set than config). */
export const SUPPORTED_TEMPLATE_EXTENSIONS = [".md", ".json", ".yml", ".yaml"] as const;
export type SupportedTemplateExtension = (typeof SUPPORTED_TEMPLATE_EXTENSIONS)[number];

/**
 * Resolve a raw string (from config YAML or a CLI arg) to a ContentLocation.
 *
 * Resolution rules:
 *   - Starts with "http://" or "https://"  → { kind: "url", url: new URL(input) }
 *     (URLs matching a registered UrlRewriter are transparently converted)
 *   - isAbsolute(input)                    → { kind: "file", path: input }
 *   - otherwise                            → { kind: "file", path: resolve(baseDir, input) }
 *
 * @param input              Raw string from config or CLI.
 * @param baseDir            Absolute directory to anchor relative paths against.
 * @param supportedExtensions Extensions to validate against (defaults to SUPPORTED_CONFIG_EXTENSIONS).
 * @throws {ConfigError} if the resolved path or URL has an unsupported file extension.
 */
export const resolveLocation = (
  input: string,
  baseDir: string,
  supportedExtensions: readonly string[] = SUPPORTED_CONFIG_EXTENSIONS,
): ContentLocation => {
  if (input.startsWith("https://") || input.startsWith("http://")) {
    let url = new URL(input);

    // Transparent URL rewriting — each backend can register patterns that
    // convert platform-specific UI URLs to canonical raw-content equivalents.
    const rewriter = findRewriter(url);
    if (rewriter) {
      url = rewriter.rewrite(url);
    }

    const ext = extname(url.pathname);
    if (!supportedExtensions.includes(ext)) {
      throw new ConfigError(
        `Unsupported file extension "${ext}" in URL: ${input}.`,
        "UNSUPPORTED_EXTENSION",
        `Supported extensions: ${supportedExtensions.join(", ")}`,
      );
    }
    return { kind: "url", url };
  }

  const resolved = isAbsolute(input) ? input : resolve(baseDir, input);
  const ext = extname(resolved);
  if (!supportedExtensions.includes(ext)) {
    throw new ConfigError(
      `Unsupported file extension "${ext}" in path: ${resolved}.`,
      "UNSUPPORTED_EXTENSION",
      `Supported extensions: ${supportedExtensions.join(", ")}`,
    );
  }
  return { kind: "file", path: resolved };
};
