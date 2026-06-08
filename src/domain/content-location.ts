// =============================================================================
// src/domain/content-location.ts - ContentLocation discriminated union
//
// Represents "where content lives" as a typed value rather than a raw string.
// Replaces untyped path strings in config and template resolution throughout
// the system.
//
// Also defines the UrlRewriter interface - a scalable plugin point where each
// backend can declare URL patterns that need rewriting (e.g. GitHub blob URLs
// → raw.githubusercontent.com). No platform-specific logic lives here; the
// interface is domain-level so all use-case code can consume it without
// coupling to a particular backend.
// =============================================================================

import type { EnvGetter } from "./env.ts";

export const CONTENT_LOCATION_KINDS = ["file", "url", "inline"] as const;
export type ContentLocationKind = (typeof CONTENT_LOCATION_KINDS)[number];

/**
 * Discriminated union describing every location the system can read content from.
 *
 *   file   - absolute filesystem path (resolved by the use-case layer before creation)
 *   url    - fully-qualified HTTP/HTTPS URL (parsed at construction time)
 *   inline - content already in memory; no I/O required
 */
export type ContentLocation =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "url"; readonly url: URL }
  | { readonly kind: "inline"; readonly content: string };

/**
 * Supported MIME types for template content resources.
 * Narrow union - not unconstrained string. Consumers that match on this
 * get exhaustiveness checking; adding a new MIME type requires updating
 * all match sites that must handle it.
 */
export type SupportedMimeType =
  | "text/markdown"
  | "application/json"
  | "application/x-yaml";

/**
 * A URL rewriter maps platform-specific HTML/UI URLs to their canonical
 * raw-content equivalents. Each backend contributes one entry to the
 * resolution pipeline - resolution and error-handling code never hard-codes
 * platform-specific URL patterns.
 *
 * Backends may also implement `requestInit` to supply per-request options
 * (e.g. auth headers) when the use-case layer fetches the URL. The env
 * getter is provided so backends can resolve platform-specific tokens
 * without touching Deno.env directly.
 */
export interface UrlRewriter {
  /** Which platform/backend this rewriter handles (e.g. "github"). */
  readonly backendName: string;
  /** True when this rewriter can handle the given URL. */
  readonly matches: (url: URL) => boolean;
  /** Rewrite the URL to its canonical raw-content form. Return the URL unchanged if no transformation is needed. */
  readonly rewrite: (url: URL) => URL;
  /** Human-readable hint when content from this platform isn't what was expected. */
  readonly recoveryHint: (url: URL) => string;
  /**
   * Optional per-request fetch options (e.g. Authorization headers).
   * Called by the use-case fetcher immediately before the fetch - the result
   * is passed directly to `fetch(url, init)`. Return undefined to use the
   * default unauthenticated fetch.
   *
   * The env getter is provided by the composition root and resolves platform-
   * specific environment variables (e.g. GITHUB_TOKEN).
   */
  readonly requestInit?: (url: URL, env: EnvGetter) => RequestInit | undefined;
}

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
