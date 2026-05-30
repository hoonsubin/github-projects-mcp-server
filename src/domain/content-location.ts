// =============================================================================
// src/domain/content-location.ts - ContentLocation discriminated union
//
// Represents "where content lives" as a typed value rather than a raw string.
// Replaces untyped path strings in config and template resolution throughout
// the system.
// =============================================================================

export const CONTENT_LOCATION_KINDS = ["file", "url", "inline"] as const;
export type ContentLocationKind = (typeof CONTENT_LOCATION_KINDS)[number];

/**
 * Discriminated union describing every location the system can read content from.
 *
 *   file   — absolute filesystem path (resolved by the use-case layer before creation)
 *   url    — fully-qualified HTTP/HTTPS URL (parsed at construction time)
 *   inline — content already in memory; no I/O required
 */
export type ContentLocation =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "url"; readonly url: URL }
  | { readonly kind: "inline"; readonly content: string };

/**
 * Supported MIME types for template content resources.
 * Narrow union — not unconstrained string. Consumers that match on this
 * get exhaustiveness checking; adding a new MIME type requires updating
 * all match sites that must handle it.
 */
export type SupportedMimeType =
  | "text/markdown"
  | "application/json"
  | "application/x-yaml";

/** Human-readable representation for error messages and logging. */
export const describeContentLocation = (loc: ContentLocation): string => {
  switch (loc.kind) {
    case "file":
      return loc.path;
    case "url":
      return loc.url.toString();
    case "inline":
      return "<inline content>";
  }
};

/**
 * Infer a MIME type from a file extension for MCP resource Content-Type.
 * Falls back to "text/markdown" for unrecognized extensions.
 */
export const mimeTypeForPath = (p: string): SupportedMimeType => {
  const ext = p.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "json":
      return "application/json";
    case "yml":
    case "yaml":
      return "application/x-yaml";
    default:
      return "text/markdown";
  }
};
